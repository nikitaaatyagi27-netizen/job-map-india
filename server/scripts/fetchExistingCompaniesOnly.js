// server/scripts/fetchExistingCompaniesOnly.js
// Pulls jobs ONLY for companies already in the DB — runs every
// "direct-career-board" source (workday, successfactors, taleo, greenhouse,
// lever, ashby, smartrecruiters, universal), which are all scoped to
// existing CareerSource records tied to existing companies.
//
// Deliberately SKIPS every "aggregator" source (naukri, jsearch, adzuna,
// arbeitnow, remotive) — those hit generic search APIs and create brand
// new Company records for whatever shows up in results. Also does NOT run
// runCompanyGrowthCycle — that's the discovery step, not ingestion.
//
// Run: node scripts/fetchExistingCompaniesOnly.js

require("dotenv").config();
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const { getIngestionSourceCatalog } = require("../config/ingestionSourceCatalog");
const { runIngestionQueue } = require("../services/ingestionOrchestratorService");

async function run() {
  await connectDB();

  const catalog = getIngestionSourceCatalog();
  const tasks = catalog.filter((task) => task.category === "direct-career-board");

  console.log(`[EXISTING-ONLY] Running ${tasks.length} company-scoped sources: ${tasks.map(t => t.key).join(", ")}`);
  console.log(`[EXISTING-ONLY] Skipping aggregators (they create new companies): naukri, jsearch, adzuna, arbeitnow, remotive\n`);

  const startedAt = Date.now();

  const summary = await runIngestionQueue(tasks, {
    trigger: "manual-existing-companies-only",
    concurrency: 3,
    retries: 1,
    forceRunSources: tasks.map(t => t.key) // ignore backoff windows for this manual run
  });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log("\n=== SUMMARY ===");
  console.log(`Elapsed: ${elapsedSec}s`);
  console.log(`Executed: ${summary.executedTasks}/${summary.totalTasks} | skipped: ${summary.skippedTasks}`);

  console.log(`\nSuccesses (${summary.successes.length}):`);
  for (const s of summary.successes) {
    const m = s.metrics || {};
    console.log(`  ${s.key.padEnd(18)} newJobs=${m.newJobs ?? "?"}  refreshed=${m.refreshedJobs ?? "?"}  durationMs=${m.durationMs ?? "?"}`);
  }

  if (summary.failures.length > 0) {
    console.log(`\nFailures (${summary.failures.length}):`);
    for (const f of summary.failures) {
      console.log(`  ${f.key.padEnd(18)} error=${f.error}`);
    }
  }

  console.log("\nNote: 'universal' only scrapes companies already registered as a universal");
  console.log("CareerSource. If you haven't run bulkRegisterUniversalSources.js yet, do that");
  console.log("first, or this run's universal count will be low/zero.");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[EXISTING-ONLY] Failed:", error.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});