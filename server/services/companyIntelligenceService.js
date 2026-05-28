const Company = require("../models/Company");
const Job = require("../models/Job");
const CareerSource = require("../models/CareerSource");

function buildWebsiteFromDomain(domain) {
  if (!domain) {
    return null;
  }

  return `https://${domain}`;
}

function getCompanyDiscoverySources(company, jobs) {
  const sources = new Set();

  if (company.source) {
    sources.add(company.source);
  }

  for (const job of jobs) {
    if (job.source) {
      sources.add(job.source);
    }
  }

  return Array.from(sources).sort();
}

function inferIntelligenceStatus(company, jobs) {
  if (company.careersProvider && company.careersUrl) {
    return "direct-source-linked";
  }

  if (company.website || company.domain) {
    return jobs.length > 0 ? "seeded" : "website-known";
  }

  return jobs.length > 0 ? "seeded" : "pending";
}

async function syncCompanyIntelligenceMetadata() {
  const companies = await Company.find({});
  let updatedCompanies = 0;

  for (const company of companies) {
    const jobs = await Job.find({ company: company._id }).select("source");
    const discoverySources = getCompanyDiscoverySources(company, jobs);
    const website = company.website || buildWebsiteFromDomain(company.domain);
    const intelligenceStatus = inferIntelligenceStatus(company, jobs);

    const shouldUpdate =
      JSON.stringify(company.discoverySources || []) !==
        JSON.stringify(discoverySources) ||
      company.website !== website ||
      company.intelligenceStatus !== intelligenceStatus;

    if (!shouldUpdate) {
      continue;
    }

    company.discoverySources = discoverySources;
    company.website = website;
    company.intelligenceStatus = intelligenceStatus;
    company.lastIntelligenceAt = new Date();
    company.updatedAt = new Date();

    await company.save();
    updatedCompanies++;
  }

  return {
    scannedCompanies: companies.length,
    updatedCompanies
  };
}

async function upsertCareerSource({
  company,
  provider,
  boardUrl,
  careersUrl = null,
  discoveryMethod = "unknown",
  parserType = "unknown",
  jobsFound = 0,
  status = "active",
  lastError = null
}) {
  if (!company?._id || !provider || !boardUrl) {
    throw new Error("company, provider, and boardUrl are required");
  }

  const now = new Date();
  const update = {
    company: company._id,
    companyName: company.name,
    provider,
    boardUrl,
    careersUrl,
    discoveryMethod,
    parserType,
    status,
    jobsFound,
    lastCheckedAt: now,
    updatedAt: now,
    lastError
  };

  if (status === "active") {
    update.lastSuccessAt = now;
    update.failureCount = 0;
    update.lastFailureAt = null;
  }

  await CareerSource.findOneAndUpdate(
    {
      company: company._id,
      provider,
      boardUrl
    },
    {
      $set: update,
      $setOnInsert: {
        createdAt: now
      }
    },
    {
      upsert: true,
      returnDocument: "after"
    }
  );

  const nextDiscoverySources = new Set(company.discoverySources || []);
  nextDiscoverySources.add(provider);

  company.discoverySources = Array.from(nextDiscoverySources).sort();
  company.careersProvider = company.careersProvider || provider;
  company.careersUrl = company.careersUrl || careersUrl || boardUrl;
  company.intelligenceStatus = "direct-source-linked";
  company.lastIntelligenceAt = now;
  company.updatedAt = now;

  await company.save();
}

module.exports = {
  buildWebsiteFromDomain,
  syncCompanyIntelligenceMetadata,
  upsertCareerSource
};
