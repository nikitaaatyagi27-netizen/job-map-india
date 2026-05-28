require("dotenv").config();

const connectDB = require("../config/db");
const { bootstrapCareerSourcesFromCompanyWebsites } = require("../services/companyWebsiteBootstrapService");

async function run() {
  await connectDB();

  const result = await bootstrapCareerSourcesFromCompanyWebsites();

  console.log(
    `[COMPANY WEBSITE SIGNALS] Scanned ${result.companiesScanned} companies | registered ${result.sourcesRegistered} sources | upgraded ${result.companiesUpgraded} companies`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[COMPANY WEBSITE SIGNALS] Bootstrap failed");
  console.error(error.message);
  process.exit(1);
});
