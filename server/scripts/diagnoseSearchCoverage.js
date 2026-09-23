require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");
const CareerSource = require("../models/CareerSource");

// Same per-source freshness cutoffs used by the live search (searchDBJobs).
// Kept in sync manually — see SOURCE_FRESHNESS_DAYS in skillBasedJobSearchService.js.
const SOURCE_FRESHNESS_DAYS = {
  naukri: 5, jsearch: 10, adzuna: 14, arbeitnow: 14, remotive: 14,
  greenhouse: 45, lever: 45, ashby: 45, smartrecruiters: 45,
  workday: 45, taleo: 45, successfactors: 45,
};
const DEFAULT_FRESHNESS_DAYS = 21;

function line() {
  console.log("─".repeat(70));
}

async function run() {
  await connectDB();

  console.log("\n[DIAGNOSTIC] Company / Job search-coverage report\n");
  line();

  // ── 1. Company totals ────────────────────────────────────────────────────
  const totalCompanies = await Company.countDocuments();
  console.log(`Total companies:                         ${totalCompanies}`);

  const byIntelStatus = await Company.aggregate([
    { $group: { _id: "$intelligenceStatus", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  console.log(`\nCompanies by intelligenceStatus:`);
  byIntelStatus.forEach(r => console.log(`  ${String(r._id || "(none)").padEnd(24)} ${r.count}`));

  // Coord sanity check — Company.pre('save') should guarantee finite lat/lng
  // for every doc created through the model, so this should read ~0. A
  // non-zero count usually means docs were inserted bypassing the model
  // (raw insertMany / a migration) rather than a live-filter problem.
  const badCoords = await Company.countDocuments({
    $or: [
      { lat: { $exists: false } }, { lng: { $exists: false } },
      { lat: null }, { lng: null },
      { lat: { $type: "string" } }, { lng: { $type: "string" } }
    ]
  });
  console.log(`\nCompanies with missing/invalid lat-lng:  ${badCoords} (expect ~0 — model enforces this on save)`);

  line();

  // ── 2. Job totals ────────────────────────────────────────────────────────
  const totalJobs = await Job.countDocuments();
  const activeJobs = await Job.countDocuments({ isActive: true });
  const activeEmbedded = await Job.countDocuments({ isActive: true, embeddedAt: { $ne: null } });
  const activeNotEmbedded = activeJobs - activeEmbedded;

  console.log(`Total jobs (any state):                  ${totalJobs}`);
  console.log(`Active jobs:                              ${activeJobs}`);
  console.log(`Active + embedded (searchable pool):      ${activeEmbedded}`);
  console.log(`Active but NOT embedded (invisible to DB search): ${activeNotEmbedded}`);
  if (activeNotEmbedded > 0) {
    console.log(`  → run: node server/scripts/backfillJobEmbeddings.js`);
  }

  line();

  // ── 3. Active+embedded jobs, by source, with freshness pass/fail ────────
  // This mirrors the exact filter searchDBJobs applies at query time.
  console.log(`Active+embedded jobs by source (searchable vs filtered out by freshness):\n`);
  const bySource = await Job.aggregate([
    { $match: { isActive: true, embeddedAt: { $ne: null } } },
    { $group: { _id: "$source", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  let totalFresh = 0;
  let totalStaleButActive = 0;

  for (const row of bySource) {
    const source = row._id || "(unknown)";
    const days = SOURCE_FRESHNESS_DAYS[source] ?? DEFAULT_FRESHNESS_DAYS;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const fresh = await Job.countDocuments({
      isActive: true,
      embeddedAt: { $ne: null },
      source,
      $or: [
        { lastSeenAt: { $gte: cutoff } },
        { lastSeenAt: { $exists: false }, firstSeenAt: { $gte: cutoff } }
      ]
    });
    const stale = row.count - fresh;
    totalFresh += fresh;
    totalStaleButActive += stale;

    console.log(
      `  ${source.padEnd(16)} total ${String(row.count).padEnd(6)} | ` +
      `fresh (≤${days}d) ${String(fresh).padEnd(6)} | stale-but-active ${stale}`
    );
  }
  console.log(`\n  TOTAL passing freshness filter right now: ${totalFresh}`);
  console.log(`  TOTAL active+embedded but excluded by freshness: ${totalStaleButActive}`);
  if (totalStaleButActive > 0) {
    console.log(`  → these jobs are real and marked active, but never surface in a search`);
    console.log(`    unless SEARCH_APPLY_FRESHNESS_FILTER=false, or they get re-seen by ingestion`);
  }

  line();

  // ── 4. Company job coverage ──────────────────────────────────────────────
  const companiesWithAnyJob = (await Job.distinct("company")).length;
  const companiesWithActiveJob = (await Job.distinct("company", { isActive: true })).length;
  const companiesWithSearchableJob = (await Job.distinct("company", {
    isActive: true, embeddedAt: { $ne: null }
  })).length;

  console.log(`Companies with ≥1 job ever ingested:      ${companiesWithAnyJob}`);
  console.log(`Companies with ≥1 ACTIVE job:              ${companiesWithActiveJob}`);
  console.log(`Companies with ≥1 active+embedded job:     ${companiesWithSearchableJob}`);

  const companiesWithZeroJobs = totalCompanies - companiesWithAnyJob;
  const pctZeroJobs = ((companiesWithZeroJobs / totalCompanies) * 100).toFixed(1);
  console.log(`\nCompanies with ZERO jobs ever ingested:   ${companiesWithZeroJobs} (${pctZeroJobs}% of all companies)`);
  console.log(`  → these are discovery placeholders (web-search / ATS-sitemap hits, etc.)`);
  console.log(`    that were registered but never had a job-fetch run against them.`);
  console.log(`    No matter how relevant a resume is, these can NEVER appear in results`);
  console.log(`    until their ingestion actually runs.`);

  line();

  // ── 5. CareerSource coverage — registered boards that were never fetched ─
  const totalCareerSources = await CareerSource.countDocuments();
  const companiesWithCareerSource = (await CareerSource.distinct("company")).length;

  // Companies that have a CareerSource (a board is registered) but still have
  // zero jobs — i.e. discovery found them, but ingestion never actually ran
  // the fetch (or the board came back empty).
  const companyIdsWithJobs = new Set((await Job.distinct("company")).map(String));
  const careerSourceCompanyIds = await CareerSource.distinct("company");
  const registeredButNoJobs = careerSourceCompanyIds.filter(id => !companyIdsWithJobs.has(String(id))).length;

  console.log(`Total CareerSource board registrations:   ${totalCareerSources}`);
  console.log(`Companies with ≥1 CareerSource:            ${companiesWithCareerSource}`);
  console.log(`Companies with a board registered but ZERO jobs ingested: ${registeredButNoJobs}`);
  if (registeredButNoJobs > 0) {
    console.log(`  → these boards were discovered but never actually fetched (or fetch`);
    console.log(`    returned 0 India-relevant jobs). Re-run ingestion for these sources,`);
    console.log(`    or check ingestion logs/priority — high company count with a low`);
    console.log(`    ingestion concurrency/cron frequency means a large backlog can sit`);
    console.log(`    unfetched for a long time.`);
  }

  line();

  // ── 6. Summary funnel ────────────────────────────────────────────────────
  console.log(`FUNNEL SUMMARY`);
  console.log(`  ${totalCompanies}  total companies`);
  console.log(`  → ${companiesWithAnyJob}  have ever had a job ingested`);
  console.log(`  → ${companiesWithActiveJob}  have a currently ACTIVE job`);
  console.log(`  → ${companiesWithSearchableJob}  have an active job that's embedded (searchable)`);
  console.log(`  → (further narrowed per-search by: vector similarity ≥0.62, freshness`);
  console.log(`     cutoff, title-relevance keyword match, garbage-name/job-board filter)`);
  console.log(`\nThat last narrowing is why a search returns ~100 companies even though`);
  console.log(`${companiesWithSearchableJob} companies are theoretically in the searchable pool.`);

  line();
  await require("mongoose").disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[DIAGNOSTIC] Failed:", error.message);
  process.exit(1);
});