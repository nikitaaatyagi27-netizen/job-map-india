const CareerSource = require("../models/CareerSource");
const Company = require("../models/Company");

// ATS providers in priority order — if a company has multiple, pick the best one.
// Priority reflects data quality and how recognisable the badge is to job seekers.
const ATS_PRIORITY = [
  "workday", "greenhouse", "lever", "ashby",
  "smartrecruiters", "successfactors", "taleo"
];
const ATS_SET = new Set(ATS_PRIORITY);

function bestProvider(providers) {
  for (const p of ATS_PRIORITY) {
    if (providers.has(p)) return p;
  }
  return null;
}

// Scans all CareerSource records and stamps Company.atsProvider where it's missing.
// Safe to call multiple times — only touches companies that don't already have a value.
async function backfillAtsProviders() {
  console.log("[ATS BACKFILL] Starting...");

  // Aggregate: for each company, collect the set of ATS providers
  const rows = await CareerSource.aggregate([
    { $match: { provider: { $in: ATS_PRIORITY }, status: "active" } },
    { $group: { _id: "$company", providers: { $addToSet: "$provider" } } }
  ]);

  console.log(`[ATS BACKFILL] Found ${rows.length} companies with ATS sources`);

  const bulkOps = rows
    .filter(r => r._id)
    .map(r => {
      const providerSet = new Set(r.providers.filter(p => ATS_SET.has(p)));
      const chosen = bestProvider(providerSet);
      if (!chosen) return null;
      return {
        updateOne: {
          filter: { _id: r._id },   // update ALL companies, not just those missing it
          update: { $set: { atsProvider: chosen, updatedAt: new Date() } }
        }
      };
    })
    .filter(Boolean);

  if (bulkOps.length > 0) {
    const result = await Company.bulkWrite(bulkOps, { ordered: false });
    console.log(`[ATS BACKFILL] Updated ${result.modifiedCount} companies`);
    return result.modifiedCount;
  }

  console.log("[ATS BACKFILL] Nothing to update");
  return 0;
}

module.exports = { backfillAtsProviders };
