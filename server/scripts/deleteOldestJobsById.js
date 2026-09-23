require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Job = require("../models/Job");

// Deletes jobs whose _id was created before a cutoff date. Uses the default
// _id index — no sort needed, so this avoids the Atlas M0 in-memory sort limit.
// Usage: node scripts/deleteOldestJobsById.js --days 180
//   --days 180 = delete jobs inserted more than 180 days ago (i.e. your earliest data)

const daysArgIndex = process.argv.indexOf("--days");
const DAYS = daysArgIndex !== -1 ? Number(process.argv[daysArgIndex + 1]) : 180;

(async () => {
  await connectDB();

  const cutoffDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const cutoffId = mongoose.Types.ObjectId.createFromTime(
    Math.floor(cutoffDate.getTime() / 1000)
  );

  console.log(`Deleting jobs inserted before ${cutoffDate.toISOString()} (older than ${DAYS} days)...`);

  const before = await Job.countDocuments();
  const toDeleteCount = await Job.countDocuments({ _id: { $lt: cutoffId } });
  console.log(`Matching jobs to delete: ${toDeleteCount}`);

  const result = await Job.deleteMany({ _id: { $lt: cutoffId } });

  const after = await Job.countDocuments();
  console.log(`Before: ${before}`);
  console.log(`Deleted: ${result.deletedCount}`);
  console.log(`After: ${after}`);

  process.exit();
})().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});