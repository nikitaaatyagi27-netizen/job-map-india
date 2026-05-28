require("dotenv").config();

const connectDB = require("../config/db");
const { buildIndiaWideDiscoveryQueries } = require("../config/indiaDiscoveryQueries");
const { upsertDiscoveryQuery } = require("../services/discoveryQueryService");

async function run() {
  await connectDB();
  const queries = [
    ...buildIndiaWideDiscoveryQueries("web-company"),
    ...buildIndiaWideDiscoveryQueries("workday-board")
  ];

  let upserted = 0;

  for (const entry of queries) {
    await upsertDiscoveryQuery(entry);
    upserted += 1;
  }

  console.log(`[DISCOVERY QUERIES] Upserted ${upserted} queries`);

  process.exit(0);
}

run().catch((error) => {
  console.error("[DISCOVERY QUERIES] Failed");
  console.error(error.message);
  process.exit(1);
});
