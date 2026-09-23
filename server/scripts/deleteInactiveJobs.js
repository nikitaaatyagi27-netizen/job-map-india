// server/scripts/deleteInactiveJobs.js
//
// Permanently deletes every Job document where isActive: false.
//
// Run (report only — deletes nothing):
//   node scripts/deleteInactiveJobs.js
//
// Run (actually delete):
//   node scripts/deleteInactiveJobs.js --confirm
//
// Why the --confirm gate: this is a destructive, irreversible operation on
// potentially thousands of rows. Running it with no flag always does a dry
// run and shows you exactly what WOULD be deleted (total count + breakdown
// by source), so you can check the numbers look sane before committing.

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Job = require("../models/Job");

const CONFIRM = process.argv.includes("--confirm");

function pad(value, width) {
  const str = String(value ?? "");
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

async function main() {
  await connectDB();

  const filter = { isActive: false };

  const totalInactive = await Job.countDocuments(filter);

  if (totalInactive === 0) {
    console.log("No inactive jobs found. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // Breakdown by source so you can see what's about to be removed.
  const bySource = await Job.aggregate([
    { $match: filter },
    { $group: { _id: "$source", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  console.log("=".repeat(60));
  console.log(CONFIRM ? "DELETING inactive jobs" : "DRY RUN — no jobs will be deleted (pass --confirm to delete)");
  console.log("=".repeat(60));
  console.log(pad("source", 25) + "inactive_count");
  console.log("-".repeat(60));
  for (const row of bySource) {
    console.log(pad(row._id || "(none)", 25) + row.count);
  }
  console.log("-".repeat(60));
  console.log(`TOTAL inactive jobs: ${totalInactive}\n`);

  if (!CONFIRM) {
    console.log("Dry run only. Re-run with --confirm to actually delete these jobs.");
    await mongoose.disconnect();
    return;
  }

  const result = await Job.deleteMany(filter);
  console.log(`Deleted ${result.deletedCount} inactive job(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Delete inactive jobs failed:", err.message);
  process.exit(1);
});