require("dotenv").config();

const connectDB = require("../config/db");
const Job = require("../models/Job");
const { classifyExperienceLevel } = require("../utils/experienceLevelClassifier");

const BATCH_SIZE = 500;

async function backfillExperienceLevel() {
  const total = await Job.countDocuments({ experienceLevel: null });
  console.log(`[BACKFILL] Jobs with no experienceLevel: ${total}`);

  if (total === 0) {
    console.log("[BACKFILL] Nothing to do.");
    return;
  }

  let processed = 0;
  let classified = 0;
  let skipped = 0;
  let cursor = 0;

  while (cursor < total) {
    const batch = await Job.find({ experienceLevel: null })
      .select("title description")
      .limit(BATCH_SIZE)
      .lean();

    if (batch.length === 0) break;

    const bulkOps = [];

    for (const job of batch) {
      const level = classifyExperienceLevel(job.title, job.description);
      if (level) {
        bulkOps.push({
          updateOne: {
            filter: { _id: job._id },
            update: { $set: { experienceLevel: level } }
          }
        });
        classified++;
      } else {
        skipped++;
      }
    }

    if (bulkOps.length > 0) {
      await Job.bulkWrite(bulkOps);
    }

    processed += batch.length;
    cursor += batch.length;
    console.log(`[BACKFILL] ${processed}/${total} processed — ${classified} classified, ${skipped} no signal`);
  }

  console.log("\n[BACKFILL] Done.");
  console.log(`  Total jobs:    ${total}`);
  console.log(`  Classified:    ${classified}`);
  console.log(`  No signal:     ${skipped} (null — will pass fresher filter as unknown)`);
}

async function run() {
  await connectDB();
  await backfillExperienceLevel();
  process.exit(0);
}

run().catch((err) => {
  console.error("[BACKFILL] Failed:", err.message);
  process.exit(1);
});
