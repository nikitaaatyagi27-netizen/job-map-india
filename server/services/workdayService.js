const fs = require("fs");
const axios = require("axios");
const puppeteer = require("puppeteer-core");

const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");
const WorkdayTenantConfig = require("../models/WorkdayTenantConfig");
const getCoords = require("../utils/geocode");
const extractDomain = require("../utils/extractDomain");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const {
  cleanCompanyName,
  cleanCompanyNameOrUnknown,
  fromSiteSegment,
  fromHost,
  isGenericCompanyName
} = require("../utils/cleanCompanyName");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const { syncATSCompanySignals } = require("./atsConnectorService");
const { isIndianLocation } = require("../utils/indiaLocation");

// Workday's CXS (Career Experience Site) JSON API. Every Workday tenant
// exposes this endpoint — no Puppeteer required, ~10x faster, ~9x more
// reliable than browser-based scraping.
const WORKDAY_API_TIMEOUT_MS = 20000;
const WORKDAY_API_PAGE_SIZE = 20; // Workday's hard cap per page
// 250 pages × 20 = 5000 jobs scanned per tenant. Covers most tenants fully
// (Walmart 2000, BlackRock 518, Mastercard 1244 all complete; PwC 4950 just
// fits). Tenants with >5000 jobs will miss the tail. Bump for thoroughness,
// reduce for speed.
const WORKDAY_API_MAX_PAGES = Math.max(
  Number(process.env.WORKDAY_API_MAX_PAGES || 250),
  1
);


function isIndiaLocation(location) {
  return isIndianLocation(location);
}

function normalizeHost(host) {
  return (host || "").replace(/\/+$/, "");
}

function getWorkdayLocale(config) {
  return config.locale || "en-US";
}

function buildListingPageUrl(config) {
  return `${normalizeHost(config.host)}/${getWorkdayLocale(config)}/${config.site}`;
}

function buildJobUrl(config, path) {
  if (!path) {
    return null;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${normalizeHost(config.host)}${path}`;
}

function getBrowserExecutablePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildWorkdayConfigFromBoardUrl(boardUrl, overrides = {}) {
  const parsed = new URL(boardUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const locale = parts[0] || "en-US";
  const site = parts[1];
  const hostnameTenant = parsed.hostname.split(".")[0] || null;
  const companyName = hostnameTenant && !isGenericCompanyName(hostnameTenant)
    ? hostnameTenant
    : null;

  return {
    companyName: overrides.companyName && !isGenericCompanyName(overrides.companyName)
      ? overrides.companyName
      : companyName,
    host: parsed.origin,
    tenant: hostnameTenant,
    site,
    locale,
    discoveryMethod: overrides.discoveryMethod || "career-source-registry"
  };
}

function parseLabeledValue(text, label) {
  const lines = (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const labelIndex = lines.findIndex(
    (line) => line.toLowerCase() === label.toLowerCase()
  );

  if (labelIndex >= 0 && lines[labelIndex + 1]) {
    return lines[labelIndex + 1];
  }

  return null;
}

function inferLocationFromJobUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const jobIndex = parts.findIndex((part) => part === "job");

    if (jobIndex >= 0 && parts[jobIndex + 1]) {
      return parts[jobIndex + 1].replace(/-/g, " ");
    }
  } catch {
    return null;
  }

  return null;
}

function classifyWorkdayError(error) {
  const message =
    error?.message ||
    error?.toString?.() ||
    "Unknown Workday error";

  if (/ETIMEDOUT|ENOTFOUND|ERR_CONNECTION_RESET|ECONNABORTED|ECONNRESET/i.test(message)) {
    return {
      severity: "warning",
      status: "active",
      reason: "transient-network",
      message: "Transient network issue while calling this board's CXS API"
    };
  }

  // CXS API returned a non-2xx status — tenant URL/site likely misconfigured
  const apiStatusMatch = message.match(/Workday API (\d{3})/);
  if (apiStatusMatch) {
    const status = Number(apiStatusMatch[1]);
    return {
      severity: "warning",
      status: "needs_review",
      reason: status === 404 ? "wrong-site-or-tenant" : "api-error",
      message: `CXS API returned ${status} — check tenant/site configuration`
    };
  }

  if (/Waiting for selector/i.test(message)) {
    return {
      severity: "warning",
      status: "needs_review",
      reason: "parser-mismatch",
      message: "Legacy Puppeteer selector did not match (should not happen post-CXS-refactor)"
    };
  }

  return {
    severity: "warning",
    status: "needs_review",
    reason: "unknown",
    message
  };
}

// Build the CXS JSON API endpoint for a tenant's job search.
function buildJobsApiUrl(config) {
  return `${normalizeHost(config.host)}/wday/cxs/${config.tenant}/${config.site}/jobs`;
}

// One paginated POST to the CXS jobs endpoint, with exponential backoff + jitter.
// Retries on transient network errors (timeout, reset, 5xx) but not on 4xx —
// those indicate a misconfigured tenant and should surface immediately.
async function callWorkdayJobsApi(config, body, maxRetries = 3) {
  const url = buildJobsApiUrl(config);
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(url, body, {
        timeout: WORKDAY_API_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; JobMapBot/1.0)"
        },
        validateStatus: (status) => status < 500
      });

      if (response.status >= 400) {
        throw new Error(`Workday API ${response.status} for ${url}`);
      }

      return response.data || {};
    } catch (err) {
      lastError = err;
      // 4xx = bad tenant config, not a transient error — don't retry
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s — plus up to 800ms random jitter
        const delay = (2 ** attempt) * 1000 + Math.random() * 800;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

// Convert a single CXS jobPosting into the shape the rest of workdayService
// expects (matches the old Puppeteer scraper output).
function normalizeWorkdayJobPosting(config, posting) {
  const externalPath = posting?.externalPath || posting?.url || null;
  const href = externalPath ? buildJobUrl(config, externalPath) : null;
  const location = posting?.locationsText || posting?.location || "";
  return {
    title: posting?.title || null,
    href,
    location,
    employmentType: posting?.timeType || null,
    postedOn: posting?.postedOn || null,
    jobId: posting?.bulletFields?.[0] || null
  };
}

// Fetch all India jobs for a tenant via the CXS JSON API.
//
// Strategy: paginate through every job (up to WORKDAY_API_MAX_PAGES * 20),
// then filter locally with isIndianLocation. We tried server-side facet
// filtering first, but Workday tenants vary too widely in how they expose
// the country facet — many don't have it at all, others nest it inside
// `locationMainGroup` with no exposed UUID. Local filtering using our
// comprehensive India classifier (states + cities + aliases + NCR) is the
// only approach that works on every tenant.
async function fetchWorkdayBoardViaApi(config) {
  const seenLinks = new Set();
  const allJobs = [];
  let totalReported = 0;

  for (let page = 0; page < WORKDAY_API_MAX_PAGES; page += 1) {
    const offset = page * WORKDAY_API_PAGE_SIZE;
    if (totalReported && offset >= totalReported) break;

    const data = await callWorkdayJobsApi(config, {
      appliedFacets: {},
      limit: WORKDAY_API_PAGE_SIZE,
      offset,
      searchText: ""
    });

    if (page === 0 && Number.isFinite(data.total)) {
      totalReported = data.total;
    }

    const postings = data.jobPostings || data.jobs || [];
    if (postings.length === 0) break;

    for (const posting of postings) {
      const normalized = normalizeWorkdayJobPosting(config, posting);
      if (!normalized.href || seenLinks.has(normalized.href)) continue;
      seenLinks.add(normalized.href);
      allJobs.push(normalized);
    }

    if (postings.length < WORKDAY_API_PAGE_SIZE) break; // last page
  }

  // Apply our comprehensive India classifier (states, cities, NCR, aliases)
  const indiaJobs = allJobs.filter((job) => isIndiaLocation(job.location));

  // Cache the per-tenant outcome for the inspect/health view + for future
  // smarter prioritization (if a tenant returns 0 India jobs over multiple
  // runs, we can deprioritize or drop them).
  WorkdayTenantConfig.findOneAndUpdate(
    {
      host: new URL(config.host).hostname.toLowerCase(),
      site: config.site
    },
    {
      $set: {
        tenant: config.tenant,
        locale: config.locale || "en-US",
        lastIndiaJobCount: indiaJobs.length,
        lastSyncedAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch(() => null);

  return { jobs: indiaJobs, boardMetadata: {}, totalReported };
}

async function scrapeWorkdayRenderedBoard(config) {
  const executablePath = getBrowserExecutablePath();

  if (!executablePath) {
    throw new Error(
      "No Chrome or Edge executable found. Set CHROME_PATH in server/.env."
    );
  }

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath
  });

  try {
    const page = await browser.newPage();
    await page.goto(buildListingPageUrl(config), {
      waitUntil: "networkidle2",
      timeout: 120000
    });

    await page.waitForSelector('section[data-automation-id="jobResults"]', {
      timeout: 30000
    });

    const jobs = [];
    const seenLinks = new Set();
    const boardMetadata = await page.evaluate(() => {
      const titleText =
        document.querySelector("title")?.textContent?.trim() || null;
      const headerText = Array.from(
        document.querySelectorAll("header, h1, h2, [data-automation-id]")
      )
        .map((node) => node.textContent?.trim() || "")
        .find((text) => /career|jobs/i.test(text) && text.length < 120);

      return {
        titleText,
        headerText: headerText || null
      };
    });

    while (true) {
      await page.waitForSelector('a[data-automation-id="jobTitle"]', {
        timeout: 30000
      });

      const pageJobs = await page.evaluate(() => {
        const items = Array.from(
          document.querySelectorAll('section[data-automation-id="jobResults"] li')
        );

        return items
          .filter((item) => item.querySelector('a[data-automation-id="jobTitle"]'))
          .map((item) => {
            const titleLink = item.querySelector('a[data-automation-id="jobTitle"]');
            const title = titleLink?.textContent?.trim() || null;
            const href = titleLink?.getAttribute("href") || null;
            const location = item.querySelector('[data-automation-id="locations"]')?.innerText || "";
            const time = item.querySelector('[data-automation-id="time"]')?.innerText || "";
            const postedOn = item.querySelector('[data-automation-id="postedOn"]')?.innerText || "";
            const subtitle = item.querySelector('[data-automation-id="subtitle"]')?.innerText || "";

            return {
              title,
              href,
              location,
              time,
              postedOn,
              subtitle
            };
          });
      });

      for (const job of pageJobs) {
        if (!job.href || seenLinks.has(job.href)) {
          continue;
        }

        seenLinks.add(job.href);
        jobs.push({
          title: job.title,
          href: buildJobUrl(config, job.href),
          location:
            parseLabeledValue(job.location, "locations") ||
            inferLocationFromJobUrl(buildJobUrl(config, job.href)),
          employmentType: parseLabeledValue(job.time, "time type"),
          postedOn: parseLabeledValue(job.postedOn, "posted on"),
          jobId: (job.subtitle || "").trim() || null
        });
      }

      const nextButtonState = await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (candidate) => candidate.getAttribute("aria-label") === "next"
        );

        return {
          exists: Boolean(button),
          disabled: Boolean(
            button &&
              (button.disabled ||
                button.getAttribute("aria-disabled") === "true")
          )
        };
      });

      if (!nextButtonState.exists || nextButtonState.disabled) {
        break;
      }

      await Promise.all([
        page.waitForNetworkIdle({
          idleTime: 1000,
          timeout: 30000
        }).catch(() => null),
        page.evaluate(() => {
          const button = Array.from(document.querySelectorAll("button")).find(
            (candidate) => candidate.getAttribute("aria-label") === "next"
          );

          if (button) {
            button.click();
          }
        })
      ]);
    }

    return {
      boardMetadata,
      jobs
    };
  } finally {
    await browser.close();
  }
}

async function scrapeWorkdayRenderedJobs(config) {
  const board = await scrapeWorkdayRenderedBoard(config);
  return board.jobs;
}

// Public entry point used by the discovery service and scripts/testWorkdayTenant.js.
// Now backed by the CXS JSON API instead of Puppeteer — same shape, much faster.
async function fetchWorkdayTenant(config) {
  const board = await fetchWorkdayBoardViaApi(config);
  return board.jobs;
}

function inferCompanyNameFromBoard(config, boardMetadata = {}) {
  const explicitName = config.companyName?.trim();

  if (explicitName) {
    const cleaned = cleanCompanyName(explicitName, config.host);
    if (cleaned && !isGenericCompanyName(cleaned)) {
      return cleaned;
    }
  }

  const siteBasedName = fromSiteSegment(config.site);
  if (siteBasedName) {
    return siteBasedName;
  }

  const metadataCandidates = [
    boardMetadata.headerText,
    boardMetadata.titleText
  ];

  for (const candidate of metadataCandidates) {
    if (!candidate) {
      continue;
    }

    const cleanedCandidate = cleanCompanyName(candidate, config.tenant);

    if (cleanedCandidate && !isGenericCompanyName(cleanedCandidate)) {
      return cleanedCandidate;
    }
  }

  try {
    const hostname = new URL(config.host).hostname;
    // Workday titles/headers frequently contain generic UI text ("Search for Jobs", "English", "Sign In").
    // The tenant segment is the most reliable company identifier for Workday boards.
    const hostName = fromHost(hostname);

    if (hostName && !isGenericCompanyName(hostName)) {
      return hostName;
    }

    return null;
  } catch {
    const fallback = cleanCompanyNameOrUnknown(config.tenant, config.host);
    return fallback && !isGenericCompanyName(fallback) ? fallback : null;
  }
}

async function ingestWorkdayTenant(config) {
  const board = await fetchWorkdayBoardViaApi(config);
  const jobs = board.jobs;

  // fetchWorkdayBoardViaApi already filtered to India locally — these are
  // the jobs we'll persist. Cache update is also done inside the fetcher.
  const indiaJobs = jobs;

  const companyName = cleanCompanyNameOrUnknown(
    inferCompanyNameFromBoard(config, board.boardMetadata),
    config.host
  );
  if (!companyName || isGenericCompanyName(companyName)) {
    throw new Error(
      `Unable to infer a valid Workday company name for ${buildListingPageUrl(config)}`
    );
  }
  const normalizedCompanyName = normalizeCompanyName(companyName);
  const primaryLocation =
    indiaJobs[0]?.location ||
    "India";

  console.log(`${companyName}: ${indiaJobs.length} India jobs`);

  let company = await Company.findOne({
    name: normalizedCompanyName
  });

  if (!company) {
    const coords = await getCoords(primaryLocation);

    company = await Company.create({
      name: normalizedCompanyName,
      logo: null,
      domain: extractDomain({
        employer_name: companyName,
        job_apply_link: buildListingPageUrl(config)
      }),
      city: primaryLocation,
      location: primaryLocation,
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      source: "workday"
    });

    console.log("New Workday company:", companyName);
  }

  await syncATSCompanySignals({
    company,
    companyName,
    provider: "workday",
    boardUrl: buildListingPageUrl(config),
    careersUrl: buildListingPageUrl(config),
    website: company.website || null,
    domain: company.domain || null,
    discoverySource: "workday",
    discoveryMethod: config.discoveryMethod || "verified-workday-config",
    parserType: "workday-cxs-api",
    jobsFound: indiaJobs.length,
    status: "active"
  });

  for (const job of indiaJobs) {
    const location = job.location || "India";

    await upsertIngestedJob({
      title: job.title,
      company: company._id,
      location,
      applyLink: job.href,
      description: job.employmentType || null,
      source: "workday",
      postedDate: null,
      isRemote: false
    });
  }

  return indiaJobs.length;
}

async function fetchWorkdayJobs() {
  console.log("Fetching Workday jobs");

  let totalIndiaJobs = 0;
  const activeCareerSources = await CareerSource.find({
    provider: "workday",
    status: "active"
  }).select("companyName boardUrl discoveryMethod");

  const configMap = new Map();

  for (const source of activeCareerSources) {
    if (!source.boardUrl) {
      continue;
    }

    const boardConfig = buildWorkdayConfigFromBoardUrl(source.boardUrl, {
      companyName: source.companyName,
      discoveryMethod: source.discoveryMethod || "career-source-registry"
    });

    configMap.set(source.boardUrl, boardConfig);
  }

  for (const config of configMap.values()) {
    try {
      const ingestedCount = await ingestWorkdayTenant(config);
      totalIndiaJobs += ingestedCount;
    } catch (error) {
      const boardUrl = buildListingPageUrl(config);
      const companyLabel = config.companyName || boardUrl;
      const classified = classifyWorkdayError(error);

      console.log(
        `[WORKDAY] Skipping ${companyLabel} | ${classified.reason} | ${classified.message}`
      );

      await CareerSource.findOneAndUpdate(
        {
          provider: "workday",
          boardUrl
        },
        {
          $set: {
            status: classified.status,
            lastCheckedAt: new Date(),
            lastError: error.message,
            lastFailureAt: new Date(),
            updatedAt: new Date()
          },
          $inc: {
            failureCount: 1
          }
        }
      ).catch(() => null);
    }
  }

  console.log(`Workday ingestion complete. India jobs processed: ${totalIndiaJobs}`);
  return totalIndiaJobs;
}

module.exports = {
  buildListingPageUrl,
  buildJobUrl,
  buildWorkdayConfigFromBoardUrl,
  getBrowserExecutablePath,
  inferCompanyNameFromBoard,
  scrapeWorkdayRenderedBoard,
  scrapeWorkdayRenderedJobs,
  fetchWorkdayTenant,
  ingestWorkdayTenant,
  fetchWorkdayJobs
};
