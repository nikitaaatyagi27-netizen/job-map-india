// Diagnostic: why are only a fraction of jobs visible/searchable?
// Run from server/: node scripts/diagnoseVisibility.js
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Job = require("../models/Job");
const SourceHealth = require("../models/SourceHealth");

async function main() {
  await connectDB();

  console.log("\n=== Job counts by source × isActive × hasEmbedding ===");
  const byStatus = await Job.aggregate([
    { $group: {
        _id: { source: "$source", isActive: "$isActive" },
        count: { $sum: 1 },
        hasEmbedding: { $sum: { $cond: [{ $ne: ["$embedding", null] }, 1, 0] } }
    }},
    { $sort: { "_id.source": 1, "_id.isActive": -1 } }
  ]);
  console.table(byStatus.map(r => ({
    source: r._id.source,
    isActive: r._id.isActive,
    count: r.count,
    hasEmbedding: r.hasEmbedding
  })));

  console.log("\n=== Totals ===");
  const total = await Job.countDocuments({});
  const active = await Job.countDocuments({ isActive: true });
  const activeEmbedded = await Job.countDocuments({ isActive: true, embedding: { $ne: null } });
  console.log(`Total jobs in DB:          ${total}`);
  console.log(`isActive:true:             ${active}`);
  console.log(`isActive:true + embedded:  ${activeEmbedded}  <- only these are searchable at all`);

  console.log("\n=== Source health (failures / backoff) ===");
  const health = await SourceHealth.find({}).sort({ score: 1 }).lean();
  console.table(health.map(h => ({
    sourceKey: h.sourceKey,
    score: h.score,
    consecutiveFailures: h.consecutiveFailures,
    backoffUntil: h.backoffUntil,
    lastSuccessAt: h.lastSuccessAt,
    lastFailureAt: h.lastFailureAt,
    lastError: h.lastError
  })));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error("Diagnostic failed:", e);
  process.exit(1);
});