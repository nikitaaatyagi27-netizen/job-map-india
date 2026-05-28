require("dotenv").config();

const connectDB = require("../config/db");
const { discoverAndIngestWorkdayBoards } = require("../services/workdayDiscoveryService");

async function run() {
  await connectDB();

  const result = await discoverAndIngestWorkdayBoards();

  console.log(
    `[WORKDAY DISCOVERY] Candidates ${result.candidatesFound} | validated ${result.validatedBoards} | ingested ${result.ingestedBoards} | new companies ${result.newCompanies}`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[WORKDAY DISCOVERY] Failed");
  console.error(error.message);
  process.exit(1);
});
