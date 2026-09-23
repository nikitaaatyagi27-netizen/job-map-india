// server/scripts/diagnoseZeroJobCompanies.js
//
// Run from the `server` folder:
//   node scripts/diagnoseZeroJobCompanies.js
//
// What it does:
//  1. Finds every company with zero ACTIVE jobs.
//  2. Breaks that down by ingestion source and by whether the company has a
//     known domain (domain is what lets extractJobsForZeroJobCompanies.js
//     guess an ATS slug).
//  3. Writes a CSV of candidates worth re-ingesting (has a domain, no jobs yet).
//
// Field names match server/models/Company.js and server/models/Job.js
// exactly — Job references its company via the `company` field (not
// `companyId`).

require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");

const CONFIG = {
  outCsvPath: path.join(__dirname, "zero_job_companies_with_domain.csv"),
};

async function main() {
  await connectDB();
  console.log("Connected to MongoDB.\n");

  // -------------------------------------------------------------------------
  // STEP 1: companyIds that DO have at least one active job.
  // Job.company is the ObjectId ref to Company (see models/Job.js).
  // -------------------------------------------------------------------------
  const activeCompanyIds = await Job.distinct("company", { isActive: true });
  const activeIdSet = new Set(activeCompanyIds.map(String));
  console.log(`Companies WITH at least one active job: ${activeIdSet.size}`);

  // -------------------------------------------------------------------------
  // STEP 2: pull all companies, split into has-jobs vs no-jobs
  // -------------------------------------------------------------------------
  const allCompanies = await Company.find(
    {},
    { source: 1, domain: 1, name: 1, lat: 1, lng: 1, atsProvider: 1, careersProvider: 1 }
  ).lean();

  const noJobCompanies = allCompanies.filter((c) => !activeIdSet.has(String(c._id)));
  console.log(`Companies with ZERO active jobs: ${noJobCompanies.length} / ${allCompanies.length}\n`);

  // -------------------------------------------------------------------------
  // STEP 3: breakdown by source
  // -------------------------------------------------------------------------
  const bySource = {};
  for (const c of noJobCompanies) {
    const src = c.source || "unknown";
    bySource[src] = bySource[src] || { total: 0, withDomain: 0 };
    bySource[src].total++;
    if (c.domain) bySource[src].withDomain++;
  }

  console.log("=== No-active-job companies, by source ===");
  console.log("source".padEnd(20), "no_jobs".padEnd(10), "has_domain");
  for (const [src, stats] of Object.entries(bySource).sort((a, b) => b[1].total - a[1].total)) {
    console.log(src.padEnd(20), String(stats.total).padEnd(10), stats.withDomain);
  }

  // -------------------------------------------------------------------------
  // STEP 4: write out the re-ingestion candidate list.
  // Companies that already have an atsProvider/careersProvider stamped are
  // more likely to succeed than a blind domain-slug guess, so flag those.
  // -------------------------------------------------------------------------
  const candidates = noJobCompanies.filter((c) => c.domain);
  const csvLines = ["_id,name,source,domain,atsProvider,careersProvider"];
  for (const c of candidates) {
    const safeName = (c.name || "").replace(/,/g, " ");
    csvLines.push(
      `${c._id},${safeName},${c.source || ""},${c.domain || ""},${c.atsProvider || ""},${c.careersProvider || ""}`
    );
  }
  fs.writeFileSync(CONFIG.outCsvPath, csvLines.join("\n"));
  console.log(`\nWrote ${candidates.length} re-ingestion candidates to ${CONFIG.outCsvPath}`);
  console.log(
    `(${noJobCompanies.length - candidates.length} companies have NO domain at all — ` +
      `these need a domain-discovery pass before we can even attempt job extraction.)\n`
  );

  // -------------------------------------------------------------------------
  // STEP 5: sanity-check — how many companies SHOULD be eligible for the map?
  // -------------------------------------------------------------------------
  const mapCandidateCount = allCompanies.filter((c) => activeIdSet.has(String(c._id))).length;
  console.log(`Sanity check — companies WITH active jobs (from this query): ${mapCandidateCount}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});