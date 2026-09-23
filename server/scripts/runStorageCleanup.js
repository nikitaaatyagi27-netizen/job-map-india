// Runs the storage cleanup service to delete old and inactive jobs.
// This is essential for managing the 512MB limit on free MongoDB Atlas tiers.
//
// Usage:
//   Run with default settings (3-day grace period for inactive jobs):
//   $ node scripts/runStorageCleanup.js
//
//   Run aggressively, deleting ALL inactive jobs immediately:
//   $ node scripts/runStorageCleanup.js --graceDays=0

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { runStorageCleanup } = require("../services/storageCleanupService");

async function run() {
  await connectDB();
  console.log("Connected to MongoDB\n");

  const arg = process.argv.find(a => a.startsWith('--graceDays='));
  const graceDays = arg ? Number(arg.split('=')[1]) : undefined;

  if (graceDays != null) {
    console.log(`[STORAGE CLEANUP] Running with custom grace period: ${graceDays} days`);
  } else {
    console.log(`[STORAGE CLEANUP] Running with default grace period.`);
  }

  const startedAt = Date.now();
  const summary = await runStorageCleanup({ graceDays });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log("\n=== SUMMARY ===");
  console.log(`Elapsed: ${elapsedSec}s`);
  console.log(`Inactive jobs deleted: ${summary.inactiveDeleted}`);
  console.log(`Oldest jobs deleted (to meet cap): ${summary.cappedDeleted}`);
  console.log(`Total jobs deleted: ${summary.inactiveDeleted + summary.cappedDeleted}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[STORAGE CLEANUP] Failed:", error.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
