// server/scripts/checkStorageUsage.js
//
// Run from the `server` folder:
//   node scripts/checkStorageUsage.js
//
// What it does:
//  Reports actual storage usage per collection, plus a breakdown of WHICH
//  fields on the Job collection are eating the most space (embedding vector
//  vs description text vs everything else). Point of this: "512MB full" can
//  mean very different fixes depending on the cause —
//    - lots of jobs with huge scraped description text  -> truncate/strip descriptions
//    - lots of jobs each carrying a 768-float embedding  -> strip embeddings on inactive jobs
//    - just a huge raw job count                          -> delete old/inactive jobs
//  This script tells you which one you actually have before you delete
//  anything.

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Job = require("../models/Job");
const Company = require("../models/Company");

function line() {
  console.log("─".repeat(70));
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

async function run() {
  await connectDB();
  const db = mongoose.connection.db;

  console.log("\n[DIAGNOSTIC] Storage usage breakdown\n");
  line();

  // ── 1. Overall DB stats ───────────────────────────────────────────────
  const dbStats = await db.stats();
  console.log("1) Overall database stats\n");
  console.log(`   Data size:    ${mb(dbStats.dataSize)}`);
  console.log(`   Storage size: ${mb(dbStats.storageSize)} (on-disk, includes fragmentation)`);
  console.log(`   Index size:   ${mb(dbStats.indexSize)}`);
  console.log(`   Total:        ${mb(dbStats.dataSize + dbStats.indexSize)}`);
  line();

  // ── 2. Per-collection breakdown ──────────────────────────────────────
  const collections = await db.listCollections().toArray();
  console.log("2) Per-collection breakdown\n");
  console.log("collection".padEnd(20), "docs".padEnd(10), "data".padEnd(12), "indexes".padEnd(12), "avg doc size");

  const collStats = [];
  for (const c of collections) {
    try {
      const stats = await db.collection(c.name).stats();
      collStats.push(stats);
      console.log(
        c.name.padEnd(20),
        String(stats.count).padEnd(10),
        mb(stats.size).padEnd(12),
        mb(stats.totalIndexSize).padEnd(12),
        (stats.avgObjSize ? (stats.avgObjSize / 1024).toFixed(1) + " KB" : "n/a")
      );
    } catch {
      // system collections etc. may not support stats() the same way — skip quietly
    }
  }
  line();

  // ── 3. Job collection field-level breakdown ──────────────────────────
  // Sample a chunk of jobs and measure the actual byte size of the
  // embedding array vs description text vs everything else, so we know
  // which field to target.
  console.log("3) Job collection — what's actually taking the space\n");

  const totalJobs = await Job.countDocuments();
  const SAMPLE_SIZE = Math.min(2000, totalJobs);

  const sample = await Job.aggregate([
    { $sample: { size: SAMPLE_SIZE } },
    {
      $project: {
        embeddingBytes: {
          $multiply: [{ $size: { $ifNull: ["$embedding", []] } }, 8], // 8 bytes per float64
        },
        descriptionBytes: { $strLenBytes: { $ifNull: ["$description", ""] } },
        otherFieldsApproxBytes: { $literal: 500 }, // rough flat estimate for title/location/skills/etc.
      },
    },
    {
      $group: {
        _id: null,
        avgEmbeddingBytes: { $avg: "$embeddingBytes" },
        avgDescriptionBytes: { $avg: "$descriptionBytes" },
        totalEmbeddingBytes: { $sum: "$embeddingBytes" },
        totalDescriptionBytes: { $sum: "$descriptionBytes" },
      },
    },
  ]);

  if (sample.length > 0 && totalJobs > 0) {
    const { avgEmbeddingBytes, avgDescriptionBytes, totalEmbeddingBytes, totalDescriptionBytes } = sample[0];
    const scaleFactor = totalJobs / SAMPLE_SIZE;

    const estTotalEmbeddingMB = (totalEmbeddingBytes * scaleFactor) / (1024 * 1024);
    const estTotalDescriptionMB = (totalDescriptionBytes * scaleFactor) / (1024 * 1024);

    console.log(`   Sampled ${SAMPLE_SIZE} of ${totalJobs} jobs, scaled up to estimate full collection:\n`);
    console.log(`   Avg embedding size per job:    ${(avgEmbeddingBytes / 1024).toFixed(2)} KB`);
    console.log(`   Avg description size per job:  ${(avgDescriptionBytes / 1024).toFixed(2)} KB`);
    console.log(``);
    console.log(`   ESTIMATED total embedding data:    ${estTotalEmbeddingMB.toFixed(1)} MB`);
    console.log(`   ESTIMATED total description data:  ${estTotalDescriptionMB.toFixed(1)} MB`);
  }
  line();

  // ── 4. Active vs inactive job split — inactive jobs are the safest to
  //       trim data from since they're not being shown to users anymore.
  const activeCount = await Job.countDocuments({ isActive: true });
  const inactiveCount = totalJobs - activeCount;
  const inactiveWithEmbedding = await Job.countDocuments({
    isActive: false,
    embedding: { $exists: true, $ne: null, $not: { $size: 0 } },
  });
  const inactiveWithDescription = await Job.countDocuments({
    isActive: false,
    description: { $exists: true, $ne: null, $ne: "" },
  });

  console.log("4) Active vs inactive jobs\n");
  console.log(`   Active:   ${activeCount}`);
  console.log(`   Inactive: ${inactiveCount}`);
  console.log(`   Inactive jobs still carrying an embedding:   ${inactiveWithEmbedding}`);
  console.log(`   Inactive jobs still carrying full description: ${inactiveWithDescription}`);
  if (inactiveWithEmbedding > 0 || inactiveWithDescription > 0) {
    console.log(`\n   → These are the safest/highest-leverage things to strip first — inactive`);
    console.log(`     jobs aren't shown in search results, so their embedding/description data`);
    console.log(`     is dead weight. See scripts/stripInactiveJobData.js.`);
  }

  line();
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[DIAGNOSTIC] Failed:", error.message);
  process.exit(1);
});