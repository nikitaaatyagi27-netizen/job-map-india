// server/scripts/stripInactiveJobData.js
//
// Strips the two heaviest fields — `embedding` (768-float vector, ~6KB/job)
// and `description` (raw scraped text, can be several KB/job) — from jobs
// that are already isActive: false. Inactive jobs aren't returned by search
// (searchDBJobs() only queries isActive: true), so their embedding and full
// description text are pure dead weight sitting in storage.
//
// The job DOCUMENT itself is kept (title, company, location, dates, source)
// so your history/analytics/dedup logic still has a record it existed — only
// the two heavy fields get cleared.
//
// Run from the `server` folder:
//   node scripts/stripInactiveJobData.js --dry-run     (see what would happen)
//   node scripts/stripInactiveJobData.js                (actually strip)

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const connectDB = require("../config/db");
const Job = require("../models/Job");

const DRY_RUN = process.argv.includes("--dry-run");

function line() {
  console.log("─".repeat(70));
}

async function run() {
  await connectDB();

  console.log("\n[CLEANUP] Strip embedding + description from inactive jobs\n");
  line();

  const filter = {
    isActive: false,
    $or: [
      { embedding: { $exists: true, $ne: null, $not: { $size: 0 } } },
      { description: { $exists: true, $ne: null, $ne: "" } },
    ],
  };

  const matchCount = await Job.countDocuments(filter);
  console.log(`Inactive jobs still carrying embedding and/or description: ${matchCount}`);

  if (matchCount === 0) {
    console.log("\nNothing to strip.");
    await require("mongoose").disconnect();
    process.exit(0);
  }

  // Rough size estimate before/after, same math as checkStorageUsage.js
  const sample = await Job.aggregate([
    { $match: filter },
    { $sample: { size: Math.min(2000, matchCount) } },
    {
      $project: {
        embeddingBytes: { $multiply: [{ $size: { $ifNull: ["$embedding", []] } }, 8] },
        descriptionBytes: { $strLenBytes: { $ifNull: ["$description", ""] } },
      },
    },
    {
      $group: {
        _id: null,
        avgEmbeddingBytes: { $avg: "$embeddingBytes" },
        avgDescriptionBytes: { $avg: "$descriptionBytes" },
      },
    },
  ]);

  if (sample.length > 0) {
    const { avgEmbeddingBytes, avgDescriptionBytes } = sample[0];
    const estFreedMB = ((avgEmbeddingBytes + avgDescriptionBytes) * matchCount) / (1024 * 1024);
    console.log(`Estimated space to be freed: ~${estFreedMB.toFixed(1)} MB`);
  }
  line();

  if (DRY_RUN) {
    console.log(`\nDRY RUN — nothing changed. Remove --dry-run to actually strip these ${matchCount} job(s).`);
    console.log(`Note: MongoDB reclaims disk space gradually / on compaction — the DB-reported`);
    console.log(`storage size may not drop immediately after this runs, but the data itself`);
    console.log(`is gone right away, and Atlas will reclaim the space in the background.`);
    await require("mongoose").disconnect();
    process.exit(0);
  }

  const result = await Job.updateMany(filter, {
    $set: { embedding: null, description: null, embedHash: null, embeddedAt: null },
  });

  console.log(`\nStripped ${result.modifiedCount} job(s).`);
  console.log(`(embedding, description, embedHash, embeddedAt cleared — title/company/location/dates kept)`);

  await require("mongoose").disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[CLEANUP] Failed:", error.message);
  process.exit(1);
});