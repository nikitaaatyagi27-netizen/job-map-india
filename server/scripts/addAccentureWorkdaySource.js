// Registers Accenture's confirmed Workday board as a CareerSource.
// Confirmed live tenant: accenture.wd103.myworkdayjobs.com/en-US/AccentureCareers
//
// Unlike Greenhouse/Lever/SmartRecruiters, workdayService.js reads its targets
// from CareerSource documents (provider: "workday") rather than a hardcoded
// CURATED_*_TENANTS array — so this is a one-time DB seed, not a code edit.
//
// Run: node server/scripts/addAccentureWorkdaySource.js

require("dotenv").config();
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");
const normalizeCompanyName = require("../utils/normalizeCompanyName");

const BOARD_URL = "https://accenture.wd103.myworkdayjobs.com/en-US/AccentureCareers";
const DISPLAY_NAME = "Accenture";
const DOMAIN = "accenture.com";

async function run() {
  await connectDB();

  const normalizedName = normalizeCompanyName(DISPLAY_NAME);

  let company = await Company.findOne({ name: normalizedName });
  if (!company) {
    company = await Company.create({
      name: normalizedName,
      logo: null,
      domain: DOMAIN,
      website: `https://www.${DOMAIN}`,
      careersUrl: BOARD_URL,
      careersProvider: "workday",
      discoverySources: ["browser-network-capture"],
      intelligenceStatus: "seeded",
      source: "browser-network-capture",
      brandingSource: "browser-network-capture",
      brandingConfidence: "high",
      brandingReasoning: "Workday tenant confirmed via live browser network capture"
    });
    console.log(`Created company: ${normalizedName}`);
  } else {
    console.log(`Company already exists: ${normalizedName}`);
  }

  const existing = await CareerSource.findOne({
    company: company._id,
    provider: "workday",
    boardUrl: BOARD_URL
  });

  if (existing) {
    if (existing.status !== "active") {
      existing.status = "active";
      existing.updatedAt = new Date();
      await existing.save();
      console.log("Re-activated existing CareerSource");
    } else {
      console.log("CareerSource already active — nothing to do");
    }
  } else {
    await CareerSource.create({
      company: company._id,
      companyName: normalizedName,
      provider: "workday",
      boardUrl: BOARD_URL,
      careersUrl: BOARD_URL,
      discoveryMethod: "browser-network-capture",
      parserType: "workday-cxs-api",
      status: "active",
      jobsFound: 0
    });
    console.log("Created new CareerSource for Accenture (Workday)");
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("[ADD ACCENTURE] Failed:", err.message);
  process.exit(1);
});