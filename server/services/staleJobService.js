const Job = require("../models/Job");

// Source-specific cutoffs (days). More frequent re-scraping sources expire faster.
const SOURCE_CUTOFFS = {
  naukri: 5,
  jsearch: 7,
  adzuna: 5,
  arbeitnow: 7,
  remotive: 7,
  greenhouse: 30,
  lever: 30,
  ashby: 30,
  smartrecruiters: 30,
  workday: 30,
  taleo: 30,
  successfactors: 30,
  icims: 30
};

const DEFAULT_DAYS = Number(process.env.STALE_JOB_DAYS || 14);

async function markStaleJobs(options = {}) {
  const logger = options.logger || console;
  let totalModified = 0;

  for (const [source, days] of Object.entries(SOURCE_CUTOFFS)) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Use firstSeenAt as fallback when lastSeenAt is missing (jobs seeded before the field existed)
    const result = await Job.updateMany(
      {
        isActive: true,
        source,
        $or: [
          { lastSeenAt: { $lt: cutoff } },
          { lastSeenAt: { $exists: false }, firstSeenAt: { $lt: cutoff } }
        ]
      },
      { $set: { isActive: false } }
    );
    const count = result.modifiedCount || 0;
    if (count > 0) {
      logger.log(`[STALE JOBS] ${source}: marked ${count} inactive (>${days}d old)`);
    }
    totalModified += count;
  }

  // Catch any jobs from unlisted sources using the default cutoff
  const defaultCutoff = new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  const knownSources = Object.keys(SOURCE_CUTOFFS);
  const fallbackResult = await Job.updateMany(
    {
      isActive: true,
      source: { $nin: knownSources },
      $or: [
        { lastSeenAt: { $lt: defaultCutoff } },
        { lastSeenAt: { $exists: false }, firstSeenAt: { $lt: defaultCutoff } }
      ]
    },
    { $set: { isActive: false } }
  );
  const fallbackCount = fallbackResult.modifiedCount || 0;
  if (fallbackCount > 0) {
    logger.log(`[STALE JOBS] other sources: marked ${fallbackCount} inactive (>${DEFAULT_DAYS}d old)`);
  }
  totalModified += fallbackCount;

  logger.log(`[STALE JOBS] Total marked inactive: ${totalModified}`);

  return { totalModified };
}

module.exports = {
  markStaleJobs
};
