require("dotenv").config();

const connectDB = require("../config/db");
const Job = require("../models/Job");
const { parseJobDescription } = require("../utils/jobDescriptionParser");

const BATCH_SIZE = 500;
const FORCE = process.argv.includes("--force");

function buildUpdate(job) {
  const parsed = parseJobDescription({
    title: job.title,
    description: job.description
  });

  const update = {
    requiredSkills: parsed.requiredSkills,
    qualifications: parsed.qualifications,
    responsibilityBullets: parsed.responsibilityBullets,
    extractionConfidence: parsed.extractionConfidence,
    parsedDescriptionAt: new Date()
  };

  if (parsed.experienceLevel) update.experienceLevel = parsed.experienceLevel;
  if (parsed.yearsMin != null) update.yearsMin = parsed.yearsMin;
  if (parsed.yearsMax != null) update.yearsMax = parsed.yearsMax;
  if (parsed.experienceText) update.experienceText = parsed.experienceText;

  return { update, parsed };
}

async function backfillParsedJobDescriptions() {
  const filter = FORCE
    ? { description: { $nin: [null, ""] } }
    : {
        description: { $nin: [null, ""] },
        $or: [
          { parsedDescriptionAt: null },
          { parsedDescriptionAt: { $exists: false } }
        ]
      };

  const total = await Job.countDocuments(filter);
  console.log(`[JOB DESCRIPTION BACKFILL] Jobs to parse: ${total}${FORCE ? " (force)" : ""}`);

  if (total === 0) {
    console.log("[JOB DESCRIPTION BACKFILL] Nothing to do.");
    return;
  }

  let processed = 0;
  let withExperience = 0;
  let withSkills = 0;
  let withBullets = 0;

  while (processed < total) {
    const batch = await Job.find(filter)
      .select("title description")
      .limit(BATCH_SIZE)
      .lean();

    if (batch.length === 0) break;

    const bulkOps = batch.map((job) => {
      const { update, parsed } = buildUpdate(job);
      if (parsed.experienceLevel || parsed.yearsMin != null) withExperience++;
      if (parsed.requiredSkills.length > 0) withSkills++;
      if (parsed.responsibilityBullets.length > 0) withBullets++;

      return {
        updateOne: {
          filter: { _id: job._id },
          update: { $set: update }
        }
      };
    });

    if (bulkOps.length > 0) {
      await Job.bulkWrite(bulkOps);
    }

    processed += batch.length;
    console.log(
      `[JOB DESCRIPTION BACKFILL] ${processed}/${total} processed | ` +
      `experience=${withExperience}, skills=${withSkills}, bullets=${withBullets}`
    );
  }

  console.log("\n[JOB DESCRIPTION BACKFILL] Done.");
  console.log(`  Total parsed:      ${processed}`);
  console.log(`  Experience found:  ${withExperience}`);
  console.log(`  Skills found:      ${withSkills}`);
  console.log(`  Bullets found:     ${withBullets}`);
}

async function run() {
  await connectDB();
  await backfillParsedJobDescriptions();
  process.exit(0);
}

run().catch((err) => {
  console.error("[JOB DESCRIPTION BACKFILL] Failed:", err.message);
  process.exit(1);
});
