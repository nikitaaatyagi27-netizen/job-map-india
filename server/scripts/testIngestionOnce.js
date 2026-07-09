require("dotenv").config();

const connectDB = require("../config/db");
const { getIngestionSourceCatalog } = require("../config/ingestionSourceCatalog");
const { runIngestionQueue } = require("../services/ingestionOrchestratorService");
const Job = require("../models/Job");

// Sources to test. Pass as args, e.g. `node scripts/testIngestionOnce.js greenhouse lever`.
// Pass source keys as args (e.g. `greenhouse lever`), or "all" to run the full
// catalog exactly as the cron does. Defaults to a single clean ATS source.
const args = process.argv.slice(2).map(s => s.toLowerCase().trim());
const runAll = args.includes("all");
const requested = args.length && !runAll ? args : ["greenhouse"];

function selectTasks(keys) {
  const catalog = getIngestionSourceCatalog();
  if (runAll) return catalog;
  const wanted = new Set(keys);
  return catalog.filter(t => wanted.has(t.key));
}

async function run() {
  await connectDB();

  const before = await Job.countDocuments({});
  const beforeEmbedded = await Job.countDocuments({ isActive: true, embedding: { $ne: null } });

  const tasks = selectTasks(requested);
  if (!tasks.length) {
    console.error(`No matching sources for: ${requested.join(", ")}`);
    process.exit(1);
  }

  console.log(`[TEST INGEST] Running sources: ${tasks.map(t => t.key).join(", ")}`);
  console.log(`[TEST INGEST] Jobs before: ${before} | fresh embedded before: ${beforeEmbedded}`);

  // Exact same call the cron uses (runScheduledIngestion), just a scoped catalog.
  const summary = await runIngestionQueue(tasks, {
    trigger: "manual-test",
    concurrency: Math.max(Number(process.env.INGESTION_QUEUE_CONCURRENCY || 2), 1),
    retries: Math.max(Number(process.env.INGESTION_QUEUE_RETRIES || 1), 0)
  });

  console.log(
    `[TEST INGEST] executed ${summary.executedTasks}/${summary.totalTasks}` +
    ` | successes ${summary.successes.length} | failures ${summary.failures.length}`
  );

  const after = await Job.countDocuments({});
  const afterEmbedded = await Job.countDocuments({ isActive: true, embedding: { $ne: null } });

  console.log(`[TEST INGEST] Jobs after: ${after} (+${after - before} new)`);
  console.log(`[TEST INGEST] Embedded after: ${afterEmbedded} (+${afterEmbedded - beforeEmbedded} newly embedded)`);
  console.log(`[TEST INGEST] Done.`);
  process.exit();
}

run().catch(e => { console.error("[TEST INGEST] Failed:", e.message); process.exit(1); });
