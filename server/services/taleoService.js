// Oracle Taleo career site ingestion.
// Taleo is the dominant ATS for Indian IT services companies (Wipro, etc.)
// and many global MNCs. The public REST API requires no authentication.
//
// To find tenant IDs: node server/scripts/probeTaleoTenants.js
// then paste results into CURATED_TALEO_TENANTS below.

const axios = require('axios');

const Company = require('../models/Company');
const { upsertIngestedJob } = require('../utils/jobPersistence');
const getCoords = require('../utils/geocode');
const normalizeCompanyName = require('../utils/normalizeCompanyName');
const { isIndianLocation } = require('../utils/indiaLocation');

const TALEO_TIMEOUT_MS = 20000;
// 100 is the max most Taleo versions accept; falls back to 25 if the tenant
// rejects the larger limit (the API returns whatever it can regardless).
const TALEO_PAGE_SIZE  = Number(process.env.TALEO_PAGE_SIZE || 100);
const TALEO_MAX_PAGES  = Number(process.env.TALEO_MAX_PAGES || 40); // 40×100 = 4000 jobs/tenant

// Verified tenants — run node server/scripts/probeTaleoTenants.js to populate
const CURATED_TALEO_TENANTS = [
  // ── populated after running the probe script ───────────────────────────────
  // { tenant: 'wiproltd', companyName: 'Wipro' },
  // { tenant: 'capgemini', companyName: 'Capgemini' },
  // etc.
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

const TALEO_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

// Taleo REST API — returns requisition list with pagination
async function fetchTaleoPage(tenant, start) {
  const url = `https://${tenant}.taleo.net/careersection/rest/jobboard/requisition/list`;
  try {
    const res = await axios.get(url, {
      params: { start, limit: TALEO_PAGE_SIZE, lang: 'en' },
      headers: TALEO_HEADERS,
      timeout: TALEO_TIMEOUT_MS
    });
    // Response shapes: { requisitionList: [...], totalCount: N }
    //              or  { jobs: [...], total: N }
    const jobs  = res.data?.requisitionList ?? res.data?.jobs ?? [];
    const total = res.data?.totalCount ?? res.data?.total ?? (Array.isArray(jobs) ? jobs.length : 0);
    return { jobs: Array.isArray(jobs) ? jobs : [], total: Number(total) };
  } catch (err) {
    console.log(`[TALEO] Page @${start} failed for ${tenant}: ${err.message}`);
    return { jobs: [], total: 0 };
  }
}

// Normalize raw Taleo job to consistent shape
function normalizeJob(raw, tenant, companyName) {
  // Taleo field names vary by version
  const title    = raw.title || raw.jobTitle || raw.externalTitle || '';
  const city     = raw.city  || raw.location?.city   || raw.primaryLocation || '';
  const country  = raw.country || raw.location?.country || '';
  const state    = raw.state  || raw.location?.state  || '';
  const location = [city, state, country].filter(Boolean).join(', ') || 'India';
  const jobId    = raw.contestNo || raw.id || raw.requisitionId || raw.jobReqId || '';
  const applyUrl =
    raw.applyUrl ||
    raw.applyFlowUrl ||
    `https://${tenant}.taleo.net/careersection/10/jobdetail.ftl?job=${jobId}`;
  const company  = raw.company || raw.companyName || companyName;

  return { title, city, country, location, applyUrl, jobId, company };
}

function isIndia(job) {
  return isIndianLocation(`${job.city} ${job.state || ''} ${job.country} ${job.location}`);
}

async function ingestTaleoTenant({ tenant, companyName }) {
  const label = companyName || tenant;

  // Fetch first page to get total
  const first = await fetchTaleoPage(tenant, 0);
  if (first.total === 0 && first.jobs.length === 0) {
    console.log(`[TALEO] ${label} — no jobs returned`);
    return 0;
  }

  const totalJobs  = first.total || first.jobs.length;
  const totalPages = Math.min(Math.ceil(totalJobs / TALEO_PAGE_SIZE), TALEO_MAX_PAGES);
  console.log(`[TALEO] ${label} — total: ${totalJobs}, pages: ${totalPages}`);

  const allJobs = [...first.jobs];
  for (let page = 1; page < totalPages; page++) {
    const result = await fetchTaleoPage(tenant, page * TALEO_PAGE_SIZE);
    allJobs.push(...result.jobs);
    if (result.jobs.length === 0) break;
    await sleep(600);
  }

  const indiaJobs = allJobs
    .map(raw => normalizeJob(raw, tenant, companyName))
    .filter(isIndia);

  if (indiaJobs.length === 0) {
    console.log(`[TALEO] ${label} — 0 India jobs (total: ${allJobs.length})`);
    return 0;
  }

  const normalizedName = normalizeCompanyName(companyName || tenant);
  if (!normalizedName) return 0;

  let company = await Company.findOne({ name: normalizedName });

  if (!company) {
    const sampleCity = indiaJobs[0]?.city || 'India';
    const coords = await getCoords(sampleCity);
    company = await Company.create({
      name: normalizedName,
      logo: null,
      domain: null,
      website: `https://${tenant}.taleo.net`,
      careersUrl: `https://${tenant}.taleo.net/careersection/10/jobsearch.ftl`,
      careersProvider: 'taleo',
      discoverySources: ['taleo'],
      intelligenceStatus: 'direct-source-linked',
      source: 'taleo',
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null
    });
    console.log(`[TALEO] New company: ${normalizedName}`);
  }

  let saved = 0;
  for (const job of indiaJobs) {
    try {
      await upsertIngestedJob({
        title: job.title,
        company: company._id,
        location: job.location,
        applyLink: job.applyUrl,
        source: 'taleo',
        externalId: job.jobId || undefined,
        isRemote: false
      });
      saved++;
    } catch (err) {
      console.log(`[TALEO] Persist failed: ${err.message}`);
    }
  }

  console.log(`[TALEO] ${label} — saved ${saved} India jobs`);
  return saved;
}

async function fetchTaleoJobs() {
  if (CURATED_TALEO_TENANTS.length === 0) {
    console.log('[TALEO] No tenants configured — run probeTaleoTenants.js to find them');
    return;
  }

  console.log(`[TALEO] Starting ingestion — ${CURATED_TALEO_TENANTS.length} tenants`);
  let total = 0;

  for (const tenant of CURATED_TALEO_TENANTS) {
    try {
      total += await ingestTaleoTenant(tenant);
    } catch (err) {
      console.log(`[TALEO] Tenant ${tenant.tenant} failed: ${err.message}`);
    }
    await sleep(1200);
  }

  console.log(`[TALEO] Done — ${total} India jobs across ${CURATED_TALEO_TENANTS.length} tenants`);
}

module.exports = { fetchTaleoJobs, ingestTaleoTenant };
