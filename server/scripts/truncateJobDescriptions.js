// server/scripts/truncateJobDescriptions.js
//
// Truncates the `description` field on Job docs down to 1500 characters —
// the exact length jobEmbedText.js already uses when building embedding
// text (see utils/jobEmbedText.js: `job.description.slice(0, 1500)`).
// Anything beyond that:
//   - is never used for the embedding (already capped at 1500 chars there)
//   - is never rendered by the frontend (client links out via `applyLink`
//     to the original posting instead of showing description in-app —
//     confirmed via grep across client/src, no component reads job.description)
// So keeping full multi-KB descriptions in the DB is pure storage cost with
// no product benefit. Truncating (not deleting) keeps enough that
// re-embedding still works identically if you ever need to re-run it.
//
// Run from the `server` folder:
//   node scripts/truncateJobDescriptions.js --dry-run     (see estimated savings, ALWAYS run first)
//   node scripts/truncateJobDescriptions.js                (actually truncate)
//
// Safe to run against ACTIVE jobs — this does not touch embedding,
// requiredSkills, qualifications, responsibilityBullets, or any other field.

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const connectDB = require("../config/db");
const Job = require("../models/Job");

const DRY_RUN = process.argv.includes("--dry-run");
const KEEP_CHARS = 1500;

function line() {
  console.log("─".repeat(70));
}

async function run() {
  await connectDB();

  console.log("\n[CLEANUP] Truncate job descriptions to 1500 chars\n");
  line();

  // Only touch docs where description is actually longer than the keep
  // length — no point rewriting docs that are already short.
  const filter = {
    $expr: { $gt: [{ $strLenCP: { $ifNull: ["$description", ""] } }, KEEP_CHARS] },
  };

  const matchCount = await Job.countDocuments(filter);
  console.log(`Jobs with description longer than ${KEEP_CHARS} chars: ${matchCount}`);

  if (matchCount === 0) {
    console.log("\nNothing to truncate.");
    await require("mongoose").disconnect();
    process.exit(0);
  }

  // Estimate savings from a sample.
  const sample = await Job.aggregate([
    { $match: filter },
    { $sample: { size: Math.min(2000, matchCount) } },
    {
      $project: {
        currentBytes: { $strLenBytes: { $ifNull: ["$description", ""] } },
      },
    },
    { $group: { _id: null, avgCurrentBytes: { $avg: "$currentBytes" } } },
  ]);

  if (sample.length > 0) {
    const avgCurrentBytes = sample[0].avgCurrentBytes;
    const avgSavedBytes = Math.max(0, avgCurrentBytes - KEEP_CHARS);
    const estTotalSavedMB = (avgSavedBytes * matchCount) / (1024 * 1024);
    console.log(`Avg current description size: ${(avgCurrentBytes / 1024).toFixed(2)} KB`);
    console.log(`Estimated space to be freed:  ~${estTotalSavedMB.toFixed(1)} MB`);
  }
  line();

  if (DRY_RUN) {
    console.log(`\nDRY RUN — nothing changed. Remove --dry-run to actually truncate these ${matchCount} job(s).`);
    await require("mongoose").disconnect();
    process.exit(0);
  }

  // Bulk truncate via aggregation pipeline update (MongoDB 4.2+) — avoids
  // pulling every description into Node just to slice and write it back.
  const result = await Job.updateMany(filter, [
    {
      $set: {
        description: { $substrCP: ["$description", 0, KEEP_CHARS] },
      },
    },
  ]);

  console.log(`\nTruncated ${result.modifiedCount} job(s) to ${KEEP_CHARS} chars.`);

  await require("mongoose").disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[CLEANUP] Failed:", error.message);
  process.exit(1);
});