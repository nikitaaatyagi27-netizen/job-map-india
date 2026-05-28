const axios = require("axios");

const Company = require("../models/Company");
const extractDomain = require("../utils/extractDomain");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { cleanCompanyNameOrUnknown } = require("../utils/cleanCompanyName");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const getCoords = require("../utils/geocode");
const { isIndianLocation } = require("../utils/indiaLocation");

const isIndiaOrRemote = (location, isRemote) =>
  isIndianLocation(location, { hasIndianPresence: isRemote === true });

// Server-side tag filtering cuts bandwidth by only fetching relevant categories.
// Arbeitnow supports ?tag= as a query param — we run one request per tag and
// deduplicate by slug so jobs that appear under multiple tags are only processed once.
const ARBEITNOW_TAGS = [
  "software-development",
  "devops-sysadmin",
  "data-science",
  "cybersecurity"
];

const fetchArbeitnowJobs = async () => {
  try {
    console.log("[ARBEITNOW] Fetching Arbeitnow jobs");

    const seenSlugs = new Set();
    const techIndiaJobs = [];

    for (const tag of ARBEITNOW_TAGS) {
      let response;
      try {
        response = await axios.get("https://www.arbeitnow.com/api/job-board-api", {
          params: { tag }
        });
      } catch (err) {
        console.log(`[ARBEITNOW] Tag "${tag}" fetch failed: ${err.message}`);
        continue;
      }

      const jobs = response.data?.data || [];
      for (const job of jobs) {
        const slug = job.slug || job.url;
        if (!slug || seenSlugs.has(slug)) continue;
        if (!isIndiaOrRemote(job.location, job.remote === true)) continue;
        seenSlugs.add(slug);
        techIndiaJobs.push(job);
      }
    }

    console.log(`[ARBEITNOW] ${techIndiaJobs.length} India/remote tech jobs`);

    for (const job of techIndiaJobs) {
      const companyName = (job.company_name || "Unknown").trim();
      const normalizedCompanyName = normalizeCompanyName(companyName);
      const isRemote = job.remote === true;
      const locationLabel = isRemote ? "Remote" : (job.location || "India");

      const domain = extractDomain({
        employer_name: companyName,
        job_apply_link: job.url
      });
      const logo = domain ? `https://img.logo.dev/${domain}` : null;

      let company = await Company.findOne({ name: normalizedCompanyName });

      if (!company) {
        const brandingName = cleanCompanyNameOrUnknown(companyName, job.location);
        const coords = await getCoords(locationLabel);

        company = await Company.create({
          name: normalizedCompanyName,
          logo,
          domain,
          city: locationLabel,
          location: job.location,
          lat: coords?.lat || null,
          lng: coords?.lng || null,
          source: "arbeitnow",
          isRemote,
          brandingSource: "arbeitnow",
          brandingConfidence: "low",
          brandingReasoning: `discovered from Arbeitnow jobs for ${brandingName}`
        });

        console.log(`[ARBEITNOW] New company: ${companyName}`);
      } else {
        let updated = false;
        if (!company.domain && domain) { company.domain = domain; updated = true; }
        if (!company.logo && logo) { company.logo = logo; updated = true; }
        if (updated) {
          company.updatedAt = new Date();
          await company.save();
        }
      }

      await upsertIngestedJob({
        title: job.title,
        company: company._id,
        location: job.location,
        applyLink: job.url,
        description: job.description || null,
        source: "arbeitnow",
        postedDate: job.created_at ? new Date(job.created_at * 1000) : null,
        isRemote
      });
    }

    console.log("[ARBEITNOW] Ingestion complete");
  } catch (error) {
    console.log(`[ARBEITNOW] Ingestion error: ${error.message}`);
  }
};

module.exports = fetchArbeitnowJobs;
