require("dotenv").config();

// Run Naukri ingestion for TIER-1 metros only. Uses the real ingestion path
// (sort=f → freshest jobs first), saving AND embedding inline.
// Set the city override before the service module is loaded.
process.env.NAUKRI_CITIES = process.env.NAUKRI_CITIES ||
  "Bengaluru,Hyderabad,Chennai,Mumbai,Pune,Delhi,Noida,Gurugram,Kolkata";

const connectDB = require("../config/db");
const Job = require("../models/Job");
const fetchNaukriJobs = require("../services/naukriService");

(async () => {
  await connectDB();

  const before = await Job.countDocuments({ source: "naukri" });
  const beforeEmbedded = await Job.countDocuments({ source: "naukri", embedding: { $ne: null } });
  console.log(`[NAUKRI TIER1] Naukri jobs before: ${before} | embedded: ${beforeEmbedded}`);
  console.log(`[NAUKRI TIER1] Cities: ${process.env.NAUKRI_CITIES}`);

  await fetchNaukriJobs();

  const after = await Job.countDocuments({ source: "naukri" });
  const afterEmbedded = await Job.countDocuments({ source: "naukri", embedding: { $ne: null } });
  console.log(`[NAUKRI TIER1] Naukri jobs after: ${after} (+${after - before} new)`);
  console.log(`[NAUKRI TIER1] Embedded after: ${afterEmbedded} (+${afterEmbedded - beforeEmbedded} newly embedded)`);
  console.log("[NAUKRI TIER1] Done.");
  process.exit();
})().catch((e) => {
  console.error("[NAUKRI TIER1] Failed:", e.message);
  process.exit(1);
});
