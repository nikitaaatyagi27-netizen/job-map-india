// Deletes the N oldest jobs, regardless of isActive status. Use this when
// you want to manually trim the jobs collection down by a fixed count
// rather than relying on the isActive/grace-day cleanup logic.
//
// Run with:
//   node scripts/deleteOldestJobs.js 10000
//
// Defaults to 10000 if no count is given. Dry-run first with --dry-run to
// see what would be deleted without actually deleting anything.
//
// NOTE: allowDiskUse does NOT work on Atlas M0 (free/shared tier) clusters —
// M0 doesn't provision the local temp disk that option needs.
//
// NOTE 2: creating a new index (e.g. Job.collection.createIndex(...)) is
// ALSO a write operation — it writes new index data to disk — so Atlas
// blocks it too once you're over quota, with the exact same "over space
// quota" error. You can't create your way out of this.
//
// The real fix: sort using an index that ALREADY exists, so no new writes
// happen. Every collection already has a default index on _id, and
// MongoDB ObjectIds embed their creation timestamp in the first 4 bytes —
// so sorting by _id ascending gives you oldest-first order for free,
// using an index that's already there. This also matches firstSeenAt
// closely, since that field defaults to Date.now() at doc creation time.
//
// deleteMany() itself is expected to still work even over quota, since
// deletes free space rather than consume it.

require("dotenv").config();
const connectDB = require("../config/db");
const Job = require("../models/Job");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const countArg = args.find(a => /^\d+$/.test(a));
const COUNT = countArg ? parseInt(countArg, 10) : 10000;

(async () => {
  await connectDB();

  const totalBefore = await Job.countDocuments({});
  console.log(`Total jobs currently: ${totalBefore}`);

  if (COUNT >= totalBefore) {
    console.log(`Requested delete count (${COUNT}) >= total jobs (${totalBefore}). Aborting to avoid wiping the whole collection.`);
    process.exit(1);
  }

  // Sort by _id (existing default index, no new index/writes needed).
  // ObjectId's embedded timestamp makes this effectively oldest-first.
  const oldest = await Job.find({})
    .sort({ _id: 1 })
    .limit(COUNT)
    .select("_id title lastSeenAt firstSeenAt")
    .lean();

  console.log(`Found ${oldest.length} oldest jobs to delete.`);
  if (oldest.length) {
    console.log("Oldest job date range:");
    console.log(`  earliest: ${oldest[0].lastSeenAt || oldest[0].firstSeenAt}`);
    console.log(`  cutoff:   ${oldest[oldest.length - 1].lastSeenAt || oldest[oldest.length - 1].firstSeenAt}`);
  }

  if (dryRun) {
    console.log("Dry run — no documents deleted. Re-run without --dry-run to actually delete.");
    process.exit(0);
  }

  const ids = oldest.map(j => j._id);
  const result = await Job.deleteMany({ _id: { $in: ids } });

  const totalAfter = await Job.countDocuments({});
  console.log(`Deleted: ${result.deletedCount}`);
  console.log(`Total jobs remaining: ${totalAfter}`);

  process.exit(0);
})().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});