const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");

async function getRegistryFirstTargets({
  provider,
  seedTargets = [],
  buildSourceTarget,
  activeStatuses = ["active"]
}) {
  const activeSources = await CareerSource.find({
    provider,
    status: {
      $in: activeStatuses
    }
  }).select("boardUrl companyName discoveryMethod");

  const registryTargets = activeSources
    .map((source) => buildSourceTarget(source))
    .filter(Boolean);

  if (registryTargets.length > 0) {
    return registryTargets;
  }

  const companyTargets = await Company.find({
    careersProvider: provider,
    careersUrl: {
      $ne: null
    }
  }).select("name careersUrl discoverySources source");

  const derivedTargets = companyTargets
    .map((company) =>
      buildSourceTarget({
        boardUrl: company.careersUrl,
        companyName: company.name,
        discoveryMethod: company.source || "company-derived"
      })
    )
    .filter(Boolean);

  if (derivedTargets.length > 0) {
    return derivedTargets;
  }

  return seedTargets;
}

async function recordCareerSourceFailure({ provider, boardUrl, error }) {
  if (!provider || !boardUrl) {
    return;
  }

  const isTransient = /ETIMEDOUT|ENOTFOUND|ECONNRESET|ERR_CONNECTION_RESET|socket hang up/i.test(
    error?.message || ""
  );

  await CareerSource.findOneAndUpdate(
    {
      provider,
      boardUrl
    },
    {
      $set: {
        status: isTransient ? "active" : "needs_review",
        lastCheckedAt: new Date(),
        lastError: error?.message || "Unknown error",
        lastFailureAt: new Date(),
        updatedAt: new Date()
      },
      $inc: {
        failureCount: 1
      }
    }
  ).catch(() => null);
}

module.exports = {
  getRegistryFirstTargets,
  recordCareerSourceFailure
};
