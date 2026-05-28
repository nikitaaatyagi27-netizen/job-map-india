require("dotenv").config();

const connectDB = require("../config/db");
const { discoverCompanyWebsiteCareers } = require("../services/companyWebsiteDiscoveryService");

async function run() {
  await connectDB();

  const result = await discoverCompanyWebsiteCareers();

  console.log(
    `[WEBSITE DISCOVERY] scanned ${result.scannedCompanies} | updated ${result.updatedCompanies} | providers ${result.providersDiscovered} | careers urls ${result.careersUrlsDiscovered}`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[WEBSITE DISCOVERY] Failed");
  console.error(error.message);
  process.exit(1);
});
