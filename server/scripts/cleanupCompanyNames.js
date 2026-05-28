require("dotenv").config();

const connectDB = require("../config/db");
const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { cleanCompanyNameOrUnknown } = require("../utils/cleanCompanyName");

async function cleanupCompanyNames() {
  const companies = await Company.find({}).select(
    "name domain website careersUrl"
  );

  let renamedCompanies = 0;
  let skippedConflicts = 0;
  let untouchedCompanies = 0;
  let syncedCareerSources = 0;

  for (const company of companies) {
    const cleanedDisplayName = cleanCompanyNameOrUnknown(company.name, [
      company.domain,
      company.website,
      company.careersUrl
    ]
      .filter(Boolean)
      .join(" "));
    const cleanedNormalizedName = normalizeCompanyName(cleanedDisplayName);

    if (!cleanedNormalizedName || cleanedNormalizedName === company.name) {
      untouchedCompanies++;
      continue;
    }

    const conflictingCompany = await Company.findOne({
      name: cleanedNormalizedName,
      _id: {
        $ne: company._id
      }
    }).select("_id");

    if (conflictingCompany) {
      skippedConflicts++;
      continue;
    }

    const previousName = company.name;
    company.name = cleanedNormalizedName;
    company.updatedAt = new Date();
    await company.save();

    const careerSourceUpdateResult = await CareerSource.updateMany(
      {
        company: company._id,
        companyName: previousName
      },
      {
        $set: {
          companyName: cleanedNormalizedName,
          updatedAt: new Date()
        }
      }
    );

    syncedCareerSources += careerSourceUpdateResult.modifiedCount || 0;
    renamedCompanies++;
  }

  return {
    totalCompanies: companies.length,
    renamedCompanies,
    untouchedCompanies,
    skippedConflicts,
    syncedCareerSources
  };
}

async function run() {
  await connectDB();

  const result = await cleanupCompanyNames();

  console.log(
    `[COMPANY NAME CLEANUP] total ${result.totalCompanies} | renamed ${result.renamedCompanies} | untouched ${result.untouchedCompanies} | conflicts ${result.skippedConflicts} | synced career sources ${result.syncedCareerSources}`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[COMPANY NAME CLEANUP] Failed");
  console.error(error.message);
  process.exit(1);
});
