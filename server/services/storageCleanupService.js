const Job = require("../models/Job");

// Keeps the database from filling up (free Atlas tier is 512 MB). Two guards:
//   1. Delete inactive jobs older than a grace period — these are marked
//      isActive:false by markStaleJobs / job verification and are pure dead
//      weight (not searched, not embedded-relevant). The grace period avoids
//      deleting a job that was just transiently marked inactive.
//   2. If total job count exceeds a hard cap, trim the oldest jobs (by
//      lastSeenAt) so the corpus can never grow unbounded.
//
// Tunable via env:
//   STORAGE_INACTIVE_GRACE_DAYS  (default 3)  — how long an inactive job lingers
//   STORAGE_MAX_JOBS             (default 40000) — hard cap on total jobs

const INACTIVE_GRACE_DAYS = Number(process.env.STORAGE_INACTIVE_GRACE_DAYS || 3);
const MAX_JOBS = Number(process.env.STORAGE_MAX_JOBS || 40000);

// options.graceDays overrides the grace period (pass 0 to delete ALL inactive
// jobs immediately, regardless of when they were marked inactive).
async function runStorageCleanup(options = {}) {
  const summary = { inactiveDeleted: 0, cappedDeleted: 0 };
  const graceDays = options.graceDays != null ? options.graceDays : INACTIVE_GRACE_DAYS;

  // 1. Delete inactive jobs. With graceDays = 0, delete every inactive job now.
  let inactiveFilter;
  if (graceDays <= 0) {
    inactiveFilter = { isActive: false };
  } else {
    const graceCutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);
    inactiveFilter = {
      isActive: false,
      $or: [
        { lastSeenAt: { $lt: graceCutoff } },
        { lastSeenAt: { $exists: false }, firstSeenAt: { $lt: graceCutoff } }
      ]
    };
  }
  const inactiveResult = await Job.deleteMany(inactiveFilter);
  summary.inactiveDeleted = inactiveResult.deletedCount || 0;

  // 2. Hard cap: if still over MAX_JOBS, delete the oldest-seen jobs down to cap.
  const total = await Job.countDocuments({});
  if (total > MAX_JOBS) {
    const overBy = total - MAX_JOBS;
    // Find the oldest `overBy` jobs by lastSeenAt and delete them.
    const oldest = await Job.find({})
      .sort({ lastSeenAt: 1, firstSeenAt: 1 })
      .limit(overBy)
      .select("_id")
      .lean();
    const ids = oldest.map(j => j._id);
    if (ids.length) {
      const capResult = await Job.deleteMany({ _id: { $in: ids } });
      summary.cappedDeleted = capResult.deletedCount || 0;
    }
  }

  console.log(
    `[STORAGE CLEANUP] inactive deleted: ${summary.inactiveDeleted} | ` +
    `over-cap deleted: ${summary.cappedDeleted} | cap: ${MAX_JOBS}`
  );
  return summary;
}

module.exports = { runStorageCleanup };
