require("dotenv").config();

const connectDB = require("../config/db");
const Company = require("../models/Company");
const { resolveBranding } = require("../utils/brandingResolver");

async function enrichBranding() {
  await connectDB();

  const companies = await Company.find({
    $or: [
      { logo: null },
      { logo: "" },
      { domain: null },
      { domain: "" },
      { brandingSource: { $in: [null, "", "none"] } }
    ]
  });

  console.log("Companies to inspect:", companies.length);

  let updated = 0;

  for (const company of companies) {
    const branding = resolveBranding(company);

    let changed = false;

    if (!company.domain && branding.domain) {
      company.domain = branding.domain;
      changed = true;
    }

    if (!company.logo && branding.logo) {
      company.logo = branding.logo;
      changed = true;
    }

    if (company.brandingSource !== branding.brandingSource) {
      company.brandingSource = branding.brandingSource;
      changed = true;
    }

    if (company.brandingConfidence !== branding.brandingConfidence) {
      company.brandingConfidence = branding.brandingConfidence;
      changed = true;
    }

    if (!changed) {
      continue;
    }

    company.updatedAt = new Date();
    await company.save();
    updated += 1;

    console.log(
      "Branding updated:",
      company.name,
      "| source:",
      company.brandingSource,
      "| confidence:",
      company.brandingConfidence
    );
  }

  console.log("Total branding updates:", updated);
  process.exit();
}

enrichBranding().catch((error) => {
  console.error("Branding enrichment failed");
  console.error(error.message);
  process.exit(1);
});
