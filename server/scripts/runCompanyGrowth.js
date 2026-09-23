// Runs the full company growth and discovery cycle.
// This is the primary script for finding and registering new companies from
// various sources like GitHub, web search, and YouTube.
//
// Usage:
//   node scripts/runCompanyGrowth.js
//
// This script calls the companyGrowthOrchestratorService, which requires
// API keys like GITHUB_TOKEN and SERPER_API_KEY to be set in the .env file
// for its discovery modules to function.

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { runCompanyGrowthCycle } = require("../services/companyGrowthOrchestratorService");

async function run() {
  await connectDB();
  console.log("[COMPANY GROWTH] Starting manual discovery cycle...\n");
  await runCompanyGrowthCycle("manual");
  console.log("\n[COMPANY GROWTH] Manual discovery cycle finished.");
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[COMPANY GROWTH] Discovery cycle failed:", error.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});