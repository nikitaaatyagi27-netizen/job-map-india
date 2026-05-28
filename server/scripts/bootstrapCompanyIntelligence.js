require("dotenv").config();

const connectDB = require("../config/db");
const { syncCompanyIntelligenceMetadata } = require("../services/companyIntelligenceService");

async function run() {
  await connectDB();
  const result = await syncCompanyIntelligenceMetadata();

  console.log(
    `[COMPANY INTELLIGENCE] Scanned ${result.scannedCompanies} companies | updated ${result.updatedCompanies}`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[COMPANY INTELLIGENCE] Bootstrap failed");
  console.error(error.message);
  process.exit(1);
});
