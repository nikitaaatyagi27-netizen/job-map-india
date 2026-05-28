require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Job = require("../models/Job");
const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");
const { runDedup } = require("../services/dedupeService");

async function run() {
  await connectDB();

  await runDedup();

  console.log("[DEDUPE] Syncing indexes");
  await Job.syncIndexes();
  await Company.syncIndexes();
  await CareerSource.syncIndexes();

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[DEDUPE] Failed");
  console.error(error.message);
  process.exit(1);
});
