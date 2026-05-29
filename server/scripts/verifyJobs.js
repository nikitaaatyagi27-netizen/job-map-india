require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { runJobVerification } = require("../services/jobVerificationService");

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log("Connected to MongoDB");

  if (DRY_RUN) {
    console.log("[DRY RUN] No jobs will actually be marked inactive.");
  }

  const result = await runJobVerification({ dryRun: DRY_RUN });
  console.log("\nResult:", result);
  await mongoose.disconnect();
}

run().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
