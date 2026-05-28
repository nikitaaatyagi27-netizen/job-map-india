// Run ONLY the 4 JSON-API ATS fetchers (Greenhouse, Lever, Ashby,
// SmartRecruiters) — skips Naukri (slow Puppeteer), Workday (slow), JSearch
// (paid quota), Adzuna, Arbeitnow, Remotive, universal scraper.
//
// Use this after `npm run register:curated-ats` to immediately pull jobs
// from the newly-registered boards without running a full bootstrap.
//
// Run: node scripts/fetchAtsOnly.js
//
// Takes ~2-5 minutes for ~40 boards (all 4 providers in parallel).

require("dotenv").config();
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const { getIngestionSourceCatalog } = require("../config/ingestionSourceCatalog");
const { runIngestionQueue } = require("../services/ingestionOrchestratorService");

const TARGET_SOURCES = ["greenhouse", "lever", "ashby", "smartrecruiters"];

async function run() {
  await connectDB();

  const catalog = getIngestionSourceCatalog();
  const tasks = catalog.filter((task) => TARGET_SOURCES.includes(task.key));

  if (tasks.length === 0) {
    console.error("No ATS tasks found in catalog");
    process.exit(1);
  }

  console.log(`[FETCH-ATS] Running ${tasks.length} ATS sources: ${tasks.map((t) => t.key).join(", ")}\n`);
  const startedAt = Date.now();

  const summary = await runIngestionQueue(tasks, {
    trigger: "manual-ats-only",
    concurrency: 4, // run all 4 in parallel
    retries: 1,
    forceRunSources: TARGET_SOURCES // ignore backoff windows for this manual run
  });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log("\n=== SUMMARY ===");
  console.log(`Elapsed: ${elapsedSec}s`);
  console.log(`Executed: ${summary.executedTasks}/${summary.totalTasks} | skipped: ${summary.skippedTasks}`);
  console.log(`\nSuccesses (${summary.successes.length}):`);
  for (const s of summary.successes) {
    const m = s.metrics || {};
    console.log(`  ${s.key.padEnd(18)} attempts=${s.attempts}  newJobs=${m.newJobs ?? "?"}  refreshed=${m.refreshedJobs ?? "?"}  durationMs=${m.durationMs ?? "?"}`);
  }
  if (summary.failures.length > 0) {
    console.log(`\nFailures (${summary.failures.length}):`);
    for (const f of summary.failures) {
      console.log(`  ${f.key.padEnd(18)} attempts=${f.attempts}  error=${f.error}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[FETCH-ATS] Failed:", error.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
