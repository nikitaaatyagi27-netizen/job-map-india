// server/scripts/cleanupBadRemoteJobs.js
//
// One-off cleanup: removes jobs that were incorrectly saved by
// extractJobsForZeroJobCompanies.js before the isRemote-override bug was
// fixed. That bug let any `isRemote: true` job through regardless of its
// actual (non-India) location — e.g. Paymentology's "DevOps Engineer" in
// Vietnam got saved as an "India job" purely because it was remote.
//
// This targets jobs where source = 'ashby' (the only fetcher affected) and
// the location string does NOT contain an India signal, restricted to a
// specific company by name so it doesn't touch anything else in the DB.
//
// Run from the `server` folder:
//   node scripts/cleanupBadRemoteJobs.js --company="paymentology"
//
// Add --dry-run to just list what WOULD be deleted without deleting anything.

require("dotenv").config();
const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");
const { isIndianLocation } = require("../utils/indiaLocation");

const DRY_RUN = process.argv.includes("--dry-run");
const companyArg = process.argv.find((a) => a.startsWith("--company="));
const companyName = companyArg ? companyArg.split("=")[1] : null;

async function main() {
  if (!companyName) {
    console.error('Usage: node scripts/cleanupBadRemoteJobs.js --company="paymentology" [--dry-run]');
    process.exit(1);
  }

  await connectDB();

  const company = await Company.findOne({ name: new RegExp(`^${companyName}$`, "i") });
  if (!company) {
    console.error(`No company found matching name "${companyName}"`);
    process.exit(1);
  }
  console.log(`Found company: ${company.name} (${company._id})`);

  const jobs = await Job.find({ company: company._id, source: "ashby" }).lean();
  console.log(`Found ${jobs.length} ashby job(s) for this company.\n`);

  const badJobs = jobs.filter((j) => !isIndianLocation(j.location, { hasIndianPresence: true }));

  console.log(`${badJobs.length} of them do NOT have an India location signal:\n`);
  for (const j of badJobs) {
    console.log(`  ${DRY_RUN ? "[WOULD DELETE]" : "[DELETING]"} ${j.title} | ${j.location}`);
  }

  if (!DRY_RUN && badJobs.length > 0) {
    const ids = badJobs.map((j) => j._id);
    const result = await Job.deleteMany({ _id: { $in: ids } });
    console.log(`\nDeleted ${result.deletedCount} job(s).`);
  } else if (DRY_RUN) {
    console.log(`\n(--dry-run set, nothing was deleted. Re-run without --dry-run to actually delete these.)`);
  }

  await require("mongoose").disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});