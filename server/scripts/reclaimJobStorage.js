// server/scripts/reclaimJobStorage.js
//
// Reclaims allocated disk storage on MongoDB Atlas M0 Free Tier.
// On WiredTiger, deleteMany() reduces dataSize but does NOT reduce storageSize
// (the physical .wt file size on disk). This script safely:
//   1. Reads all active jobs (including +embedding) into a local backup file
//   2. Drops the bloated jobs collection (freeing ~459 MB immediately)
//   3. Re-inserts the active jobs with their original _id and embeddings
//   4. Rebuilds all compound and single-field indexes
//   5. Drops unused test collections (_wtest, _wt, _writetest)

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Job = require("../models/Job");

const BACKUP_FILE = path.join(__dirname, "../tmp/backup_active_jobs.json");

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

async function run() {
  await connectDB();
  const db = mongoose.connection.db;

  console.log("\n============================================================");
  console.log("       RECLAIMING MONGODB ATLAS STORAGE FOR JOBS");
  console.log("============================================================\n");

  const initialStats = await db.command({ collStats: "jobs" });
  console.log(`Current jobs document count: ${initialStats.count}`);
  console.log(`Current jobs dataSize:       ${mb(initialStats.size)}`);
  console.log(`Current jobs storageSize:    ${mb(initialStats.storageSize)} (allocated on disk)`);
  console.log(`Current jobs indexSize:      ${mb(initialStats.totalIndexSize)}`);
  console.log("------------------------------------------------------------");

  if (initialStats.count === 0) {
    console.log("No jobs found in collection. Aborting for safety.");
    await mongoose.disconnect();
    process.exit(0);
  }

  // Ensure tmp directory exists
  const tmpDir = path.dirname(BACKUP_FILE);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  console.log(`\nStep 1: Reading all ${initialStats.count} jobs (including embeddings)...`);
  const jobs = await Job.find({}).select("+embedding").lean();

  if (jobs.length !== initialStats.count) {
    throw new Error(`Count mismatch: found ${jobs.length}, expected ${initialStats.count}`);
  }

  console.log(`Step 2: Saving local backup to ${BACKUP_FILE}...`);
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(jobs));
  const backupSize = fs.statSync(BACKUP_FILE).size;
  console.log(`        Backup verified on disk: ${mb(backupSize)}`);

  console.log("\nStep 3: Dropping bloated jobs collection from Atlas...");
  await db.collection("jobs").drop();
  console.log("        jobs collection dropped. Physical storage released by WiredTiger.");

  console.log("\nStep 4: Recreating collection and restoring active jobs in batches...");
  const BATCH_SIZE = 500;
  let restored = 0;

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    await db.collection("jobs").insertMany(batch, { ordered: false });
    restored += batch.length;
    process.stdout.write(`        Restored ${restored}/${jobs.length} jobs...\r`);
  }
  console.log(`\n        Successfully restored all ${restored} jobs.`);

  console.log("\nStep 5: Rebuilding indexes...");
  await Job.syncIndexes();
  console.log("        Indexes rebuilt successfully.");

  // Clean up test collections
  const testColls = ["_wtest", "_wt", "_writetest"];
  for (const collName of testColls) {
    try {
      await db.collection(collName).drop();
      console.log(`        Dropped unused test collection: ${collName}`);
    } catch {}
  }

  console.log("\nStep 6: Fetching updated database stats...");
  const finalStats = await db.command({ collStats: "jobs" });
  const finalDbStats = await db.stats();

  console.log("\n============================================================");
  console.log("                     CLEANUP SUMMARY");
  console.log("============================================================");
  console.log(`Jobs docs:               ${finalStats.count}`);
  console.log(`Jobs storageSize before: ${mb(initialStats.storageSize)}`);
  console.log(`Jobs storageSize after:  ${mb(finalStats.storageSize)}`);
  console.log(`Storage freed:           ${mb(initialStats.storageSize - finalStats.storageSize)}`);
  console.log(`Jobs indexSize:          ${mb(finalStats.totalIndexSize)}`);
  console.log("------------------------------------------------------------");
  console.log(`TOTAL DB storageSize:    ${mb(finalDbStats.storageSize)} / 512.00 MB`);
  console.log(`TOTAL DB totalSize:      ${mb(finalDbStats.storageSize + finalDbStats.indexSize)} / 512.00 MB`);
  console.log("============================================================\n");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("\n[ERROR] Reclaim storage failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
