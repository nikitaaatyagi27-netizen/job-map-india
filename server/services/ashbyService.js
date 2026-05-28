const axios = require("axios");

const Company = require("../models/Company");
const getCoords = require("../utils/geocode");
const extractDomain = require("../utils/extractDomain");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const {
  syncATSCompanySignals,
  recordCareerSourceFailure
} = require("./atsConnectorService");
const {
  getRegistryFirstTargets,
} = require("./careerSourceTargetService");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const { isIndianLocation } = require("../utils/indiaLocation");

function parseAshbyBoardName(boardUrl) {
  try {
    const parsed = new URL(boardUrl);

    if (parsed.hostname !== "jobs.ashbyhq.com") {
      return null;
    }

    return parsed.pathname.split("/").filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

async function getAshbyTargets() {
  return getRegistryFirstTargets({
    provider: "ashby",
    seedTargets: [],
    buildSourceTarget: (source) => {
      const boardName = parseAshbyBoardName(source.boardUrl);

      if (!boardName) {
        return null;
      }

      return {
        boardName,
        companyName: source.companyName || null
      };
    }
  });
}

function isIndiaJob(job) {
  const location = [
    job.location,
    job.address?.postalAddress?.addressLocality,
    job.address?.postalAddress?.addressRegion,
    job.address?.postalAddress?.addressCountry
  ]
    .filter(Boolean)
    .join(", ");
  // Treat Ashby's `isRemote: true` as ambiguous remote — accept if any signal exists
  return isIndianLocation(location, { hasIndianPresence: job.isRemote === true });
}

async function fetchAshbyJobs() {
  try {
    console.log("Fetching Ashby jobs");

    const ashbyTargets = await getAshbyTargets();

    for (const target of ashbyTargets) {
      const boardName = target.boardName;
      try {
        const response = await axios.get(
          `https://api.ashbyhq.com/posting-api/job-board/${boardName}`
        );

        const jobs = response.data?.jobs || [];
        const indiaJobs = jobs.filter((job) => job.isListed !== false && isIndiaJob(job));

        console.log(`${boardName}: ${indiaJobs.length} India jobs`);

        for (const job of indiaJobs) {
          const companyName = target.companyName || boardName;
          const normalizedCompanyName = normalizeCompanyName(companyName);
          const location =
            job.location ||
            job.address?.postalAddress?.addressLocality ||
            "India";

          let company = await Company.findOne({
            name: normalizedCompanyName
          });

          if (!company) {
            const coords = await getCoords(location);
            const domain = extractDomain({
              employer_name: companyName,
              job_apply_link: job.applyUrl || job.jobUrl
            });

            company = await Company.create({
              name: normalizedCompanyName,
              logo: null,
              domain: domain || null,
              city: location,
              location,
              lat: coords?.lat || null,
              lng: coords?.lng || null,
              source: "ashby",
              isRemote: job.isRemote === true
            });

            console.log(
              "New Ashby company:",
              companyName
            );
          }

          await syncATSCompanySignals({
            company,
            companyName,
            provider: "ashby",
            boardUrl: `https://jobs.ashbyhq.com/${boardName}`,
            careersUrl: `https://jobs.ashbyhq.com/${boardName}`,
            website: company.website || null,
            domain: company.domain || null,
            discoverySource: "ashby",
            discoveryMethod: target.companyName ? "career-source-registry" : "static-seed",
            parserType: "ashby-api",
            jobsFound: indiaJobs.length,
            status: "active"
          });

          await upsertIngestedJob({
            title: job.title,
            company: company._id,
            location,
            applyLink: job.applyUrl || job.jobUrl,
            description: job.descriptionPlain || job.descriptionHtml || null,
            source: "ashby",
            postedDate: job.publishedAt || null,
            isRemote: job.isRemote === true
          });
        }
      } catch (error) {
        console.log(`Ashby error for ${boardName}`);
        console.log(error.message);

        await recordCareerSourceFailure({
          provider: "ashby",
          boardUrl: `https://jobs.ashbyhq.com/${boardName}`,
          error
        });
      }
    }

    console.log("Ashby ingestion complete");
  } catch (error) {
    console.log("Ashby service error");
    console.log(error.message);
  }
}

module.exports = fetchAshbyJobs;
