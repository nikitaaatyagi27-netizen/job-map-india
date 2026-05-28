const axios = require("axios");

const Company = require("../models/Company");
const getCoords = require("../utils/geocode");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { syncATSCompanySignals } = require("./atsConnectorService");
const {
  getRegistryFirstTargets,
  recordCareerSourceFailure
} = require("./careerSourceTargetService");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const { isIndianLocation } = require("../utils/indiaLocation");

function parseLeverSlug(boardUrl) {
  try {
    const parsed = new URL(boardUrl);
    if (parsed.hostname !== "jobs.lever.co") return null;
    return parsed.pathname.split("/").filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

async function getLeverTargets() {
  return getRegistryFirstTargets({
    provider: "lever",
    seedTargets: [],
    buildSourceTarget: (source) => {
      const slug = parseLeverSlug(source.boardUrl);
      if (!slug) return null;
      return { slug, companyName: source.companyName || null };
    }
  });
}

const fetchLeverJobs = async () => {
  try {
    console.log("[LEVER] Fetching Lever jobs");

    const leverTargets = await getLeverTargets();

    for (const target of leverTargets) {
      const companySlug = target.slug;

      try {
        // Lever v0 public postings API — returns full posting including
        // descriptionPlain, so no second request needed per job.
        const response = await axios.get(
          `https://api.lever.co/v0/postings/${companySlug}`
        );

        const jobs = response.data || [];
        const indiaJobs = jobs.filter((job) =>
          isIndianLocation(job.categories?.location)
        );

        console.log(`[LEVER] ${companySlug}: ${indiaJobs.length} India jobs`);

        for (const job of indiaJobs) {
          const companyName = target.companyName || companySlug;
          const normalizedCompanyName = normalizeCompanyName(companyName);
          const location = job.categories?.location || "India";

          let company = await Company.findOne({ name: normalizedCompanyName });

          if (!company) {
            const coords = await getCoords(location);

            company = await Company.create({
              name: normalizedCompanyName,
              logo: null,
              city: location,
              location,
              lat: coords?.lat || null,
              lng: coords?.lng || null,
              source: "lever"
            });

            console.log(`[LEVER] New company: ${companyName}`);
          }

          await syncATSCompanySignals({
            company,
            companyName,
            provider: "lever",
            boardUrl: `https://jobs.lever.co/${companySlug}`,
            careersUrl: `https://jobs.lever.co/${companySlug}`,
            website: company.website || null,
            domain: company.domain || null,
            discoverySource: "lever",
            discoveryMethod: target.companyName ? "career-source-registry" : "static-seed",
            parserType: "lever-api",
            jobsFound: indiaJobs.length,
            status: "active"
          });

          await upsertIngestedJob({
            title: job.text,
            company: company._id,
            location,
            applyLink: job.hostedUrl,
            description: job.descriptionPlain || null,
            source: "lever",
            postedDate: job.createdAt ? new Date(job.createdAt) : null,
            isRemote: false
          });
        }
      } catch (error) {
        console.log(`[LEVER] Error for ${companySlug}: ${error.message}`);

        await recordCareerSourceFailure({
          provider: "lever",
          boardUrl: `https://jobs.lever.co/${companySlug}`,
          error
        });
      }
    }

    console.log("[LEVER] Ingestion complete");
  } catch (error) {
    console.log(`[LEVER] Service error: ${error.message}`);
  }
};

module.exports = fetchLeverJobs;
