const Company = require("../models/Company");
const Job = require("../models/Job");

async function runIngestionSource(sourceKey, label, handler) {
  const startedAt = new Date();
  const startedAtMs = Date.now();

  console.log(`[INGESTION] Starting ${label}`);

  const companyCountBefore = await Company.countDocuments({
    source: sourceKey
  });

  const jobCountBefore = await Job.countDocuments({
    source: sourceKey
  });

  try {
    await handler();

    const companyCountAfter = await Company.countDocuments({
      source: sourceKey
    });

    const jobCountAfter = await Job.countDocuments({
      source: sourceKey
    });

    const seenDuringRun = await Job.countDocuments({
      source: sourceKey,
      fetchedAt: { $gte: startedAt }
    });

    const newCompanies = Math.max(companyCountAfter - companyCountBefore, 0);
    const newJobs = Math.max(jobCountAfter - jobCountBefore, 0);
    const refreshedJobs = Math.max(seenDuringRun - newJobs, 0);
    const durationMs = Date.now() - startedAtMs;

    console.log(
      `[INGESTION] Finished ${label} | new companies: ${newCompanies} | new jobs: ${newJobs} | refreshed jobs: ${refreshedJobs} | durationMs: ${durationMs}`
    );

    return {
      newCompanies,
      newJobs,
      refreshedJobs,
      durationMs
    };
  } catch (error) {
    console.log(`[INGESTION] Failed ${label}`);
    console.log(error.message);
    throw error;
  }
}

module.exports = {
  runIngestionSource
};
