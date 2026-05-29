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

function parseSmartRecruitersCompanyIdentifier(boardUrl) {
  try {
    const parsed = new URL(boardUrl);
    const host = parsed.hostname.toLowerCase();

    if (
      host !== "jobs.smartrecruiters.com" &&
      host !== "careers.smartrecruiters.com"
    ) {
      return null;
    }

    return parsed.pathname.split("/").filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

async function getSmartRecruitersTargets() {
  return getRegistryFirstTargets({
    provider: "smartrecruiters",
    seedTargets: [],
    buildSourceTarget: (source) => {
      const companyIdentifier = parseSmartRecruitersCompanyIdentifier(
        source.boardUrl
      );

      if (!companyIdentifier) {
        return null;
      }

      return {
        companyIdentifier,
        companyName: source.companyName || null
      };
    }
  });
}

function isIndiaLocation(location) {
  return isIndianLocation(location);
}

// SmartRecruiters public search API — searches across ALL companies at once.
// No tenant list needed; filters server-side by country=IN.
const SR_PUBLIC_PAGE_SIZE = 100;
const SR_PUBLIC_MAX_PAGES = Number(process.env.SR_PUBLIC_MAX_PAGES || 10); // 10×100 = 1000 India jobs

async function fetchSmartRecruitersPublicPostings() {
  console.log("[SR PUBLIC] Fetching cross-company India postings");
  let total = 0;

  for (let page = 0; page < SR_PUBLIC_MAX_PAGES; page++) {
    let response;
    try {
      response = await axios.get("https://api.smartrecruiters.com/v1/postings", {
        params: { country: "IN", limit: SR_PUBLIC_PAGE_SIZE, offset: page * SR_PUBLIC_PAGE_SIZE }
      });
    } catch (err) {
      console.log(`[SR PUBLIC] Page ${page} failed: ${err.message}`);
      break;
    }

    const jobs = response.data?.content || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const companyName = job.company?.name || "Unknown";
      const companySlug = job.company?.identifier;
      const normalizedCompanyName = normalizeCompanyName(companyName);
      if (!normalizedCompanyName) continue;

      const location =
        job.location?.fullLocation ||
        job.location?.city ||
        job.location?.region ||
        "India";

      try {
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
            source: "smartrecruiters"
          });
        }

        // Register as CareerSource so targeted fetches work in future runs
        if (companySlug) {
          const boardUrl = `https://careers.smartrecruiters.com/${companySlug}`;
          const CareerSource = require("../models/CareerSource");
          const existing = await CareerSource.findOne({ company: company._id, provider: "smartrecruiters" });
          if (!existing) {
            await CareerSource.create({
              company: company._id,
              companyName: normalizedCompanyName,
              provider: "smartrecruiters",
              boardUrl,
              discoveryMethod: "public-api",
              status: "active"
            });
          }
        }

        await upsertIngestedJob({
          title: job.name,
          company: company._id,
          location,
          applyLink: job.postingUrl || job.applyUrl || null,
          description: null,
          source: "smartrecruiters",
          postedDate: job.releasedDate ? new Date(job.releasedDate) : null,
          isRemote: job.location?.remote === true
        });
        total++;
      } catch (err) {
        console.log(`[SR PUBLIC] Persist failed for "${job.name}": ${err.message}`);
      }
    }

    if (jobs.length < SR_PUBLIC_PAGE_SIZE) break; // last page
  }

  console.log(`[SR PUBLIC] Done — ${total} India jobs ingested`);
  return total;
}

async function fetchSmartRecruitersJobs() {
  try {
    console.log("Fetching SmartRecruiters jobs");

    const smartRecruitersTargets = await getSmartRecruitersTargets();

    for (const target of smartRecruitersTargets) {
      const companyIdentifier = target.companyIdentifier;
      try {
        const response = await axios.get(
          `https://api.smartrecruiters.com/v1/companies/${companyIdentifier}/postings`,
          {
            params: {
              limit: 100
            }
          }
        );

        const jobs = response.data?.content || response.data?.jobs || [];
        const indiaJobs = jobs.filter((job) =>
          isIndiaLocation(job.location?.city || job.location?.region || job.location?.country || job.location?.fullLocation || job.location?.remote)
        );

        console.log(`${companyIdentifier}: ${indiaJobs.length} India jobs`);

        for (const job of indiaJobs) {
          const companyName =
            job.company?.name ||
            target.companyName ||
            companyIdentifier;
          const normalizedCompanyName = normalizeCompanyName(companyName);
          const location =
            job.location?.fullLocation ||
            job.location?.city ||
            job.location?.region ||
            job.location?.country ||
            "India";

          let company = await Company.findOne({
            name: normalizedCompanyName
          });

          if (!company) {
            const coords = await getCoords(location);

            company = await Company.create({
              name: normalizedCompanyName,
              logo: null,
              city: location,
              location,
              lat: coords?.lat || null,
              lng: coords?.lng || null,
              source: "smartrecruiters"
            });

            console.log(
              "New SmartRecruiters company:",
              companyName
            );
          }

          await syncATSCompanySignals({
            company,
            companyName,
            provider: "smartrecruiters",
            boardUrl: `https://jobs.smartrecruiters.com/${companyIdentifier}`,
            careersUrl: `https://jobs.smartrecruiters.com/${companyIdentifier}`,
            website: company.website || null,
            domain: company.domain || null,
            discoverySource: "smartrecruiters",
            discoveryMethod: target.companyName ? "career-source-registry" : "static-seed",
            parserType: "smartrecruiters-api",
            jobsFound: indiaJobs.length,
            status: "active"
          });

          await upsertIngestedJob({
            title: job.name,
            company: company._id,
            location,
            applyLink: job.postingUrl || job.applyUrl || job.jobAdUrl || null,
            description:
              job.jobAd?.jobDescription ||
              job.jobAd?.companyDescription ||
              null,
            source: "smartrecruiters",
            postedDate: job.postedDate || null,
            isRemote: false
          });
        }
      } catch (error) {
        console.log(`SmartRecruiters error for ${companyIdentifier}`);
        console.log(error.message);

        await recordCareerSourceFailure({
          provider: "smartrecruiters",
          boardUrl: `https://jobs.smartrecruiters.com/${companyIdentifier}`,
          error
        });
      }
    }

    console.log("SmartRecruiters tenant ingestion complete");

    // Also run the public cross-company search to capture companies not in our tenant list
    await fetchSmartRecruitersPublicPostings();

    console.log("SmartRecruiters ingestion complete");
  } catch (error) {
    console.log("SmartRecruiters service error");
    console.log(error.message);
  }
}

module.exports = fetchSmartRecruitersJobs;
