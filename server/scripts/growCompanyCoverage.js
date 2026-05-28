require("dotenv").config();

const connectDB = require("../config/db");
const { runCompanyGrowthCycle } = require("../services/companyGrowthOrchestratorService");

async function run() {
  await connectDB();

  await runCompanyGrowthCycle("manual");

  process.exit(0);
}

run().catch((error) => {
  console.error("[COMPANY GROWTH] Failed");
  console.error(error.message);
  process.exit(1);
});
