// server/scripts/checkEmbeddingCoverage.js
//
// Run from the `server` folder:
//   node scripts/checkEmbeddingCoverage.js
//
// What it does:
//  Reports how many Job docs have a real embedding vector vs. none, broken
//  down by isActive and by source. `embedding` is `select: false` in the
//  schema (models/Job.js), so a plain Job.find() will NOT return it — every
//  query below explicitly does .select("+embedding") to make sure we're
//  actually checking the real field, not silently getting `undefined` for
//  every doc and miscounting everything as "missing".

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const connectDB = require("../config/db");
const Job = require("../models/Job");

function line() {
  console.log("─".repeat(70));
}

async function run() {
  await connectDB();

  console.log("\n[DIAGNOSTIC] Job embedding coverage\n");
  line();

  const totalJobs = await Job.countDocuments();
  console.log(`Total jobs in DB: ${totalJobs}`);
  line();

  // ── 1. Overall: has a real embedding vs missing/null/empty ──────────────
  // A job "has" an embedding only if the field is an array with length > 0.
  // Mongoose stores `default: null`, so $exists:true alone isn't enough —
  // some docs may have embedding explicitly set to null or [].
  const withEmbedding = await Job.countDocuments({
    embedding: { $exists: true, $ne: null, $not: { $size: 0 } },
  });
  const withoutEmbedding = totalJobs - withEmbedding;
  const pctWith = totalJobs ? (withEmbedding / totalJobs) * 100 : 0;
  const pctWithout = totalJobs ? 100 - pctWith : 0;

  console.log("1) Overall embedding coverage\n");
  console.log(`   WITH embedding:    ${withEmbedding} (${pctWith.toFixed(1)}%)`);
  console.log(`   WITHOUT embedding: ${withoutEmbedding} (${pctWithout.toFixed(1)}%)`);
  line();

  // ── 2. Breakdown by isActive — missing embeddings on ACTIVE jobs matter
  //       most, since those are the ones that should be showing up in search.
  const activeTotal = await Job.countDocuments({ isActive: true });
  const activeWithEmbedding = await Job.countDocuments({
    isActive: true,
    embedding: { $exists: true, $ne: null, $not: { $size: 0 } },
  });
  const activeWithoutEmbedding = activeTotal - activeWithEmbedding;
  const pctActiveWith = activeTotal ? ((activeWithEmbedding / activeTotal) * 100).toFixed(1) : "0.0";

  console.log("2) Active jobs only (isActive: true) — these are what search actually uses\n");
  console.log(`   Active jobs total:        ${activeTotal}`);
  console.log(`   Active WITH embedding:    ${activeWithEmbedding} (${pctActiveWith}%)`);
  console.log(`   Active WITHOUT embedding: ${activeWithoutEmbedding}`);
  if (activeWithoutEmbedding > 0) {
    console.log(`\n   → These ${activeWithoutEmbedding} active-but-unembedded jobs are invisible to`);
    console.log(`     semantic search (searchDBJobs() only queries embedding: {$ne:null}).`);
    console.log(`     Run scripts/backfillJobEmbeddings.js to fix this.`);
  }
  line();

  // ── 3. Breakdown by source — helps spot whether one ingestion pipeline
  //       (e.g. a recent backfill script) is systematically skipping the
  //       embedding step.
  const bySource = await Job.aggregate([
    {
      $group: {
        _id: "$source",
        total: { $sum: 1 },
        withEmbedding: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $isArray: "$embedding" },
                  { $gt: [{ $size: { $ifNull: ["$embedding", []] } }, 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { total: -1 } },
  ]);

  console.log("3) Breakdown by source\n");
  console.log("source".padEnd(20), "total".padEnd(10), "with_embedding".padEnd(16), "missing");
  for (const s of bySource) {
    const missing = s.total - s.withEmbedding;
    console.log(
      (s._id || "unknown").padEnd(20),
      String(s.total).padEnd(10),
      String(s.withEmbedding).padEnd(16),
      missing
    );
  }

  line();
  await require("mongoose").disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[DIAGNOSTIC] Failed:", error.message);
  process.exit(1);
});