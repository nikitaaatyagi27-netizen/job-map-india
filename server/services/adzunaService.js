const axios = require("axios");

const Company = require("../models/Company");
const { cleanCompanyNameOrUnknown } = require("../utils/cleanCompanyName");

const getCoords = require("../utils/geocode");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const { isGarbageCompanyName } = require("../utils/companyNameValidator");

// "what" terms — broad enough to surface tech roles, narrow enough to skip non-tech.
// Adzuna does an OR-style match on these, so we run multiple passes per city.
const TECH_QUERIES = [
  "software engineer",
  "software developer",
  "backend developer",
  "frontend developer",
  "full stack developer",
  "java developer",
  "python developer",
  "javascript developer",
  "react developer",
  "node developer",
  "devops engineer",
  "site reliability engineer",
  "data engineer",
  "data scientist",
  "machine learning engineer",
  "android developer",
  "ios developer",
  "mobile developer",
  "qa engineer",
  "security engineer",
  "cloud engineer",
  "platform engineer"
];

// Indian metros + tier-2 hubs. Adzuna geocodes "where" loosely so we can pass
// city names directly. India-wide pass at the end mops up anything not tagged
// with a recognized city.
const CITIES = [
  "Bangalore",
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Mumbai",
  "Chennai",
  "Delhi",
  "Noida",
  "Gurugram",
  "Gurgaon",
  "Kolkata",
  "Ahmedabad",
  "Jaipur",
  "Coimbatore",
  "Kochi",
  "Thiruvananthapuram",
  "Indore",
  "Bhopal",
  "Bhubaneswar",
  "Chandigarh",
  "Nagpur",
  "Visakhapatnam",
  "India" // catch-all final pass
];

const TECH_TITLE_KEYWORDS = [
  "engineer",
  "developer",
  "software",
  "backend",
  "frontend",
  "fullstack",
  "full stack",
  "devops",
  "cloud",
  "data",
  "security",
  "ai",
  "machine learning",
  "ml ",
  "platform",
  "site reliability",
  "sre",
  "android",
  "ios",
  "mobile",
  "qa",
  "test ",
  "tester"
];

const RESULTS_PER_PAGE = 50;
const MAX_PAGES_PER_QUERY = Math.max(
  Number(process.env.ADZUNA_MAX_PAGES_PER_QUERY || 5),
  1
);
const REQUEST_TIMEOUT_MS = 15000;
const REQUEST_DELAY_MS = Math.max(
  Number(process.env.ADZUNA_REQUEST_DELAY_MS || 350),
  0
);

// Zero-result cache: city+role pairs that returned 0 results on page 1 last run.
// Persists across cron runs for the process lifetime — avoids repeating dead queries.
// Key format: "${city}|${query}"
const zeroResultPairs = new Set();

const ADZUNA_DEAD_JOB_PHRASES = [
  "this job is no longer available",
  "job is no longer available",
  "this listing has expired",
  "no longer accepting applications"
];

// Cache of confirmed-dead redirect URLs to avoid re-checking within the same run.
const deadLinkCache = new Set();

async function isAdzunaJobLive(redirectUrl) {
  if (!redirectUrl) return false;
  if (deadLinkCache.has(redirectUrl)) return false;

  try {
    const res = await axios.get(redirectUrl, {
      maxRedirects: 10,
      timeout: 8000,
      validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobBot/1.0)" }
    });

    if (res.status === 404 || res.status === 410) {
      deadLinkCache.add(redirectUrl);
      return false;
    }

    if (res.status >= 400) {
      deadLinkCache.add(redirectUrl);
      return false;
    }

    const body = typeof res.data === "string" ? res.data.toLowerCase() : "";
    const isDead = ADZUNA_DEAD_JOB_PHRASES.some((phrase) => body.includes(phrase));
    if (isDead) {
      deadLinkCache.add(redirectUrl);
      return false;
    }

    return true;
  } catch {
    // On network error assume live so we don't silently drop jobs
    return true;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTechTitle(title) {
  const lower = String(title || "").toLowerCase();
  return TECH_TITLE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

async function fetchAdzunaPage(query, where, page) {
  try {
    const res = await axios.get(
      `https://api.adzuna.com/v1/api/jobs/in/search/${page}`,
      {
        params: {
          app_id: process.env.ADZUNA_APP_ID,
          app_key: process.env.ADZUNA_APP_KEY,
          results_per_page: RESULTS_PER_PAGE,
          what: query,
          where
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    );
    return res.data?.results || [];
  } catch (error) {
    if (error.response?.status === 429) {
      console.log(`[ADZUNA] Rate-limited at page ${page} for "${query}" / "${where}"`);
      throw error; // bubble up so the caller can stop the city
    }
    console.log(`[ADZUNA] Page ${page} failed for "${query}" / "${where}": ${error.message}`);
    return [];
  }
}

async function persistAdzunaJob(job) {
  const companyName = job.company?.display_name || "Unknown";
  if (isGarbageCompanyName(companyName)) return false;

  const live = await isAdzunaJobLive(job.redirect_url);
  if (!live) {
    console.log(`[ADZUNA] Skipping dead job: ${job.title} — ${job.redirect_url}`);
    return false;
  }

  const city = job.location?.area?.[1] || job.location?.display_name || "India";
  const normalizedCompanyName = normalizeCompanyName(companyName);
  if (!normalizedCompanyName) return false;

  const sourceCompanyName = cleanCompanyNameOrUnknown(companyName, city);

  let company = await Company.findOne({ name: normalizedCompanyName });

  if (!company) {
    const coords = await getCoords(city);
    company = await Company.create({
      name: normalizedCompanyName,
      logo: null,
      brandingSource: "adzuna",
      brandingConfidence: "low",
      brandingReasoning: `discovered from Adzuna search results: ${sourceCompanyName}`,
      city,
      location: city,
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      source: "adzuna",
      isRemote: false
    });
    console.log(`[ADZUNA] New company: ${companyName}`);
  }

  await upsertIngestedJob({
    title: job.title,
    company: company._id,
    location: city,
    applyLink: job.redirect_url,
    description: job.description,
    source: "adzuna",
    postedDate: job.created,
    isRemote: false
  });

  return true;
}

async function runQueryForCity(query, city, stats) {
  for (let page = 1; page <= MAX_PAGES_PER_QUERY; page += 1) {
    let pageJobs;
    try {
      pageJobs = await fetchAdzunaPage(query, city, page);
    } catch (error) {
      if (error.response?.status === 429) {
        return { rateLimited: true };
      }
      pageJobs = [];
    }

    if (pageJobs.length === 0) {
      // Record zero-result on page 1 so we skip this pair next run
      if (page === 1) zeroResultPairs.add(`${city}|${query}`);
      break;
    }

    const techJobs = pageJobs.filter((job) => isTechTitle(job.title));
    stats.rawJobs += pageJobs.length;
    stats.techJobs += techJobs.length;

    for (const job of techJobs) {
      try {
        const saved = await persistAdzunaJob(job);
        if (saved) stats.savedJobs += 1;
      } catch (error) {
        console.log(`[ADZUNA] Persist failed: ${error.message}`);
      }
    }

    if (pageJobs.length < RESULTS_PER_PAGE) {
      break; // last page
    }

    if (REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return { rateLimited: false };
}

const fetchAdzunaJobs = async () => {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) {
    console.log("[ADZUNA] Skipped — ADZUNA_APP_ID / ADZUNA_APP_KEY missing");
    return;
  }

  console.log("[ADZUNA] Fetching India jobs across cities and roles");

  const stats = {
    rawJobs: 0,
    techJobs: 0,
    savedJobs: 0,
    cityRolePairs: 0
  };

  let skipped = 0;
  outer: for (const city of CITIES) {
    for (const query of TECH_QUERIES) {
      if (zeroResultPairs.has(`${city}|${query}`)) {
        skipped++;
        continue; // returned 0 last run — skip without an API call
      }
      stats.cityRolePairs += 1;
      const { rateLimited } = await runQueryForCity(query, city, stats);
      if (rateLimited) {
        console.log("[ADZUNA] Stopping run — rate limit hit");
        break outer;
      }
    }
  }

  console.log(
    `[ADZUNA] Done | pairs: ${stats.cityRolePairs} | skipped(zero): ${skipped} | raw: ${stats.rawJobs} | tech-filtered: ${stats.techJobs} | saved: ${stats.savedJobs}`
  );
};

module.exports = fetchAdzunaJobs;
