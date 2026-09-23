// server/scripts/deleteJoblessCompanies.js
//
// Deletes companies that have ZERO jobs in the DB — these are dead weight on
// the map (a company with no jobs shouldn't be showing a pin anyway) and
// free up space with no loss of anything currently visible/useful.
//
// SAFE BY DEFAULT: companies that have a `domain` set are KEPT even if they
// have zero jobs, since those are your highest-leverage re-ingestion targets
// (see checkCompanyGaps.js "group 3" — 311 companies ready for direct
// probing). Only domain-less, job-less companies are deleted by default —
// pass --includeWithDomain to also delete those 311 if you're sure you don't
// want them.
//
// Run from the `server` folder:
//   node scripts/deleteJoblessCompanies.js --dry-run     (see what would happen, ALWAYS run first)
//   node scripts/deleteJoblessCompanies.js                (actually delete)
//
// Flags:
//   --dry-run             List/count what would be deleted, delete nothing.
//   --includeWithDomain   Also delete the small set of job-less companies
//                          that DO have a domain (311 as of last check).
//                          Off by default — these are worth keeping since
//                          they're the companies extractJobsForZeroJobCompanies.js
//                          / companyWebsiteDiscoveryService.js can still act on.
//   --limit=10000          Safety cap on how many companies a single run can
//                          delete. Default: 10000.

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_WITH_DOMAIN = process.argv.includes("--includeWithDomain");

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 10000;

function line() {
  console.log("─".repeat(70));
}

async function run() {
  await connectDB();

  console.log("\n[CLEANUP] Delete companies with zero jobs\n");
  line();

  const totalCompanies = await Company.countDocuments();
  console.log(`Total companies: ${totalCompanies}`);

  // Companies that DO have at least one job — never touch these.
  const companyIdsWithJobs = new Set((await Job.distinct("company")).map(String));

  // Pull id + domain for every company so we can split by domain presence
  // without a second DB round-trip per company.
  const allCompanies = await Company.find({}).select("_id domain").lean();

  const joblessNoDomain = [];
  const joblessWithDomain = [];

  for (const c of allCompanies) {
    if (companyIdsWithJobs.has(String(c._id))) continue; // has jobs, keep
    if (c.domain) {
      joblessWithDomain.push(c._id);
    } else {
      joblessNoDomain.push(c._id);
    }
  }

  console.log(`\nJob-less companies WITHOUT a domain: ${joblessNoDomain.length} (will be deleted)`);
  console.log(`Job-less companies WITH a domain:    ${joblessWithDomain.length} (${INCLUDE_WITH_DOMAIN ? "will be deleted (--includeWithDomain set)" : "KEPT — re-ingestion targets"})`);
  line();

  let idsToDelete = joblessNoDomain;
  if (INCLUDE_WITH_DOMAIN) {
    idsToDelete = idsToDelete.concat(joblessWithDomain);
  }

  if (idsToDelete.length === 0) {
    console.log("\nNothing to delete.");
    await require("mongoose").disconnect();
    process.exit(0);
  }

  if (idsToDelete.length > LIMIT) {
    console.log(`${idsToDelete.length} companies match, but safety limit is ${LIMIT}.`);
    console.log(`Only the first ${LIMIT} will be deleted this run. Re-run to continue, or pass --limit=<n> to raise the cap.`);
    idsToDelete = idsToDelete.slice(0, LIMIT);
  }

  // Show a small sample so you can eyeball what's about to go.
  const sample = await Company.find({ _id: { $in: idsToDelete.slice(0, 10) } })
    .select("name domain source")
    .lean();
  console.log(`\nSample of companies about to be deleted:\n`);
  for (const c of sample) {
    console.log(`  ${c.name} | domain: ${c.domain || "(none)"} | source: ${c.source || "(unknown)"}`);
  }
  line();

  console.log(`\nTotal to delete this run: ${idsToDelete.length}`);

  if (DRY_RUN) {
    console.log(`\nDRY RUN — nothing deleted. Remove --dry-run to actually delete these ${idsToDelete.length} companies.`);
    await require("mongoose").disconnect();
    process.exit(0);
  }

  const result = await Company.deleteMany({ _id: { $in: idsToDelete } });
  console.log(`\nDeleted ${result.deletedCount} companies.`);

  const remaining = await Company.countDocuments();
  console.log(`Companies remaining in DB: ${remaining}`);

  await require("mongoose").disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[CLEANUP] Failed:", error.message);
  process.exit(1);
});