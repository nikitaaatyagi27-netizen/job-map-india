const Company = require("../models/Company");
const Job = require("../models/Job");
const { upsertCareerSource } = require("./companyIntelligenceService");
const { detectCareerProvider } = require("../utils/careerProviderDetector");

async function bootstrapCareerSourcesFromJobs() {
  const companies = await Company.find({});
  let companiesScanned = 0;
  let sourcesRegistered = 0;
  let companiesUpgraded = 0;

  for (const company of companies) {
    companiesScanned++;

    const jobs = await Job.find({
      company: company._id,
      applyLink: { $ne: null }
    }).select("applyLink source");

    const detections = new Map();

    for (const job of jobs) {
      const detected = detectCareerProvider(job.applyLink);

      if (!detected) {
        continue;
      }

      const key = `${detected.provider}|${detected.boardUrl}`;

      if (!detections.has(key)) {
        detections.set(key, {
          ...detected,
          jobsFound: 0
        });
      }

      detections.get(key).jobsFound++;
    }

    if (detections.size === 0) {
      continue;
    }

    const hadProvider = Boolean(company.careersProvider);

    for (const detection of detections.values()) {
      await upsertCareerSource({
        company,
        provider: detection.provider,
        boardUrl: detection.boardUrl,
        careersUrl: detection.careersUrl,
        discoveryMethod: "existing-job-apply-links",
        parserType: "url-detection",
        jobsFound: detection.jobsFound,
        status: "active"
      });
      sourcesRegistered++;
    }

    if (!hadProvider && company.careersProvider) {
      companiesUpgraded++;
    }
  }

  return {
    companiesScanned,
    sourcesRegistered,
    companiesUpgraded
  };
}

module.exports = {
  bootstrapCareerSourcesFromJobs
};
