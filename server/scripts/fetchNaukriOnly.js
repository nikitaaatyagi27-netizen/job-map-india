// Run ONLY the Naukri scraper.
// Use this to test or manually trigger a Naukri ingestion without touching
// any other source (JSearch, ATS boards, etc.).
//
// Run: node scripts/fetchNaukriOnly.js

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const fetchNaukriJobs = require("../services/naukriService");

async function run() {
  await connectDB();
  console.log("[FETCH-NAUKRI] Starting Naukri-only ingestion run\n");

  const startedAt = Date.now();
  const saved = await fetchNaukriJobs();
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n[FETCH-NAUKRI] Done — ${saved} jobs saved in ${elapsedSec}s`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("[FETCH-NAUKRI] Fatal:", err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
