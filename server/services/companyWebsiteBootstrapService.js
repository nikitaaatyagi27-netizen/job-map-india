const Company = require("../models/Company");
const { upsertCareerSource } = require("./companyIntelligenceService");
const { detectCareerProvider } = require("../utils/careerProviderDetector");

function buildCandidateUrls(company) {
  const urls = [
    company.careersUrl,
    company.website,
    company.domain ? `https://${company.domain}` : null
  ].filter(Boolean);

  return Array.from(new Set(urls));
}

async function bootstrapCareerSourcesFromCompanyWebsites() {
  const companies = await Company.find({});
  let companiesScanned = 0;
  let sourcesRegistered = 0;
  let companiesUpgraded = 0;

  for (const company of companies) {
    companiesScanned++;

    const candidateUrls = buildCandidateUrls(company);
    const detections = new Map();
    const hadProvider = Boolean(company.careersProvider);

    for (const candidateUrl of candidateUrls) {
      const detected = detectCareerProvider(candidateUrl);

      if (!detected) {
        continue;
      }

      const key = `${detected.provider}|${detected.boardUrl}`;

      if (!detections.has(key)) {
        detections.set(key, detected);
      }
    }

    if (detections.size === 0) {
      continue;
    }

    for (const detection of detections.values()) {
      await upsertCareerSource({
        company,
        provider: detection.provider,
        boardUrl: detection.boardUrl,
        careersUrl: company.careersUrl || detection.careersUrl,
        discoveryMethod: "company-website-signals",
        parserType: "url-detection",
        jobsFound: 0,
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
  bootstrapCareerSourcesFromCompanyWebsites
};
