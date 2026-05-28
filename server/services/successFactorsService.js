// SAP SuccessFactors career site ingestion.
// SuccessFactors exposes a public JSON API at every tenant's jobs.ondemand.com
// domain — no browser scraping required.
//
// To add more tenants: run node server/scripts/probeSuccessFactorsTenants.js
// and paste the output into CURATED_SF_TENANTS below.

const axios = require('axios');

const Company = require('../models/Company');
const { upsertIngestedJob } = require('../utils/jobPersistence');
const getCoords = require('../utils/geocode');
const normalizeCompanyName = require('../utils/normalizeCompanyName');
const { isIndianLocation } = require('../utils/indiaLocation');

const SF_API_TIMEOUT_MS = 20000;
const SF_PAGE_SIZE      = 100;  // SF career API max per page
const SF_MAX_PAGES      = Number(process.env.SF_MAX_PAGES || 50); // 50 × 100 = 5000 jobs/tenant
// Set SF_SINCE_DAYS=3 to only fetch jobs posted in the last N days (delta sync).
// Cuts API calls by ~80% on subsequent runs. Leave unset for a full fetch.
const SF_SINCE_DAYS     = Number(process.env.SF_SINCE_DAYS || 0);

function getSFStartDate() {
  if (!SF_SINCE_DAYS) return null;
  const d = new Date(Date.now() - SF_SINCE_DAYS * 86400000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Verified tenants — each (subdomain) has been confirmed to return jobs from
// the SuccessFactors public career API. Run probeSuccessFactorsTenants.js to
// discover new tenants and paste the output here.
const CURATED_SF_TENANTS = [
  // ── populated after running node server/scripts/probeSuccessFactorsTenants.js ──
  // { subdomain: 'wipro',      companyName: 'Wipro' },
  // { subdomain: 'hcltech',   companyName: 'HCL Technologies' },
  // { subdomain: 'capgemini', companyName: 'Capgemini' },
  // etc.
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Extract jobs from the SF API response — handles both response shapes used
// across different SF versions:
//   • { totalCount: N, jobs: [...] }         (newer)
//   • { total: N, reqList: [...] }           (older)
function parseResponse(data) {
  const total = data?.totalCount ?? data?.total ?? 0;
  const jobs  = data?.jobs ?? data?.reqList ?? [];
  return { total: Number(total), jobs: Array.isArray(jobs) ? jobs : [] };
}

// Normalize a raw SF job object to a consistent shape
function normalizeJob(raw, subdomain, companyName) {
  const title   = raw.externalTitle || raw.title || raw.name || '';
  const city    = raw.city  || raw.location || '';
  const country = raw.country || '';
  const applyUrl =
    raw.applyUrl ||
    raw.applyButtonUrl ||
    raw.jobUrl ||
    `https://${subdomain}.jobs.ondemand.com`;
  const jobId   = raw.jobReqId || raw.id || raw.requisitionId || '';
  const company = raw.company || raw.companyName || companyName;
  const location = [city, country].filter(Boolean).join(', ') || 'India';

  return { title, city, country, location, applyUrl, jobId, company };
}

function isIndia(job) {
  return isIndianLocation(`${job.city} ${job.country} ${job.location}`);
}

async function fetchSFPage(subdomain, page, startDate = null) {
  const url = `https://${subdomain}.jobs.ondemand.com/api/jobs/v1/jobs`;
  try {
    const params = { pageSize: SF_PAGE_SIZE, page };
    if (startDate) params['$filter'] = `startDate gt '${startDate}'`;
    const res = await axios.get(url, {
      params,
      headers: { Accept: 'application/json' },
      timeout: SF_API_TIMEOUT_MS
    });
    return parseResponse(res.data);
  } catch (err) {
    console.log(`[SF] Page ${page} failed for ${subdomain}: ${err.message}`);
    return { total: 0, jobs: [] };
  }
}

async function ingestSFTenant({ subdomain, companyName }) {
  const label = companyName || subdomain;
  let indiaJobCount = 0;

  const startDate = getSFStartDate();
  if (startDate) {
    console.log(`[SF] ${label} — delta sync, fetching jobs since ${startDate}`);
  }

  // Fetch page 1 to get total, then paginate.
  // If delta filter returns nothing but a full fetch would have results, fall back.
  let first = await fetchSFPage(subdomain, 1, startDate);
  if (first.total === 0 && first.jobs.length === 0 && startDate) {
    console.log(`[SF] ${label} — delta returned 0, retrying without date filter`);
    first = await fetchSFPage(subdomain, 1, null);
  }
  if (first.total === 0 && first.jobs.length === 0) {
    console.log(`[SF] ${label} — no jobs returned from API`);
    return 0;
  }

  const totalPages = Math.min(
    Math.ceil(first.total / SF_PAGE_SIZE),
    SF_MAX_PAGES
  );

  console.log(`[SF] ${label} — total jobs: ${first.total}, pages to fetch: ${totalPages}`);

  const allPages = [first];
  for (let page = 2; page <= totalPages; page++) {
    const result = await fetchSFPage(subdomain, page, startDate);
    allPages.push(result);
    if (result.jobs.length === 0) break;
    await sleep(500);
  }

  const allJobs = allPages.flatMap(p => p.jobs);
  const indiaJobs = allJobs
    .map(raw => normalizeJob(raw, subdomain, companyName))
    .filter(isIndia);

  if (indiaJobs.length === 0) {
    console.log(`[SF] ${label} — 0 India jobs (total: ${allJobs.length})`);
    return 0;
  }

  // Find or create the company in DB
  const normalizedName = normalizeCompanyName(companyName || subdomain);
  if (!normalizedName) return 0;

  let company = await Company.findOne({ name: normalizedName });

  if (!company) {
    const sampleCity = indiaJobs[0]?.city || 'India';
    const coords = await getCoords(sampleCity);
    company = await Company.create({
      name: normalizedName,
      logo: null,
      domain: null,
      website: `https://${subdomain}.jobs.ondemand.com`,
      careersUrl: `https://${subdomain}.jobs.ondemand.com`,
      careersProvider: 'successfactors',
      discoverySources: ['successfactors'],
      intelligenceStatus: 'direct-source-linked',
      source: 'successfactors',
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null
    });
    console.log(`[SF] New company: ${normalizedName}`);
  }

  for (const job of indiaJobs) {
    try {
      await upsertIngestedJob({
        title: job.title,
        company: company._id,
        location: job.location,
        applyLink: job.applyUrl,
        source: 'successfactors',
        externalId: job.jobId || undefined,
        isRemote: false
      });
      indiaJobCount++;
    } catch (err) {
      console.log(`[SF] Persist failed for ${job.title}: ${err.message}`);
    }
  }

  console.log(`[SF] ${label} — saved ${indiaJobCount} India jobs`);
  return indiaJobCount;
}

async function fetchSuccessFactorsJobs() {
  if (CURATED_SF_TENANTS.length === 0) {
    console.log('[SF] No tenants configured — run probeSuccessFactorsTenants.js to find them');
    return;
  }

  console.log(`[SF] Starting ingestion — ${CURATED_SF_TENANTS.length} tenants`);
  let total = 0;

  for (const tenant of CURATED_SF_TENANTS) {
    try {
      total += await ingestSFTenant(tenant);
    } catch (err) {
      console.log(`[SF] Tenant ${tenant.subdomain} failed: ${err.message}`);
    }
    await sleep(1000);
  }

  console.log(`[SF] Done — ${total} India jobs ingested across ${CURATED_SF_TENANTS.length} tenants`);
}

module.exports = { fetchSuccessFactorsJobs, ingestSFTenant };
