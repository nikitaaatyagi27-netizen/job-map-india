const axios = require("axios");

const getCoords = require("../utils/geocode");
const Company = require("../models/Company");

const resolveCompanyDomain = require("../utils/companyResolver");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { cleanCompanyNameOrUnknown } = require("../utils/cleanCompanyName");
const { shouldAcceptCompanyLogo } = require("../utils/brandingResolver");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const { isGarbageCompanyName } = require("../utils/companyNameValidator");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tunables — all overridable via env
const MAX_PAGES_PER_QUERY = Math.max(
  Number(process.env.JSEARCH_MAX_PAGES_PER_QUERY || 5),
  1
);
const REQUEST_DELAY_MS = Math.max(
  Number(process.env.JSEARCH_REQUEST_DELAY_MS || 1500),
  0
);
const REQUEST_TIMEOUT_MS = 20000;
// "today" gives incremental sync — only jobs posted in the last 24h.
// Use "month" for a full historical backfill (set JSEARCH_DATE_FILTER=month).
const DATE_FILTER = process.env.JSEARCH_DATE_FILTER || "today";

// Last-seen RapidAPI quota headers — updated after every successful request.
// Exposed via getLastQuotaStatus() for the admin /quota-status endpoint.
let lastQuotaStatus = null;

// Tech queries by role × geo. JSearch returns up to 10 jobs per page.
const ROLE_TERMS = [
  "Software Engineer",
  "Software Developer",
  "Backend Developer",
  "Frontend Developer",
  "Full Stack Developer",
  "Java Developer",
  "Python Developer",
  "JavaScript Developer",
  "TypeScript Developer",
  "React Developer",
  "Node.js Developer",
  "Angular Developer",
  ".NET Developer",
  "Android Developer",
  "iOS Developer",
  "Mobile Developer",
  "Flutter Developer",
  "DevOps Engineer",
  "Cloud Engineer",
  "Site Reliability Engineer",
  "Platform Engineer",
  "Security Engineer",
  "Data Engineer",
  "Data Scientist",
  "Machine Learning Engineer",
  "ML Engineer",
  "QA Engineer",
  "SDET",
  "Engineering Manager",
  "Technical Lead",
  "Software Architect"
];

// Specialist roles run against a smaller city set to stay within API quota.
// These are domain-specific titles that rarely appear in all 12 city queries.
const SPECIALIST_ROLE_TERMS = [
  // AR/VR / Game Dev
  "AR VR Developer",
  "Unity Developer",
  "XR Engineer",
  "Game Developer",
  "Unreal Engine Developer",
  "WebXR Developer",
  "3D Developer",
  // ML / AI specialists (distinct from generic ML Engineer above)
  "Deep Learning Engineer",
  "Computer Vision Engineer",
  "NLP Engineer",
  "AI Research Engineer",
  "Generative AI Engineer",
  // Security specialists
  "Cybersecurity Engineer",
  "Penetration Tester",
  "Application Security Engineer",
  "Security Analyst",
  // Embedded / Hardware
  "Embedded Systems Engineer",
  "Firmware Engineer",
  "VLSI Engineer",
  "FPGA Engineer",
  // Blockchain
  "Blockchain Developer",
  "Web3 Developer",
  "Solidity Developer",
  // Other in-demand roles missing from main list
  "Product Manager",
  "Technical Program Manager",
  "Data Analyst",
  "Cloud Architect",
  "Solutions Architect"
];

// Specialist queries only cover the top tech hubs — less API quota waste
const SPECIALIST_GEO_TERMS = [
  "India",
  "Bangalore",
  "Hyderabad",
  "Pune",
  "Mumbai",
  "Delhi",
  "Gurugram",
  "Noida"
];

const GEO_TERMS = [
  "India",
  "Bangalore",
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Mumbai",
  "Chennai",
  "Delhi",
  "Noida",
  "Gurugram",
  "Gurgaon",      // alias still used widely in job postings
  "Kolkata",
  "Ahmedabad",
  "NCR",          // National Capital Region
  "Greater Noida",
  "Chandigarh",
  "Jaipur"
];

const blockedCompanies = [
  "linkedin",
  "indeed",
  "naukri",
  "glassdoor",
  "monster",
  "shine"
];

function buildQueries() {
  const queries = new Set();

  // Main roles × all geo terms
  for (const role of ROLE_TERMS) {
    for (const geo of GEO_TERMS) {
      queries.add(`${role} ${geo}`);
    }
  }

  // Specialist roles × top hubs only (saves quota)
  for (const role of SPECIALIST_ROLE_TERMS) {
    for (const geo of SPECIALIST_GEO_TERMS) {
      queries.add(`${role} ${geo}`);
    }
  }

  // Fresher/junior coverage
  queries.add("fresher software developer India");
  queries.add("junior developer India");
  queries.add("entry level software engineer India");
  queries.add("graduate engineer trainee India");

  return Array.from(queries);
}

// Domain quality check (preserved from prior version)
function isBetterDomain(newDomain, oldDomain) {
  if (!newDomain) return false;
  if (!oldDomain) return true;
  if (oldDomain.includes(".com") && newDomain.includes(".ai")) return true;
  if (newDomain.length < oldDomain.length) return true;
  if (oldDomain.includes("gmbh") && !newDomain.includes("gmbh")) return true;
  return false;
}

async function fetchJSearchPage(query, page) {
  try {
    const response = await axios.get(
      "https://jsearch.p.rapidapi.com/search",
      {
        params: {
          query,
          page: String(page),
          num_pages: "1",
          date_posted: DATE_FILTER
        },
        headers: {
          "X-RapidAPI-Key": process.env.RAPID_API_KEY,
          "X-RapidAPI-Host": "jsearch.p.rapidapi.com"
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    );

    // Capture RapidAPI quota headers so the admin endpoint can surface them
    const h = response.headers;
    lastQuotaStatus = {
      requestsLimit:     h["x-ratelimit-requests-limit"]     || null,
      requestsRemaining: h["x-ratelimit-requests-remaining"] || null,
      requestsReset:     h["x-ratelimit-requests-reset"]     || null,
      dateFilter:        DATE_FILTER,
      capturedAt:        new Date().toISOString()
    };

    return { jobs: response.data?.data || [], rateLimited: false };
  } catch (error) {
    if (error.response?.status === 429) {
      return { jobs: [], rateLimited: true };
    }
    console.log(`[JSEARCH] Page ${page} failed for "${query}": ${error.message}`);
    return { jobs: [], rateLimited: false };
  }
}

function getLastQuotaStatus() {
  return lastQuotaStatus;
}

async function persistJSearchJob(job) {
  let companyName = (job.employer_name || "Unknown Company").trim();
  const normalizedCompanyName = normalizeCompanyName(companyName);
  if (!normalizedCompanyName) return false;
  if (blockedCompanies.includes(normalizedCompanyName)) return false;
  if (isGarbageCompanyName(companyName)) return false;

  const domain = await resolveCompanyDomain(job);
  const employerLogo = shouldAcceptCompanyLogo(job.employer_logo, domain)
    ? job.employer_logo
    : null;

  let company = await Company.findOne({ name: normalizedCompanyName });

  if (!company) {
    const locationString =
      [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ") ||
      "India";
    const coords = await getCoords(locationString);
    const brandingName = cleanCompanyNameOrUnknown(companyName, locationString);

    company = await Company.create({
      name: normalizedCompanyName,
      logo: employerLogo,
      domain: domain || null,
      city: job.job_city,
      location: locationString,
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      source: "jsearch",
      brandingSource: "jsearch",
      brandingConfidence: "low",
      brandingReasoning: `discovered from JSearch results for ${brandingName}`
    });
    console.log(`[JSEARCH] New company: ${companyName} (${domain || "no domain"})`);
  } else {
    let updated = false;
    if (isBetterDomain(domain, company.domain)) {
      console.log(`[JSEARCH] Domain corrected: ${companyName} ${company.domain} → ${domain}`);
      company.domain = domain;
      updated = true;
    }
    if (!company.logo && employerLogo) {
      company.logo = employerLogo;
      updated = true;
    }
    if (updated) {
      company.updatedAt = new Date();
      await company.save();
    }
  }

  const expMonths = job.job_required_experience?.required_experience_in_months;
  const yearsMin = typeof expMonths === 'number' ? Math.round(expMonths / 12 * 10) / 10 : null;

  await upsertIngestedJob({
    title: job.job_title,
    company: company._id,
    location: job.job_location,
    applyLink: job.job_apply_link,
    description: job.job_description,
    source: "jsearch",
    postedDate: job.job_posted_at_datetime_utc,
    isRemote: false,
    yearsMin,
    yearsMax: null
  });

  return true;
}

const fetchJSearchJobs = async () => {
  if (!process.env.RAPID_API_KEY) {
    console.log("[JSEARCH] Skipped — RAPID_API_KEY missing");
    return;
  }

  console.log("[JSEARCH] Starting ingestion");
  const queries = buildQueries();
  console.log(`[JSEARCH] ${queries.length} queries × up to ${MAX_PAGES_PER_QUERY} pages`);

  const stats = { rawJobs: 0, savedJobs: 0, queriesRun: 0, pagesFetched: 0 };

  outer: for (const query of queries) {
    stats.queriesRun += 1;
    for (let page = 1; page <= MAX_PAGES_PER_QUERY; page += 1) {
      const { jobs, rateLimited } = await fetchJSearchPage(query, page);
      stats.pagesFetched += 1;
      if (rateLimited) {
        console.log("[JSEARCH] Rate limit hit — stopping run");
        break outer;
      }
      if (jobs.length === 0) {
        break; // no more results for this query
      }

      stats.rawJobs += jobs.length;
      for (const job of jobs) {
        try {
          const saved = await persistJSearchJob(job);
          if (saved) stats.savedJobs += 1;
        } catch (error) {
          console.log(`[JSEARCH] Persist failed: ${error.message}`);
        }
      }

      if (REQUEST_DELAY_MS > 0) {
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  console.log(
    `[JSEARCH] Done | queries: ${stats.queriesRun} | pages: ${stats.pagesFetched} | raw: ${stats.rawJobs} | saved: ${stats.savedJobs}`
  );
};

module.exports = { fetchJSearchJobs, getLastQuotaStatus };
