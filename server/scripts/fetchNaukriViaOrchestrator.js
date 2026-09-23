// Revive Naukri through the REAL orchestrator path — not a bare call to
// fetchNaukriJobs(). This matters because a bare call (like fetchNaukriOnly.js
// does) never touches sourceHealthService.js: it doesn't call
// registerSourceSuccess/registerSourceFailure, so it can never clear a
// persistent SourceHealth backoff record. If the automated 12h cron has been
// silently skipping Naukri with reason:"backoff" for days, running
// fetchNaukriOnly.js will get you fresh jobs THIS ONCE, but the cron will
// keep skipping it afterward because the backoff record never got reset.
//
// This script routes the Naukri task through runIngestionQueue() with
// forceRunSources:["naukri"] — same code path the automated cron and the
// admin "force run" endpoint use — so a real success actually clears
// consecutiveFailures/backoffUntil on the SourceHealth record, and a real
// failure is recorded honestly instead of being invisible to the health system.
//
// Run: node server/scripts/fetchNaukriViaOrchestrator.js

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { getIngestionSourceCatalog } = require("../config/ingestionSourceCatalog");
const { runIngestionQueue } = require("../services/ingestionOrchestratorService");
const { getSourceHealthMap } = require("../services/sourceHealthService");

async function printHealth(label) {
  const healthMap = await getSourceHealthMap();
  const naukriHealth = healthMap.get("naukri");

  console.log(`\n[NAUKRI VIA ORCHESTRATOR] ${label}`);
  if (!naukriHealth) {
    console.log("  No SourceHealth record yet for naukri (first run, or never tracked before).");
    return;
  }
  console.log(`  score:               ${naukriHealth.score}`);
  console.log(`  successCount:        ${naukriHealth.successCount}`);
  console.log(`  failureCount:        ${naukriHealth.failureCount}`);
  console.log(`  consecutiveFailures: ${naukriHealth.consecutiveFailures}`);
  console.log(`  backoffUntil:        ${naukriHealth.backoffUntil || "(none)"}`);
  console.log(`  lastRunAt:           ${naukriHealth.lastRunAt || "(never)"}`);
  console.log(`  lastSuccessAt:       ${naukriHealth.lastSuccessAt || "(never)"}`);
  console.log(`  lastError:           ${naukriHealth.lastError || "(none)"}`);
}

async function run() {
  await connectDB();

  const catalog = getIngestionSourceCatalog();
  const task = catalog.find((t) => t.key === "naukri");

  if (!task) {
    console.error("[NAUKRI VIA ORCHESTRATOR] 'naukri' not found in ingestion source catalog — check server/config/ingestionSourceCatalog.js");
    process.exit(1);
  }

  await printHealth("BEFORE this run");

  console.log("\n[NAUKRI VIA ORCHESTRATOR] Running naukri task through runIngestionQueue (forceRunSources bypasses any existing backoff)...\n");

  const startedAt = Date.now();
  const summary = await runIngestionQueue([task], {
    trigger: "manual-naukri-revival",
    concurrency: 1,
    retries: 1,
    forceRunSources: ["naukri"]
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log("=== SUMMARY ===");
  console.log(`Elapsed: ${elapsedSec}s`);
  console.log(`Executed: ${summary.executedTasks}/${summary.totalTasks} | skipped: ${summary.skippedTasks}`);

  if (summary.successes.length > 0) {
    console.log(`\nSuccesses (${summary.successes.length}):`);
    for (const s of summary.successes) {
      const m = s.metrics || {};
      console.log(`  ${s.key}  attempts=${s.attempts}  newJobs=${m.newJobs ?? "?"}  refreshed=${m.refreshedJobs ?? "?"}  durationMs=${m.durationMs ?? "?"}`);
    }
  }

  if (summary.failures.length > 0) {
    console.log(`\nFailures (${summary.failures.length}):`);
    for (const f of summary.failures) {
      console.log(`  ${f.key}  attempts=${f.attempts}  error=${f.error}`);
    }
    console.log(`\n⚠️  Naukri failed even with backoff bypassed. This is a real, current failure`);
    console.log(`   (rate-limited, blocked, or endpoint changed) — not a stale backoff artifact.`);
    console.log(`   See Phase 5 in the revival plan: try slower pacing (NAUKRI_REQUEST_DELAY_MS)`);
    console.log(`   or a different network before retrying.`);
  }

  if (summary.skipped.length > 0) {
    console.log(`\nSkipped (${summary.skipped.length}):`);
    for (const s of summary.skipped) {
      console.log(`  ${s.key}  reason=${s.reason}  backoffUntil=${s.backoffUntil || "(n/a)"}`);
    }
    console.log(`\n⚠️  Naukri was skipped even with forceRunSources set. Check NAUKRI_ENABLED and`);
    console.log(`   DISABLED_INGESTION_SOURCES in .env — those are separate kill switches this`);
    console.log(`   script does not override.`);
  }

  await printHealth("AFTER this run");

  console.log(`\n[NAUKRI VIA ORCHESTRATOR] Done. If successCount increased and consecutiveFailures`);
  console.log(`is now 0, the automated cron will resume treating naukri normally on its next cycle.`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[NAUKRI VIA ORCHESTRATOR] Fatal:", error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});