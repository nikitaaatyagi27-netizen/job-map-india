require("dotenv").config();

const connectDB = require("../config/db");
const IngestionRun = require("../models/IngestionRun");

// Keeps only the most recent N runs. Adjust via env or --keep flag.
// Usage:
//   node scripts/cleanupIngestionRuns.js            (keeps most recent 50)
//   node scripts/cleanupIngestionRuns.js --keep 20   (keeps most recent 20)

const keepArgIndex = process.argv.indexOf("--keep");
const KEEP = keepArgIndex !== -1
  ? Number(process.argv[keepArgIndex + 1])
  : Number(process.env.INGESTION_RUN_KEEP || 50);

(async () => {
  await connectDB();

  const total = await IngestionRun.countDocuments();
  console.log(`Total ingestion run logs: ${total}`);

  if (total <= KEEP) {
    console.log(`Nothing to delete — already at or below keep limit (${KEEP}).`);
    process.exit();
  }

  const idsToKeep = await IngestionRun.find({})
    .sort({ createdAt: -1 })
    .limit(KEEP)
    .select("_id")
    .lean();

  const keepIds = idsToKeep.map(d => d._id);

  const result = await IngestionRun.deleteMany({ _id: { $nin: keepIds } });

  console.log(`Deleted: ${result.deletedCount}`);
  console.log(`Remaining: ${KEEP}`);

  process.exit();
})().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});