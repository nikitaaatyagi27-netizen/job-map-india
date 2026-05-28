require("dotenv").config();

const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");
const { resolveBranding } = require("../utils/brandingResolver");
const { looksLikeGuessedDomain } = require("../utils/openrouterResolver");
const {
  searchOfficialWebsite,
  isTavilyLimitError
} = require("../utils/tavilySearchResolver");

async function enrichSearchBranding() {
  await connectDB();

  const companies = await Company.find({});
  let updated = 0;

  console.log("Companies to inspect:", companies.length);

  for (const company of companies) {
    if (company.domain && !looksLikeGuessedDomain(company) && company.logo) {
      continue;
    }

    const jobs = await Job.find({ company: company._id }).limit(3);

    try {
      const result = await searchOfficialWebsite(company, jobs);

      if (!result?.officialDomain) {
        continue;
      }

      company.domain = result.officialDomain;

      const branding = resolveBranding(company);

      if (branding.logo) {
        company.logo = branding.logo;
      }

      company.brandingSource = `tavily-${branding.brandingSource}`;
      company.brandingConfidence = result.confidence;
      company.brandingReasoning = result.reasoning;
      company.updatedAt = new Date();

      await company.save();
      updated += 1;

      console.log(
        "Search branding updated:",
        company.name,
        "| domain:",
        company.domain,
        "| confidence:",
        company.brandingConfidence
      );
    } catch (error) {
      if (isTavilyLimitError(error)) {
        console.log(
          "Tavily API limit reached. Stopping search-based branding enrichment for now."
        );
        break;
      }

      console.log("Search branding failed for:", company.name);
      console.log(error.response?.data?.detail || error.message);
    }
  }

  console.log("Total search branding updates:", updated);
  process.exit();
}

enrichSearchBranding().catch((error) => {
  console.error("Search branding enrichment crashed");
  console.error(error.message);
  process.exit(1);
});
