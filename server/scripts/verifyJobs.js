require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { runJobVerification } = require("../services/jobVerificationService");

const DRY_RUN = process.argv.includes("--dry-run");
// --all checks EVERY active aggregator job regardless of age (manual cleanup).
// Without it, the default 3-day age gate applies (same as the cron).
const ALL = process.argv.includes("--all");

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log("Connected to MongoDB");

  if (DRY_RUN) {
    console.log("[DRY RUN] No jobs will actually be marked inactive.");
  }
  if (ALL) {
    console.log("[ALL] Ignoring age gate — verifying every active aggregator job.");
  }

  const result = await runJobVerification({ dryRun: DRY_RUN, minAgeDays: ALL ? 0 : undefined });
  console.log("\nResult:", result);
  await mongoose.disconnect();
}

run().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
