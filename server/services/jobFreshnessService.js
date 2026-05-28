const Job = require("../models/Job");

async function backfillJobFreshness(logger = console) {
  const now = new Date();

  const result = await Job.updateMany(
    {
      $or: [
        { isActive: { $exists: false } },
        { firstSeenAt: { $exists: false } },
        { lastSeenAt: { $exists: false } },
        { fetchedAt: { $exists: false } }
      ]
    },
    {
      $set: {
        isActive: true,
        firstSeenAt: now,
        lastSeenAt: now,
        fetchedAt: now
      }
    }
  );

  const modifiedCount = result.modifiedCount || 0;

  logger.log(
    `[JOB FRESHNESS] Backfilled freshness fields for ${modifiedCount} existing jobs`
  );

  return modifiedCount;
}

module.exports = {
  backfillJobFreshness
};
