// scripts/fetchNaukriByCity.js
//
// Populate jobs for ONE OR MORE specific cities via the Naukri ingestion
// pipeline (services/naukriService.js). Saves real jobs to MongoDB, same
// as fetchNaukriOnly.js, but scoped to the city/cities you pass in.
//
// Usage:
//   node scripts/fetchNaukriByCity.js "Bengaluru"
//   node scripts/fetchNaukriByCity.js "Bengaluru,Mumbai,Pune"
//
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const fetchNaukriJobs = require("../services/naukriService");

async function run() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/fetchNaukriByCity.js "Bengaluru" or "Bengaluru,Mumbai"');
    process.exit(1);
  }
  const cities = arg.split(",").map((c) => c.trim()).filter(Boolean);

  await connectDB();
  console.log(`[FETCH-NAUKRI-CITY] Starting ingestion for: ${cities.join(", ")}\n`);

  const startedAt = Date.now();
  const saved = await fetchNaukriJobs({ cities });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n[FETCH-NAUKRI-CITY] Done — ${saved} jobs saved in ${elapsedSec}s`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("[FETCH-NAUKRI-CITY] Fatal:", err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});