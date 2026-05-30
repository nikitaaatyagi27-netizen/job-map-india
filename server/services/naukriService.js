// Naukri ingestion — uses Naukri's internal mobile JSON API instead of
// Puppeteer DOM scraping (bot detection defeats headless Chrome).
//
// ToS WARNING: This calls an undocumented internal endpoint with spoofed
// mobile app headers (systemid: NaukriMobile). This likely violates Naukri's
// Terms of Service. Disable with NAUKRI_ENABLED=false in server/.env if
// you need to stay strictly within ToS (e.g. before going public/commercial).

const axios = require("axios");
const nodemailer = require("nodemailer");

const Company = require("../models/Company");
const getCoords = require("../utils/geocode");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { cleanCompanyNameOrUnknown, isGenericCompanyName } = require("../utils/cleanCompanyName");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const { isGarbageCompanyName } = require("../utils/companyNameValidator");
const { extractIndianCityCoords } = require("../utils/indiaLocation");

// ---- city + role catalog ----
const CITY_BUCKETS = [
  { region: "north",   cities: ["Delhi", "Noida", "Gurugram", "Faridabad", "Ghaziabad", "Chandigarh", "Jaipur", "Lucknow", "Dehradun", "Agra", "Meerut", "Amritsar", "Ludhiana"] },
  { region: "west",    cities: ["Mumbai", "Pune", "Ahmedabad", "Surat", "Nashik", "Nagpur", "Vadodara", "Goa"] },
  { region: "south",   cities: ["Bengaluru", "Hyderabad", "Chennai", "Coimbatore", "Kochi", "Mysuru", "Visakhapatnam", "Vijayawada", "Thiruvananthapuram", "Madurai", "Mangaluru"] },
  { region: "east",    cities: ["Kolkata", "Bhubaneswar", "Ranchi", "Patna", "Guwahati", "Jamshedpur", "Siliguri"] },
  { region: "central", cities: ["Indore", "Bhopal", "Raipur", "Jabalpur", "Varanasi"] }
];

const ROLES = [
  // Generic engineering
  "Software Engineer", "Software Developer", "Backend Developer", "Frontend Developer",
  "Full Stack Developer", "Java Developer", "Python Developer", ".NET Developer",
  "Angular Developer", "React Developer", "Node Developer", "Data Engineer", "Data Scientist",
  "DevOps Engineer", "SRE Engineer", "Platform Engineer", "Cloud Engineer",
  "QA Engineer", "SDET", "Android Developer", "iOS Developer", "Flutter Developer",
  "Machine Learning Engineer", "Technical Lead", "Engineering Manager", "Software Architect",
  // Security — expanded so cybersecurity resumes get Naukri coverage
  "Security Engineer", "Cybersecurity Engineer", "Application Security Engineer",
  "Security Analyst", "Penetration Tester", "Information Security Analyst",
  // Data & AI
  "AI Engineer", "Deep Learning Engineer", "Computer Vision Engineer", "NLP Engineer",
  // Product / Management
  "Product Manager", "Technical Program Manager", "Data Analyst"
];

// Headline-source intensity: more cities + pages for broader coverage.
// Kept conservative on delay (1500ms) to stay under Naukri's rate limiting —
// the circuit breaker auto-disables after 3 rate-limited runs as a safety net.
const DEFAULT_CITY_RUN_SIZE = Math.max(Number(process.env.NAUKRI_CITIES_PER_RUN || 40), 1);
const MAX_PAGES_PER_QUERY  = Math.max(Number(process.env.NAUKRI_MAX_PAGES_PER_QUERY || 4), 1);
const REQUEST_DELAY_MS     = Math.max(Number(process.env.NAUKRI_REQUEST_DELAY_MS || 1500), 0);
const REQUEST_TIMEOUT_MS   = 25000;

// Circuit breaker: counts 403/429 responses across runs (persists for the
// lifetime of the process). After CIRCUIT_BREAKER_THRESHOLD consecutive
// rate-limited runs, Naukri is disabled for the remainder of the session.
// Resets to 0 whenever a run returns at least one successful page.
const CIRCUIT_BREAKER_THRESHOLD = 3;
let consecutiveRateLimitedRuns = 0;

// Naukri's mobile API — v4 returns 404, v1 with NaukriMobile systemid works
const NAUKRI_API = "https://www.naukri.com/jobapi/v1/search";

// Rotate through recent Chrome UAs
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
];

// ---- helpers ----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(min, max) { return sleep(min + Math.floor(Math.random() * (max - min + 1))); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildBalancedCityRun() {
  const buckets = CITY_BUCKETS.map(b => b.cities.filter(Boolean));
  const total = buckets.reduce((n, b) => n + b.length, 0);
  if (DEFAULT_CITY_RUN_SIZE >= total) {
    return [...new Set(buckets.flat())];
  }
  const selected = [];
  const idx = buckets.map(() => 0);
  let added = true;
  while (selected.length < DEFAULT_CITY_RUN_SIZE && added) {
    added = false;
    for (let bi = 0; bi < buckets.length; bi++) {
      if (idx[bi] >= buckets[bi].length || selected.length >= DEFAULT_CITY_RUN_SIZE) continue;
      const city = buckets[bi][idx[bi]++];
      if (city && !selected.includes(city)) { selected.push(city); added = true; }
    }
  }
  return selected;
}

// ---- Naukri API call ----
function buildApiHeaders() {
  return {
    "appid": "109",
    "systemid": "NaukriMobile",
    "User-Agent": pick(USER_AGENTS),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.naukri.com/",
    "Origin": "https://www.naukri.com"
  };
}

async function fetchApiPage(role, city, pageNo) {
  const seoKey = `${normalizeSlug(role)}-jobs-in-${normalizeSlug(city)}`;
  const params = {
    noOfResults: 20,
    urlType: "search_by_key_loc",
    searchType: "adv",
    keyword: role,
    location: city,
    pageNo,
    seoKey,
    src: "jobsearchDesk",
    latLong: "",
    experience: ""
  };

  try {
    const res = await axios.get(NAUKRI_API, {
      params,
      headers: buildApiHeaders(),
      timeout: REQUEST_TIMEOUT_MS
    });

    const jobs = res.data?.list || [];
    const total = res.data?.totaljobs ?? "?";

    if (pageNo === 1) {
      console.log(`[NAUKRI] API ${res.status} | "${role}" in ${city} | total=${total} | page1=${jobs.length} jobs`);
    }

    return { jobs, rateLimited: false };
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 403) {
      console.log(`[NAUKRI] Rate-limited (HTTP ${status}) on "${role}" in ${city}`);
      return { jobs: [], rateLimited: true };
    }
    console.log(`[NAUKRI] API error — "${role}" ${city} p${pageNo}: ${err.message}`);
    return { jobs: [], rateLimited: false };
  }
}

// ---- persistence (unchanged logic from before) ----
function isLikelyCompanyName(v) {
  return Boolean(v) && !isGenericCompanyName(v) && !isGarbageCompanyName(v);
}

async function ensureCompany(companyName, location, city) {
  const cleaned = cleanCompanyNameOrUnknown(companyName, location || city);
  const normalized = cleaned ? normalizeCompanyName(cleaned) : null;
  if (!normalized || normalized === "unknown" || !isLikelyCompanyName(normalized)) return null;

  let company = await Company.findOne({ name: normalized });
  if (company) {
    if (!company.location) {
      company.location = location || `${city}, India`;
      company.city = company.city || city;
      company.updatedAt = new Date();
      await company.save();
    }
    return company;
  }

  const primaryCity = (location || city || "India")
    .split(/[,/|]/)
    .map(s => s.trim())
    .find(Boolean) || city || "India";

  const coords = extractIndianCityCoords(primaryCity)
    || extractIndianCityCoords(city)
    || await getCoords(primaryCity);

  company = await Company.create({
    name: normalized,
    logo: null,
    domain: null,
    website: null,
    careersUrl: null,
    careersProvider: null,
    discoverySources: ["naukri"],
    intelligenceStatus: "seeded",
    lastIntelligenceAt: new Date(),
    brandingSource: "naukri",
    brandingConfidence: "low",
    brandingReasoning: "discovered from Naukri API results",
    city,
    location: location || `${city}, India`,
    lat: coords?.lat || null,
    lng: coords?.lng || null,
    source: "naukri",
    isRemote: false
  });
  console.log(`[NAUKRI] New company: ${normalized}`);
  return company;
}

async function saveJob(jobData, city) {
  const { title, companyName, location, applyLink, salary, postedDate, yearsMin, yearsMax } = jobData;
  if (!title || !companyName || !applyLink) return false;

  const company = await ensureCompany(companyName, location, city);
  if (!company) return false;

  await upsertIngestedJob({
    title,
    company: company._id,
    location: location || `${city}, India`,
    applyLink,
    description: salary || null,
    source: "naukri",
    postedDate: postedDate || null,
    isRemote: /remote|work\s*from\s*home|wfh/i.test(location || ""),
    yearsMin,
    yearsMax
  });
  return true;
}

function mapApiJob(raw, city) {
  // Field names confirmed from live /jobapi/v1/search response (probeNaukriApi.js).
  // list[n].post     = job title
  // list[n].companyName = company name
  // list[n].city     = primary city string
  // list[n].cityfield = full location (may include multiple cities)
  // list[n].urlStr   = job URL path (e.g. "/job-listings-...-123456")
  // list[n].jobId    = numeric job ID (fallback for URL)
  // list[n].SALARY   = salary text
  // list[n].minExp / maxExp = experience range numbers

  const urlStr = raw.urlStr || raw.nonStaticUrlFor || null;
  const applyLink = urlStr
    ? (urlStr.startsWith("http") ? urlStr : `https://www.naukri.com${urlStr}`)
    : (raw.jobId ? `https://www.naukri.com/job-listings-${raw.jobId}` : null);

  const location = (raw.cityfield || raw.city || city || "")
    .split(/[\n\r]+/)[0]   // cityfield can have newlines with extra metadata
    .replace(/\s+/g, " ")
    .trim() || city;

  const salary = raw.SALARY || (
    raw.minSal != null && raw.maxSal != null
      ? `${raw.minSal}-${raw.maxSal} LPA`
      : null
  );

  const postedDate = raw.date ? new Date(raw.date * 1000) : null;

  return {
    title:       raw.post || null,
    companyName: raw.companyName || raw.staticCompanyName || null,
    location,
    applyLink,
    salary,
    postedDate,
    yearsMin:    raw.minExp ?? null,
    yearsMax:    raw.maxExp ?? null
  };
}

async function sendCircuitBreakerAlert() {
  const adminEmail = process.env.ALERT_ADMIN_EMAIL || process.env.EMAIL_USER;
  if (!adminEmail || !process.env.EMAIL_HOST || !process.env.EMAIL_USER) return;

  const transport = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   Number(process.env.EMAIL_PORT || 587),
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });

  await transport.sendMail({
    from:    process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to:      adminEmail,
    subject: "Naukri circuit breaker opened — ingestion stopped",
    text:    `Naukri has rate-limited your server ${CIRCUIT_BREAKER_THRESHOLD} consecutive times.\n\nNaukri ingestion is now disabled for the remainder of this process.\n\nTo recover: restart the server. To suppress permanently: set NAUKRI_ENABLED=false in .env.`
  });
}

// ---- main entry point ----
async function fetchNaukriJobs(options = {}) {
  if (process.env.NAUKRI_ENABLED === "false") {
    console.log("[NAUKRI] Skipped — NAUKRI_ENABLED=false");
    return 0;
  }

  if (consecutiveRateLimitedRuns >= CIRCUIT_BREAKER_THRESHOLD) {
    console.warn(
      `[NAUKRI] Circuit breaker open — ${consecutiveRateLimitedRuns} consecutive rate-limited runs.` +
      ` Set NAUKRI_ENABLED=false in .env to suppress permanently.`
    );
    return 0;
  }

  console.log("[NAUKRI] Starting ingestion (direct API mode — no browser)");

  const cities = options.cities || buildBalancedCityRun();
  console.log(`[NAUKRI] Cities: ${cities.length} | Roles: ${ROLES.length} | MaxPages: ${MAX_PAGES_PER_QUERY}`);

  const stats = { rawJobs: 0, savedJobs: 0, queriesRun: 0, pagesFetched: 0 };
  let hitRateLimit = false;

  outer: for (const city of cities) {
    for (const role of ROLES) {
      stats.queriesRun++;

      for (let pageNo = 1; pageNo <= MAX_PAGES_PER_QUERY; pageNo++) {
        const { jobs, rateLimited } = await fetchApiPage(role, city, pageNo);
        stats.pagesFetched++;

        if (rateLimited) {
          hitRateLimit = true;
          console.log("[NAUKRI] Stopping run due to rate limit");
          break outer;
        }

        if (jobs.length === 0) break; // no more pages for this query

        stats.rawJobs += jobs.length;

        for (const raw of jobs) {
          try {
            const jobData = mapApiJob(raw, city);
            const saved = await saveJob(jobData, city);
            if (saved) stats.savedJobs++;
          } catch (err) {
            console.log(`[NAUKRI] Persist failed: ${err.message}`);
          }
        }

        if (REQUEST_DELAY_MS > 0) await jitter(REQUEST_DELAY_MS, REQUEST_DELAY_MS + 800);
      }
    }
  }

  // Update circuit breaker counter
  if (hitRateLimit) {
    consecutiveRateLimitedRuns++;
    console.warn(`[NAUKRI] Rate-limited run #${consecutiveRateLimitedRuns} (threshold: ${CIRCUIT_BREAKER_THRESHOLD})`);

    if (consecutiveRateLimitedRuns === CIRCUIT_BREAKER_THRESHOLD) {
      console.warn("[NAUKRI] Circuit breaker opened — Naukri disabled for this process. Restart server to recover.");
      sendCircuitBreakerAlert().catch(() => {});
    }
  } else {
    consecutiveRateLimitedRuns = 0; // successful run — reset
  }

  console.log(
    `[NAUKRI] Done | queries: ${stats.queriesRun} | pages: ${stats.pagesFetched} | raw: ${stats.rawJobs} | saved: ${stats.savedJobs}`
  );
  return stats.savedJobs;
}

module.exports = fetchNaukriJobs;
