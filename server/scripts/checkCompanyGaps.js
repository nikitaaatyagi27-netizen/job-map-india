require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");

function line() {
  console.log("─".repeat(70));
}

async function run() {
  await connectDB();

  console.log("\n[DIAGNOSTIC] Companies missing jobs / missing domain\n");
  line();

  const totalCompanies = await Company.countDocuments();
  console.log(`Total companies: ${totalCompanies}`);
  line();

  // ── 1. Companies with NO jobs in the DB ──────────────────────────────────
  const companyIdsWithJobs = new Set((await Job.distinct("company")).map(String));
  const allCompanyIds = (await Company.find({}).select("_id").lean()).map(c => String(c._id));
  const noJobIds = allCompanyIds.filter(id => !companyIdsWithJobs.has(id));

  const noJobCount = noJobIds.length;
  const withJobCount = totalCompanies - noJobCount;
  const pctNoJob = ((noJobCount / totalCompanies) * 100).toFixed(1);

  console.log("1) Companies WITHOUT any job in the DB\n");
  console.log(`   With ≥1 job:      ${withJobCount}`);
  console.log(`   WITHOUT a job:    ${noJobCount} (${pctNoJob}%)`);
  line();

  // ── 2. Companies with NO domain ──────────────────────────────────────────
  const noDomainFilter = {
    $or: [
      { domain: { $exists: false } },
      { domain: null },
      { domain: "" }
    ]
  };

  const noDomainCount = await Company.countDocuments(noDomainFilter);
  const withDomainCount = totalCompanies - noDomainCount;
  const pctNoDomain = ((noDomainCount / totalCompanies) * 100).toFixed(1);

  console.log("2) Companies WITHOUT a domain\n");
  console.log(`   With a domain:    ${withDomainCount}`);
  console.log(`   WITHOUT a domain: ${noDomainCount} (${pctNoDomain}%)`);
  line();

  // ── 3. Overlap — the companies that need the most help ──────────────────
  // No jobs AND no domain = nothing to search, nothing to probe for a career
  // page either. These are the ones that need name-based discovery
  // (Tavily search via companyWebsiteDiscoveryService.js) before anything
  // else — running ATS discovery or job-fetching against them won't help
  // until a domain/website is found first.
  const noDomainIds = new Set(
    (await Company.find(noDomainFilter).select("_id").lean()).map(c => String(c._id))
  );
  const noJobAndNoDomain = noJobIds.filter(id => noDomainIds.has(id)).length;
  const noJobButHasDomain = noJobCount - noJobAndNoDomain;

  console.log("3) Overlap — of the companies WITHOUT a job:\n");
  console.log(`   ...also WITHOUT a domain (need discovery first): ${noJobAndNoDomain}`);
  console.log(`   ...but DO have a domain (ready for direct probing/ingestion): ${noJobButHasDomain}`);
  console.log(`\n   → "${noJobButHasDomain}" is your highest-leverage target group: they already`);
  console.log(`     have a domain, so companyWebsiteDiscoveryService.js can probe their`);
  console.log(`     /careers, /jobs etc. paths directly, no Tavily search needed first.`);

  line();
  await require("mongoose").disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[DIAGNOSTIC] Failed:", error.message);
  process.exit(1);
});