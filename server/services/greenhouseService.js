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

function parseGreenhouseSlug(boardUrl) {
  try {
    const parsed = new URL(boardUrl);
    if (parsed.hostname !== "boards.greenhouse.io") return null;
    return parsed.pathname.split("/").filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

async function getGreenhouseTargets() {
  return getRegistryFirstTargets({
    provider: "greenhouse",
    seedTargets: [],
    buildSourceTarget: (source) => {
      const slug = parseGreenhouseSlug(source.boardUrl);
      if (!slug) return null;
      return {
        slug,
        companyName: source.companyName || null,
        discoveryMethod: source.discoveryMethod || "career-source-registry"
      };
    }
  });
}

// The Greenhouse list endpoint omits description. Fetch individual job detail
// to get the `content` field. Returns null on failure — skill matching
// degrades gracefully rather than crashing the ingestion.
async function fetchGreenhouseJobDescription(slug, jobId) {
  try {
    const res = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`
    );
    const raw = res.data?.content || null;
    if (!raw) return null;
    // Strip HTML tags so skill gap service gets plain text
    return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
  } catch {
    return null;
  }
}

const fetchGreenhouseJobs = async () => {
  try {
    console.log("[GREENHOUSE] Fetching Greenhouse jobs");

    const greenhouseTargets = await getGreenhouseTargets();

    for (const target of greenhouseTargets) {
      const slug = target.slug;

      try {
        // content=true returns the full job description in one call,
        // eliminating a separate detail fetch per India job.
        const response = await axios.get(
          `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
          { params: { content: true } }
        );

        const jobs = response.data?.jobs || [];
        const indiaJobs = jobs.filter((job) =>
          isIndianLocation(job.location?.name)
        );

        console.log(`[GREENHOUSE] ${slug}: ${jobs.length} total, ${indiaJobs.length} India`);

        for (const job of indiaJobs) {
          const companyName = job.company_name || target.companyName || slug;
          const normalizedCompanyName = normalizeCompanyName(companyName);
          const location = job.location?.name || "India";

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
              source: "greenhouse"
            });

            console.log(`[GREENHOUSE] New company: ${companyName}`);
          }

          await syncATSCompanySignals({
            company,
            companyName,
            provider: "greenhouse",
            boardUrl: `https://boards.greenhouse.io/${slug}`,
            careersUrl: `https://boards.greenhouse.io/${slug}`,
            website: company.website || null,
            domain: company.domain || null,
            discoverySource: "greenhouse",
            discoveryMethod: target.discoveryMethod || "source-ingestion",
            parserType: "greenhouse-api",
            jobsFound: indiaJobs.length,
            status: "active"
          });

          // content=true already includes the full HTML description in job.content
          const rawContent = job.content || null;
          const description = rawContent
            ? rawContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            : null;

          await upsertIngestedJob({
            title: job.title,
            company: company._id,
            location,
            applyLink: job.absolute_url,
            description,
            source: "greenhouse",
            postedDate: job.updated_at ? new Date(job.updated_at) : null,
            isRemote: false
          });
        }
      } catch (error) {
        console.log(`[GREENHOUSE] Error for ${slug}: ${error.message}`);

        await recordCareerSourceFailure({
          provider: "greenhouse",
          boardUrl: `https://boards.greenhouse.io/${slug}`,
          error
        });
      }
    }

    console.log("[GREENHOUSE] Ingestion complete");
  } catch (error) {
    console.log(`[GREENHOUSE] Service error: ${error.message}`);
  }
};

module.exports = fetchGreenhouseJobs;
