// Manually triggers ingestion for one or more sources right now, instead of
// waiting for the 12-hour cron (server/index.js) or hitting the admin HTTP
// endpoint (server/routes/admin.js, which needs INGESTION_ADMIN_TOKEN + a
// running deployed server).
//
// Reuses the real orchestrator (ingestionOrchestratorService) so you get the
// same retry logic, source-health tracking, and run logging as a normal cron
// pass — this isn't a shortcut that skips any of that.
//
// Usage:
//   node server/scripts/runIngestionNow.js                       # smartrecruiters + workday (default)
//   node server/scripts/runIngestionNow.js smartrecruiters       # just one source
//   node server/scripts/runIngestionNow.js workday successfactors taleo

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const { getIngestionSourceCatalog } = require("../config/ingestionSourceCatalog");
const { runIngestionQueue } = require("../services/ingestionOrchestratorService");

const DEFAULT_SOURCES = ["smartrecruiters", "workday"];

async function run() {
  const requested = process.argv.slice(2).map((s) => s.toLowerCase().trim());
  const sourceKeys = requested.length > 0 ? requested : DEFAULT_SOURCES;

  await connectDB();

  const catalog = getIngestionSourceCatalog();
  const tasks = catalog.filter((t) => sourceKeys.includes(t.key));

  const missing = sourceKeys.filter((k) => !tasks.some((t) => t.key === k));
  if (missing.length > 0) {
    console.error(`Unknown source key(s): ${missing.join(", ")}`);
    console.error(`Valid keys: ${catalog.map((t) => t.key).join(", ")}`);
  }

  if (tasks.length === 0) {
    console.error("No valid sources to run — exiting.");
    process.exit(1);
  }

  console.log(`Running ingestion now for: ${tasks.map((t) => t.label).join(", ")}\n`);

  // forceRunSources bypasses source-health backoff — correct for a first-ever
  // manual run, since these sources have no run history yet to back off from.
  const summary = await runIngestionQueue(tasks, {
    trigger: "manual-cli",
    concurrency: 2,
    retries: 1,
    forceRunSources: tasks.map((t) => t.key),
  });

  console.log("\n─── Summary ───────────────────────────────");
  console.log(`Executed: ${summary.executedTasks}/${summary.totalTasks}`);
  console.log(`Successes: ${summary.successes.length}`);
  console.log(`Failures: ${summary.failures.length}`);
  if (summary.failures.length > 0) {
    for (const f of summary.failures) {
      console.log(`  ❌ ${f.key || f.label}: ${f.error?.message || f.error || "unknown error"}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("[RUN INGESTION NOW] Failed:", err.message);
  process.exit(1);
});