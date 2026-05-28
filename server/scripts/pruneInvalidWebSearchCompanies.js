require("dotenv").config();

const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");
const CareerSource = require("../models/CareerSource");
const { fromHost, isGenericCompanyName } = require("../utils/cleanCompanyName");
const normalizeCompanyName = require("../utils/normalizeCompanyName");

const BLOCKED_DOMAIN_PATTERNS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "naukri.com",
  "monsterindia.com",
  "foundit.in",
  "foundit.com",
  "timesjobs.com",
  "shine.com",
  "apna.co",
  "internshala.com",
  "wellfound.com",
  "angel.co",
  "tracxn.com",
  "crunchbase.com",
  "jobs.",
  "careers.",
  "boards."
];

function isBlockedDomain(value) {
  const domain = String(value || "").toLowerCase().replace(/^www\./, "").trim();

  if (!domain) {
    return false;
  }

  return BLOCKED_DOMAIN_PATTERNS.some((pattern) => domain.includes(pattern));
}

function looksInvalidCompanyName(name) {
  const value = String(name || "").toLowerCase().trim();

  if (!value) {
    return true;
  }

  if (isGenericCompanyName(value)) {
    return true;
  }

  if (/^\d+\s+/.test(value)) {
    return true;
  }

  if (/\b(job|jobs|vacancy|vacancies|opening|openings|hiring|walkin|fresher|salary)\b/i.test(value)) {
    return true;
  }

  return false;
}

function inferNameFromCompanyDomain(company) {
  const domain = String(company.domain || "").toLowerCase().replace(/^www\./, "").trim();

  if (!domain || isBlockedDomain(domain)) {
    return null;
  }

  const hostName = fromHost(domain);
  if (!hostName) {
    return null;
  }

  const normalized = normalizeCompanyName(hostName);
  if (!normalized || looksInvalidCompanyName(normalized)) {
    return null;
  }

  return normalized;
}

async function pruneInvalidWebSearchCompanies({ apply = false } = {}) {
  const candidates = await Company.find({
    $or: [
      { source: "web-search" },
      { discoverySources: "web-search" }
    ]
  }).select("name domain website careersUrl source discoverySources");

  const jobCounts = await Job.aggregate([
    {
      $group: {
        _id: "$company",
        count: { $sum: 1 }
      }
    }
  ]);

  const jobCountMap = new Map(jobCounts.map((row) => [String(row._id), row.count]));

  const toDelete = [];
  const toRename = [];

  for (const company of candidates) {
    const id = String(company._id);
    const jobs = jobCountMap.get(id) || 0;
    const invalidName = looksInvalidCompanyName(company.name);
    const blockedDomain = isBlockedDomain(company.domain) || isBlockedDomain(company.website) || isBlockedDomain(company.careersUrl);

    if (!invalidName && !blockedDomain) {
      continue;
    }

    const suggestedName = inferNameFromCompanyDomain(company);

    if (jobs > 0 && suggestedName && suggestedName !== company.name) {
      toRename.push({ company, suggestedName, jobs });
      continue;
    }

    if (jobs === 0) {
      toDelete.push({ company, jobs, invalidName, blockedDomain });
    }
  }

  if (!apply) {
    return {
      scanned: candidates.length,
      deleteCandidates: toDelete.length,
      renameCandidates: toRename.length,
      deleted: 0,
      renamed: 0
    };
  }

  let deleted = 0;
  let renamed = 0;

  for (const row of toRename) {
    const { company, suggestedName } = row;

    const existing = await Company.findOne({
      name: suggestedName,
      _id: { $ne: company._id }
    }).select("_id");

    if (existing) {
      continue;
    }

    company.name = suggestedName;
    company.updatedAt = new Date();
    await company.save();

    await CareerSource.updateMany(
      { company: company._id },
      {
        $set: {
          companyName: suggestedName,
          updatedAt: new Date()
        }
      }
    );

    renamed += 1;
  }

  for (const row of toDelete) {
    const companyId = row.company._id;

    await CareerSource.deleteMany({ company: companyId });
    await Company.deleteOne({ _id: companyId });
    deleted += 1;
  }

  return {
    scanned: candidates.length,
    deleteCandidates: toDelete.length,
    renameCandidates: toRename.length,
    deleted,
    renamed
  };
}

async function run() {
  await connectDB();

  const apply = process.argv.includes("--apply");
  const summary = await pruneInvalidWebSearchCompanies({ apply });

  console.log(
    `[PRUNE WEB SEARCH] apply=${apply} | scanned ${summary.scanned} | rename candidates ${summary.renameCandidates} | delete candidates ${summary.deleteCandidates} | renamed ${summary.renamed} | deleted ${summary.deleted}`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[PRUNE WEB SEARCH] Failed");
  console.error(error.message);
  process.exit(1);
});
