const Job = require("../models/Job");
const Company = require("../models/Company");

// Computes and persists hiring velocity for every company that has jobs.
// Run this after each ingestion cycle.
//
// Velocity = how many NEW jobs (firstSeenAt) appeared in last 7 / 30 days.
// Trend = compare the 7-day daily rate to the 23-day daily rate before it:
//   accelerating → this week's rate is >50% higher than prior period
//   slowing       → this week's rate is >50% lower than prior period
//   stable        → everything else
async function computeHiringVelocity() {
  const now = Date.now();
  const cutoff7  = new Date(now - 7  * 24 * 60 * 60 * 1000);
  const cutoff30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  console.log("[HIRING VELOCITY] Computing for all companies...");

  // Aggregate new-job counts per company over two windows in a single pass
  const pipeline = [
    {
      $match: {
        isActive: true,
        firstSeenAt: { $gte: cutoff30 }
      }
    },
    {
      $group: {
        _id: "$company",
        last7Days: {
          $sum: {
            $cond: [{ $gte: ["$firstSeenAt", cutoff7] }, 1, 0]
          }
        },
        last30Days: { $sum: 1 }
      }
    }
  ];

  const rows = await Job.aggregate(pipeline);
  console.log(`[HIRING VELOCITY] Processing ${rows.length} companies`);

  let updated = 0;

  const bulkOps = rows
    .filter(r => r._id)
    .map(r => {
      const last7  = r.last7Days  || 0;
      const last30 = r.last30Days || 0;

      // Daily rates
      const rate7  = last7  / 7;                       // jobs/day in last week
      const prior  = (last30 - last7);                 // jobs in days 8-30
      const rate23 = prior  / 23;                      // jobs/day in prior period

      let trend = "stable";
      if (rate7 > 0 && rate23 > 0) {
        if (rate7 >= rate23 * 1.5) trend = "accelerating";
        else if (rate7 <= rate23 * 0.5) trend = "slowing";
      } else if (rate7 > 0 && rate23 === 0) {
        trend = "accelerating";   // new activity where there was none
      }

      updated++;
      return {
        updateOne: {
          filter: { _id: r._id },
          update: {
            $set: {
              "hiringVelocity.last7Days":  last7,
              "hiringVelocity.last30Days": last30,
              "hiringVelocity.trend":      trend,
              updatedAt: new Date()
            }
          }
        }
      };
    });

  if (bulkOps.length > 0) {
    await Company.bulkWrite(bulkOps, { ordered: false });
  }

  // Zero out companies not in the result (no recent jobs)
  const activeCompanyIds = new Set(rows.filter(r => r._id).map(r => String(r._id)));
  await Company.updateMany(
    { _id: { $nin: [...activeCompanyIds].map(id => require("mongoose").Types.ObjectId.createFromHexString(id)) } },
    { $set: { "hiringVelocity.last7Days": 0, "hiringVelocity.last30Days": 0, "hiringVelocity.trend": "stable" } }
  );

  console.log(`[HIRING VELOCITY] Updated ${updated} companies`);
  return updated;
}

module.exports = { computeHiringVelocity };
