const axios = require("axios");

const Company = require("../models/Company");
const getCoords = require("../utils/geocode");
const extractDomain = require("../utils/extractDomain");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { cleanCompanyNameOrUnknown } = require("../utils/cleanCompanyName");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const { isGarbageCompanyName } = require("../utils/companyNameValidator");

const REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs";

const indiaLocationHints = ["india", "remote", "worldwide", "asia", "apac"];

// Pre-filtered queries: each entry hits Remotive's API with ?category + ?search,
// so the server does the filtering — we only receive relevant results.
// Deduplicated by job ID across all queries.
const REMOTIVE_QUERIES = [
  { category: "software-dev",    search: "engineer" },
  { category: "software-dev",    search: "developer" },
  { category: "devops",          search: "devops" },
  { category: "devops",          search: "cloud" },
  { category: "data",            search: "data" },
  { category: "data",            search: "machine learning" },
  { category: "qa",              search: "qa" },
  { category: "backend",         search: "backend" },
  { category: "frontend",        search: "frontend" },
  { category: "security",        search: "security" },
  { category: "product",         search: "product manager" }
];

function isIndiaRelevantLocation(job) {
  const location = `${job.candidate_required_location || ""}`.toLowerCase();
  return indiaLocationHints.some((hint) => location.includes(hint));
}

async function fetchRemotiveJobs() {
  try {
    console.log("Fetching Remotive jobs");

    const seenIds = new Set();
    const relevantJobs = [];

    for (const { category, search } of REMOTIVE_QUERIES) {
      let response;
      try {
        response = await axios.get(REMOTIVE_API_URL, {
          params: { category, search },
          timeout: 30000
        });
      } catch (err) {
        console.log(`[REMOTIVE] Query ${category}/${search} failed: ${err.message}`);
        continue;
      }

      for (const job of response.data?.jobs || []) {
        if (!job.id || seenIds.has(job.id)) continue;
        if (!isIndiaRelevantLocation(job)) continue;
        seenIds.add(job.id);
        relevantJobs.push(job);
      }
    }

    console.log(`Remotive: ${relevantJobs.length} India/remote tech jobs`);

    for (const job of relevantJobs) {
      const companyName = job.company_name || "Unknown Company";
      if (isGarbageCompanyName(companyName)) continue;
      const normalizedCompanyName = normalizeCompanyName(companyName);
      const location = job.candidate_required_location || "India";

      let company = await Company.findOne({
        name: normalizedCompanyName
      });

      if (!company) {
        const coords = await getCoords(
          location.toLowerCase().includes("remote") ? "India" : location
        );
        const brandingName = cleanCompanyNameOrUnknown(companyName, location);

        company = await Company.create({
          name: normalizedCompanyName,
          logo: null,
          domain: extractDomain({
            employer_name: companyName,
            job_apply_link: job.url
          }),
          city: location,
          location,
          lat: coords?.lat || null,
          lng: coords?.lng || null,
          source: "remotive",
          isRemote: true,
          brandingSource: "remotive",
          brandingConfidence: "low",
          brandingReasoning: `discovered from Remotive jobs for ${brandingName}`
        });

        console.log("New Remotive company:", companyName);
      }

      await upsertIngestedJob({
        title: job.title,
        company: company._id,
        location,
        applyLink: job.url,
        description: job.description || null,
        source: "remotive",
        postedDate: job.publication_date || null,
        isRemote: true
      });
    }

    console.log("Remotive ingestion complete");
  } catch (error) {
    console.log("Remotive service error");
    console.log(error.message);
  }
}

module.exports = fetchRemotiveJobs;
