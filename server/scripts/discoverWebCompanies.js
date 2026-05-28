require("dotenv").config();

const connectDB = require("../config/db");
const { discoverWebCompanies } = require("../services/webCompanyDiscoveryService");

async function run() {
  await connectDB();

  const result = await discoverWebCompanies();

  console.log(
    `[WEB COMPANY DISCOVERY] Queries ${result.queriesRun} | discovered companies ${result.discoveredCompanies}`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[WEB COMPANY DISCOVERY] Failed");
  console.error(error.message);
  process.exit(1);
});
