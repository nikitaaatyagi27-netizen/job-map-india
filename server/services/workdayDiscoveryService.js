const axios = require("axios");

const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");
const {
  ingestWorkdayTenant
} = require("./workdayService");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { getDiscoveryQueries } = require("./discoveryQueryService");

function buildDedupeKey(value) {
  return String(value || "").toLowerCase();
}

// Default high enough to absorb the curated seed list in a single bootstrap pass.
// Subsequent cron runs see most as "already known" and skip via dedupe.
const MAX_DISCOVERY_CANDIDATES = Number(process.env.WORKDAY_DISCOVERY_LIMIT || 80);

const WORKDAY_GITHUB_QUERIES = [
  '"myworkdayjobs.com" india',
  '"myworkdayjobs.com" bangalore',
  '"myworkdayjobs.com" hyderabad',
  '"myworkdayjobs.com" india engineer',
  '"myworkdayjobs.com" india developer',
  '"myworkdayjobs.com" india hiring',
  '"myworkdayjobs.com/en-US" india',
];

// Verified Workday tenants — every (host, site) here has been confirmed to
// return a 200 OK from the CXS API. Don't add a tenant to this list without
// first probing the /wday/cxs/{tenant}/{site}/jobs endpoint manually.
//
// Why so few? Workday tenants pick custom site names per company (no public
// directory). Our earlier batch of 50 "guesses" for Indian enterprises all
// returned 422 because the guessed `site` segment didn't exist. Adding more
// here without verification just wastes time on dead URLs every cron run.
//
// New tenants come in via GitHub mining (searchWorkdayBoardCandidates) —
// when a real myworkdayjobs.com URL is referenced anywhere on GitHub, we
// pick it up automatically and the (host, site) is by definition correct.
const CURATED_WORKDAY_TENANTS = [
  // Original verified entries (pre-existing, still good)
  { host: 'adobe.wd5.myworkdayjobs.com',              site: 'external_experienced',     locale: 'en-US' },
  { host: 'paypal.wd1.myworkdayjobs.com',             site: 'jobs',                     locale: 'en-US' },
  { host: 'paloaltonetworks.wd5.myworkdayjobs.com',   site: 'panwexternalcareers',      locale: 'en-US' },
  { host: 'qualcomm.wd12.myworkdayjobs.com',          site: 'External',                 locale: 'en-US' },
  { host: 'intel.wd1.myworkdayjobs.com',              site: 'External',                 locale: 'en-US' },
  { host: 'dell.wd1.myworkdayjobs.com',               site: 'External',                 locale: 'en-US' },
  { host: 'nvidia.wd5.myworkdayjobs.com',             site: 'NVIDIAExternalCareerSite', locale: 'en-US' },

  // Verified via direct CXS API probe — confirmed to return jobs
  { host: 'walmart.wd5.myworkdayjobs.com',            site: 'WalmartExternal',          locale: 'en-US' },
  { host: 'mastercard.wd1.myworkdayjobs.com',         site: 'CorporateCareers',         locale: 'en-US' },
  { host: 'blackrock.wd1.myworkdayjobs.com',          site: 'BlackRock_Professional',   locale: 'en-US' },
  { host: 'pwc.wd3.myworkdayjobs.com',                site: 'Global_Experienced_Careers', locale: 'en-US' },
  { host: 'boeing.wd1.myworkdayjobs.com',             site: 'External_Careers',         locale: 'en-US' },
  { host: 'ms.wd5.myworkdayjobs.com',                 site: 'External',                 locale: 'en-US' }, // Morgan Stanley

  // Verified via Serper + CXS probe — subdomain matches company name
  { host: 'salesforce.wd12.myworkdayjobs.com',        site: 'External_Career_Site',      locale: 'en-US' },
  { host: 'micron.wd1.myworkdayjobs.com',             site: 'External',                  locale: 'en-US' },
  { host: 'hpe.wd5.myworkdayjobs.com',                site: 'Jobsathpe',                 locale: 'en-US' },
  { host: 'broadcom.wd1.myworkdayjobs.com',           site: 'External_Career',           locale: 'en-US' }, // VMware (acquired by Broadcom)
  { host: 'zebra.wd501.myworkdayjobs.com',            site: 'Zebra_careers',             locale: 'en-US' },
  { host: 'geaerospace.wd5.myworkdayjobs.com',        site: 'GE_ExternalSite',           locale: 'en-US' },
  { host: 'cadence.wd1.myworkdayjobs.com',            site: 'External_Careers',          locale: 'en-US' },
  { host: 'rockwellautomation.wd1.myworkdayjobs.com', site: 'External_Rockwell_Automation', locale: 'en-US' },
  { host: 'trimble.wd1.myworkdayjobs.com',            site: 'TrimbleCareers',            locale: 'en-US' },
  { host: 'visa.wd5.myworkdayjobs.com',               site: 'Visa',                      locale: 'en-US' },
  { host: 'barclays.wd3.myworkdayjobs.com',           site: 'External_Career_Site_Barclays', locale: 'en-US' },
  { host: 'citi.wd5.myworkdayjobs.com',               site: '2',                         locale: 'en-US' },
  { host: 'db.wd3.myworkdayjobs.com',                 site: 'DBWebsite',                 locale: 'en-US' }, // Deutsche Bank
  { host: 'fiserv.wd5.myworkdayjobs.com',             site: 'EXT',                       locale: 'en-US' },
  { host: 'fis.wd5.myworkdayjobs.com',                site: 'SearchJobs',                locale: 'en-US' },
  { host: 'lseg.wd3.myworkdayjobs.com',               site: 'Careers',                   locale: 'en-US' }, // Refinitiv (acquired by LSEG)
  { host: 'morningstar.wd5.myworkdayjobs.com',        site: 'Americas',                  locale: 'en-US' }
];

function isWorkdayHost(hostname) {
  return (hostname || "").toLowerCase().endsWith(".myworkdayjobs.com");
}

function extractLocaleAndSite(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const localeIndex = parts.findIndex((segment) =>
    /^[a-z]{2}-[A-Z]{2}$/i.test(segment)
  );

  if (localeIndex < 0 || !parts[localeIndex + 1]) {
    return null;
  }

  return {
    locale: parts[localeIndex],
    site: parts[localeIndex + 1]
  };
}

function normalizeWorkdayBoardUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    if (!isWorkdayHost(parsed.hostname)) {
      return null;
    }

    const route = extractLocaleAndSite(parsed.pathname);

    if (!route) {
      return null;
    }

    return `${parsed.origin}/${route.locale}/${route.site}`;
  } catch {
    return null;
  }
}

function buildWorkdayConfigFromBoardUrl(boardUrl) {
  const parsed = new URL(boardUrl);
  const route = extractLocaleAndSite(parsed.pathname);

  return {
    // Prefer the tenant segment as the company label. Workday page titles often contain
    // generic strings like "Search for Jobs / English / Sign In" which are not company names.
    companyName: parsed.hostname.split(".")[0] || null,
    host: parsed.origin,
    tenant: parsed.hostname.split(".")[0],
    site: route.site,
    locale: route.locale,
    discoveryMethod: "github-workday-discovery"
  };
}

async function isWorkdayHostReachable(boardUrl) {
  try {
    await axios.head(boardUrl, { timeout: 8000 });
    return true;
  } catch (e) {
    // 4xx responses still mean the host resolved — only network errors mean dead
    if (e.response) return true;
    return false;
  }
}

async function searchWorkdayBoardCandidates() {
  const token = process.env.GITHUB_TOKEN;
  if (!token && !process.env.SERPER_API_KEY) {
    throw new Error("GITHUB_TOKEN or SERPER_API_KEY is required for Workday discovery");
  }

  const candidates = new Map();
  let failedQueries = 0;

  // ── 1. Curated known tenants ──────────────────────────────────────────────
  for (const { host, site, locale } of CURATED_WORKDAY_TENANTS) {
    const boardUrl = `https://${host}/${locale}/${site}`;
    const key = buildDedupeKey(boardUrl);
    if (!candidates.has(key)) {
      candidates.set(key, { boardUrl, discoveredFrom: "curated-list" });
    }
  }

  // ── 2. GitHub mining — relaxed: capture hostname only, then build URL ─────
  for (const query of (token ? WORKDAY_GITHUB_QUERIES : [])) {
    try {
      const res = await axios.get("https://api.github.com/search/code", {
        params: { q: query, per_page: 100 },
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.text-match+json",
          "User-Agent": "job-map-india-discovery"
        },
        timeout: 15000
      });

      const items = res.data?.items || [];
      for (const item of items) {
        const sources = [item.html_url || ""];
        for (const match of item.text_matches || []) {
          sources.push(match.fragment || "");
        }
        for (const text of sources) {
          // First try: full URL with locale/site (most specific)
          const fullRe = /https?:\/\/([a-z0-9-]+\.myworkdayjobs\.com)\/([a-z]{2}-[A-Z]{2})\/([a-z0-9_-]+)/gi;
          let m;
          while ((m = fullRe.exec(text)) !== null) {
            const rawUrl = m[0].replace(/['">\s)]+$/, "");
            const normalizedBoardUrl = normalizeWorkdayBoardUrl(rawUrl);
            if (!normalizedBoardUrl) continue;
            const key = buildDedupeKey(normalizedBoardUrl);
            if (!candidates.has(key)) {
              candidates.set(key, { boardUrl: normalizedBoardUrl, discoveredFrom: query });
            }
          }

          // Second try: just the hostname — build a default board URL to probe later
          const hostRe = /([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)/gi;
          while ((m = hostRe.exec(text)) !== null) {
            const host = m[1].toLowerCase();
            const boardUrl = `https://${host}/en-US/External`;
            const key = buildDedupeKey(`host:${host}`);
            if (!candidates.has(key)) {
              candidates.set(key, { boardUrl, discoveredFrom: query, needsProbe: true });
            }
          }
        }
      }

      // GitHub code search rate limit: 30 req/min authenticated
      await new Promise(r => setTimeout(r, 2100));
    } catch (error) {
      failedQueries++;
      console.log(`[WORKDAY DISCOVERY] Query failed: ${query}`);
      console.log(error.message);
    }
  }

  // ── 3. Serper mining — consumes workday-board queries seeded in DB ──────────
  if (process.env.SERPER_API_KEY) {
    const serperQueries = await getDiscoveryQueries("workday-board").catch(() => []);
    for (const entry of serperQueries) {
      try {
        const res = await axios.post(
          "https://google.serper.dev/search",
          { q: entry.query, num: 10 },
          { headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" }, timeout: 15000 }
        );
        for (const r of res.data?.organic || []) {
          const rawUrl = r.link || "";
          const normalizedBoardUrl = normalizeWorkdayBoardUrl(rawUrl);
          if (!normalizedBoardUrl) continue;
          const key = buildDedupeKey(normalizedBoardUrl);
          if (!candidates.has(key)) {
            candidates.set(key, { boardUrl: normalizedBoardUrl, discoveredFrom: `serper:${entry.query}` });
          }
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        failedQueries++;
        console.log(`[WORKDAY DISCOVERY] Serper query failed: ${entry.query}: ${err.message}`);
      }
    }
  }

  // ── 4. Pre-validate: drop hosts that don't resolve (dead DNS) ────────────
  const validated = [];
  for (const candidate of candidates.values()) {
    const reachable = await isWorkdayHostReachable(candidate.boardUrl);
    if (reachable) validated.push(candidate);
    else console.log(`[WORKDAY DISCOVERY] Unreachable, skipping: ${candidate.boardUrl}`);
  }

  return {
    candidates: validated,
    failedQueries
  };
}

async function discoverAndIngestWorkdayBoards() {
  const existingSources = await CareerSource.find({
    provider: "workday",
    status: {
      $in: ["active", "needs_review"]
    }
  }).select("boardUrl");

  const knownBoardUrls = new Set(
    existingSources
      .map((source) => buildDedupeKey(source.boardUrl))
      .filter(Boolean)
  );

  const searchResult = await searchWorkdayBoardCandidates();
  const candidates = searchResult.candidates
    .filter((candidate) => !knownBoardUrls.has(buildDedupeKey(candidate.boardUrl)))
    .slice(0, MAX_DISCOVERY_CANDIDATES);
  let validatedBoards = 0;
  let ingestedBoards = 0;
  let newCompanies = 0;

  for (const candidate of candidates) {
    const config = buildWorkdayConfigFromBoardUrl(candidate.boardUrl);
    console.log(`[WORKDAY DISCOVERY] Checking ${candidate.boardUrl}`);

    try {
      const beforeCount = await Company.countDocuments({});
      const ingestedJobs = await ingestWorkdayTenant(config);
      const afterCount = await Company.countDocuments({});
      const companyDelta = Math.max(afterCount - beforeCount, 0);

      validatedBoards++;

      if (ingestedJobs > 0) {
        ingestedBoards++;
        newCompanies += companyDelta;
        console.log(
          `[WORKDAY DISCOVERY] Accepted ${candidate.boardUrl} | india jobs: ${ingestedJobs}`
        );
      } else {
        console.log(
          `[WORKDAY DISCOVERY] No India jobs from ${candidate.boardUrl}`
        );
      }
    } catch (error) {
      console.log(
        `[WORKDAY DISCOVERY] Validation failed for ${candidate.boardUrl}`
      );
      console.log(error.message);
    }
  }

  return {
    candidatesFound: candidates.length,
    failedQueries: searchResult.failedQueries,
    validatedBoards,
    ingestedBoards,
    newCompanies
  };
}

async function summarizeKnownWorkdayCompanies() {
  const companies = await Company.find({
    careersProvider: "workday"
  }).select("name careersUrl");

  return companies.map((company) => ({
    name: normalizeCompanyName(company.name),
    careersUrl: company.careersUrl
  }));
}

module.exports = {
  normalizeWorkdayBoardUrl,
  buildWorkdayConfigFromBoardUrl,
  searchWorkdayBoardCandidates,
  discoverAndIngestWorkdayBoards,
  summarizeKnownWorkdayCompanies
};
