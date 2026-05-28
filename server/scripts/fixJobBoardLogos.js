require("dotenv").config();

const connectDB = require("../config/db");
const Company = require("../models/Company");
const { isTrustedStoredLogo } = require("../utils/brandingResolver");

async function fixJobBoardLogos() {
  await connectDB();

  const companies = await Company.find({});
  let fixed = 0;

  for (const company of companies) {
    if (!company.logo) {
      continue;
    }

    if (isTrustedStoredLogo(company.logo)) {
      continue;
    }

    company.logo = null;
    company.updatedAt = new Date();
    await company.save();
    fixed += 1;

    console.log("Removed untrusted stored logo:", company.name);
  }

  console.log("Total job-board/untrusted logos removed:", fixed);
  process.exit();
}

fixJobBoardLogos().catch((error) => {
  console.error("Fix job-board logos failed");
  console.error(error.message);
  process.exit(1);
});
