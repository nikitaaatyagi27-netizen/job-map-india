const CareerSource = require("../models/CareerSource");
const Company = require("../models/Company");
const { scrapeJobsWithLLM } = require("./universalScraperService");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const getCoords = require("../utils/geocode");
const extractDomain = require("../utils/extractDomain");
const normalizeCompanyName = require("../utils/normalizeCompanyName");

async function findOrCreateCompany(companyName, careersUrl, location) {
  const normalized = normalizeCompanyName(companyName);

  let company = await Company.findOne({ name: normalized });

  if (!company) {
    const coords = await getCoords(location || "India");

    company = await Company.create({
      name: normalized,
      logo: null,
      domain: extractDomain({ employer_name: companyName, job_apply_link: careersUrl }),
      city: location || "India",
      location: location || "India",
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      source: "universal"
    });

    console.log(`[Universal] New company: ${companyName}`);
  }

  return company;
}

async function fetchUniversalJobs() {
  console.log("[Universal] Starting universal LLM scrape ingestion");

  const sources = await CareerSource.find({
    provider: "universal",
    status: "active"
  }).populate("company");

  let total = 0;

  for (const source of sources) {
    const company = source.company;

    if (!company) {
      console.warn(`[Universal] Skipping source ${source.boardUrl} — company not found`);
      continue;
    }

    try {
      const jobs = await scrapeJobsWithLLM(source.boardUrl);

      for (const job of jobs) {
        await upsertIngestedJob({
          title: job.title,
          company: company._id,
          location: job.location || "India",
          applyLink: job.applyUrl || source.boardUrl,
          description: job.employmentType || null,
          source: "universal",
          postedDate: null,
          isRemote: (job.location || "").toLowerCase().includes("remote")
        });
      }

      total += jobs.length;

      await CareerSource.findByIdAndUpdate(source._id, {
        $set: {
          jobsFound: jobs.length,
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
          lastError: null,
          failureCount: 0,
          status: "active",
          updatedAt: new Date()
        }
      });

      console.log(`[Universal] ${company.name}: ${jobs.length} jobs`);
    } catch (err) {
      console.warn(`[Universal] Failed for ${source.boardUrl}: ${err.message}`);

      await CareerSource.findByIdAndUpdate(source._id, {
        $set: {
          lastCheckedAt: new Date(),
          lastError: err.message,
          lastFailureAt: new Date(),
          updatedAt: new Date()
        },
        $inc: { failureCount: 1 }
      });
    }
  }

  console.log(`[Universal] Done. Total India jobs: ${total}`);
  return total;
}

async function registerUniversalSource({ companyName, careersUrl, location }) {
  if (!companyName || !careersUrl) {
    throw new Error("companyName and careersUrl are required");
  }

  const company = await findOrCreateCompany(companyName, careersUrl, location);

  const source = await CareerSource.findOneAndUpdate(
    { company: company._id, provider: "universal", boardUrl: careersUrl },
    {
      $set: {
        companyName: company.name,
        careersUrl,
        discoveryMethod: "admin-registered",
        parserType: "llm-universal",
        status: "active",
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true, returnDocument: "after" }
  );

  return { company, source };
}

module.exports = { fetchUniversalJobs, registerUniversalSource };
