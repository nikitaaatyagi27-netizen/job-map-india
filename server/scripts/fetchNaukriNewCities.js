// One-off script — ingests Naukri jobs only for cities added in the latest
// expansion. Run this instead of fetchNaukriOnly.js to avoid re-processing
// cities that already have data.
//
// Run: node scripts/fetchNaukriNewCities.js

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const fetchNaukriJobs = require("../services/naukriService");

const NEW_CITIES = [
  // North
  "Dehradun", "Agra", "Meerut", "Amritsar", "Ludhiana",
  // West
  "Vadodara", "Goa",
  // South
  "Vijayawada", "Thiruvananthapuram", "Madurai", "Mangaluru",
  // East
  "Jamshedpur", "Siliguri",
  // Central
  "Jabalpur", "Varanasi"
];

async function run() {
  await connectDB();
  console.log(`[FETCH-NEW-CITIES] Running Naukri ingestion for ${NEW_CITIES.length} new cities:`);
  console.log(`[FETCH-NEW-CITIES] ${NEW_CITIES.join(", ")}\n`);

  const startedAt = Date.now();
  const saved = await fetchNaukriJobs({ cities: NEW_CITIES });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n[FETCH-NEW-CITIES] Done — ${saved} jobs saved in ${elapsedSec}s`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("[FETCH-NEW-CITIES] Fatal:", err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
