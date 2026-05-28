require("dotenv").config();

const connectDB = require("../config/db");
const { bootstrapCareerSourcesFromJobs } = require("../services/careerSourceBootstrapService");

async function run() {
  await connectDB();

  const result = await bootstrapCareerSourcesFromJobs();

  console.log(
    `[CAREER SOURCES] Scanned ${result.companiesScanned} companies | registered ${result.sourcesRegistered} sources | upgraded ${result.companiesUpgraded} companies`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[CAREER SOURCES] Bootstrap failed");
  console.error(error.message);
  process.exit(1);
});
