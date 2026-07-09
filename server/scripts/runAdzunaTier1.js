require("dotenv").config();

// Run Adzuna ingestion for TIER-1 metros only (plus the India catch-all pass).
// Uses the real ingestion path, so jobs are saved AND embedded inline.
// Override the city list before the service module is loaded.
process.env.ADZUNA_CITIES = process.env.ADZUNA_CITIES ||
  "Bangalore,Bengaluru,Hyderabad,Pune,Mumbai,Chennai,Delhi,Noida,Gurugram,Gurgaon,Kolkata,India";

const connectDB = require("../config/db");
const Job = require("../models/Job");
const fetchAdzunaJobs = require("../services/adzunaService");

(async () => {
  await connectDB();

  const before = await Job.countDocuments({ source: "adzuna" });
  const beforeEmbedded = await Job.countDocuments({ source: "adzuna", embedding: { $ne: null } });
  console.log(`[ADZUNA TIER1] Adzuna jobs before: ${before} | embedded: ${beforeEmbedded}`);

  await fetchAdzunaJobs();

  const after = await Job.countDocuments({ source: "adzuna" });
  const afterEmbedded = await Job.countDocuments({ source: "adzuna", embedding: { $ne: null } });
  console.log(`[ADZUNA TIER1] Adzuna jobs after: ${after} (+${after - before} new)`);
  console.log(`[ADZUNA TIER1] Embedded after: ${afterEmbedded} (+${afterEmbedded - beforeEmbedded} newly embedded)`);
  console.log("[ADZUNA TIER1] Done.");
  process.exit();
})().catch((e) => {
  console.error("[ADZUNA TIER1] Failed:", e.message);
  process.exit(1);
});
