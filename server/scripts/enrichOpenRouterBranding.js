require("dotenv").config();

const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");
const { resolveBranding } = require("../utils/brandingResolver");
const {
  looksLikeGuessedDomain,
  resolveCompanyWithOpenRouter,
  isOpenRouterLimitError
} = require("../utils/openrouterResolver");

async function enrichOpenRouterBranding() {
  await connectDB();

  const companies = await Company.find({});

  console.log("Companies to inspect:", companies.length);

  let updated = 0;

  for (const company of companies) {
    const needsHelp =
      !company.domain ||
      !company.logo ||
      looksLikeGuessedDomain(company);

    if (!needsHelp) {
      continue;
    }

    const jobs = await Job.find({ company: company._id }).limit(3);

    try {
      const result = await resolveCompanyWithOpenRouter(company, jobs);

      if (!result || !result.officialDomain || result.confidence === "low") {
        continue;
      }

      company.domain = result.officialDomain;

      const branding = resolveBranding(company);

      if (branding.logo) {
        company.logo = branding.logo;
      }

      company.brandingSource = `openrouter-${branding.brandingSource}`;
      company.brandingConfidence = result.confidence;
      company.brandingReasoning = result.reasoning;
      company.updatedAt = new Date();

      await company.save();
      updated += 1;

      console.log(
        "OpenRouter branding updated:",
        company.name,
        "| domain:",
        company.domain,
        "| confidence:",
        company.brandingConfidence
      );
    } catch (error) {
      if (isOpenRouterLimitError(error)) {
        console.log(
          "OpenRouter API limit reached. Stopping OpenRouter branding enrichment for now."
        );
        break;
      }

      console.log("OpenRouter branding failed for:", company.name);
      console.log(error.response?.data?.error?.message || error.message);
    }
  }

  console.log("Total OpenRouter branding updates:", updated);
  process.exit();
}

enrichOpenRouterBranding().catch((error) => {
  console.error("OpenRouter branding enrichment crashed");
  console.error(error.message);
  process.exit(1);
});
