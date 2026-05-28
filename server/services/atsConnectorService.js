const { upsertCareerSource } = require("./companyIntelligenceService");
const { recordCareerSourceFailure } = require("./careerSourceTargetService");

async function syncATSCompanySignals({
  company,
  companyName,
  provider,
  boardUrl,
  careersUrl,
  website = null,
  domain = null,
  discoverySource = "source-ingestion",
  discoveryMethod = "source-ingestion",
  parserType = "unknown",
  jobsFound = 0,
  status = "active",
  notes = null
}) {
  if (!company?._id || !companyName || !provider) {
    throw new Error("company, companyName, and provider are required");
  }

  if (boardUrl) {
    await upsertCareerSource({
      company,
      provider,
      boardUrl,
      careersUrl: careersUrl || boardUrl,
      discoveryMethod,
      parserType,
      jobsFound,
      status
    });
  }
}

module.exports = {
  syncATSCompanySignals,
  recordCareerSourceFailure
};
