const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require("dotenv").config();

const cron = require("node-cron");
const app = require("./app");
const connectDB = require("./config/db");
const { getIngestionSourceCatalog } = require("./config/ingestionSourceCatalog");
const { runCompanyGrowthCycle }  = require("./services/companyGrowthOrchestratorService");
const { backfillCompanyCoords }  = require("./services/companyCoordsService");
const { markStaleJobs }          = require("./services/staleJobService");
const { runStorageCleanup }      = require("./services/storageCleanupService");
const { backfillJobFreshness }   = require("./services/jobFreshnessService");
const { runIngestionQueue }      = require("./services/ingestionOrchestratorService");
const { computeHiringVelocity } = require("./services/hiringVelocityService");
const { backfillAtsProviders }  = require("./services/atsProviderBackfillService");
const { discoverAndIngestWorkdayBoards } = require("./services/workdayDiscoveryService");
const { runYoutubeHiringDiscovery }      = require("./services/youtubeHiringService");
const { runJobVerification }             = require("./services/jobVerificationService");
const { runNaukriVerification }          = require("./services/naukriVerifyService");
const { cleanupDeadAtsBoards }           = require("./services/atsCleanupService");
const { runDedup }                       = require("./services/dedupeService");

// ─── Ingestion helpers ─────────────────────────────────────────────────────────

const INGESTION_QUEUE_CONCURRENCY = Math.max(
  Number(process.env.INGESTION_QUEUE_CONCURRENCY || 2), 1
);
const INGESTION_QUEUE_RETRIES = Math.max(
  Number(process.env.INGESTION_QUEUE_RETRIES || 1), 0
);

function getDisabledSources() {
  return new Set(
    String(process.env.DISABLED_INGESTION_SOURCES || "")
      .split(",")
      .map(v => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getAutomatedIngestionTaskCatalog() {
  const disabled = getDisabledSources();
  return getIngestionSourceCatalog().filter(task => !disabled.has(task.key));
}

function selectIngestionTasks(keys = []) {
  const catalog = getIngestionSourceCatalog();
  if (!Array.isArray(keys) || keys.length === 0) return catalog;
  const wanted = new Set(keys.map(v => String(v || "").toLowerCase().trim()));
  return catalog.filter(task => wanted.has(task.key));
}

async function runScheduledIngestion() {
  console.log("[CRON] Running ingestion");
  await markStaleJobs();

  const queueSummary = await runIngestionQueue(
    getAutomatedIngestionTaskCatalog(),
    { trigger: "cron", concurrency: INGESTION_QUEUE_CONCURRENCY, retries: INGESTION_QUEUE_RETRIES }
  );

  console.log(
    `[INGESTION ORCHESTRATOR] cron | executed ${queueSummary.executedTasks}/${queueSummary.totalTasks}` +
    ` | successes ${queueSummary.successes.length} | failures ${queueSummary.failures.length}` +
    ` | skipped ${queueSummary.skippedTasks}`
  );

  await computeHiringVelocity().catch(e => console.error("[HIRING VELOCITY] Failed:", e.message));

  try {
    const { runIngestionMonitor } = require("./services/ingestionMonitorService");
    await runIngestionMonitor(queueSummary);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.log("[MONITOR] Ingestion monitor service not found, skipping alert check.");
    } else {
      console.error("[MONITOR] Failed:", err.message);
    }
  }
}

async function runManualIngestion() {
  const requested = String(process.env.BOOTSTRAP_SOURCES || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);

  const tasks = requested.length > 0
    ? selectIngestionTasks(requested)
    : getAutomatedIngestionTaskCatalog();

  const queueSummary = await runIngestionQueue(
    tasks,
    { trigger: "manual-bootstrap", concurrency: INGESTION_QUEUE_CONCURRENCY, retries: INGESTION_QUEUE_RETRIES }
  );

  console.log(
    `[INGESTION ORCHESTRATOR] manual | executed ${queueSummary.executedTasks}/${queueSummary.totalTasks}` +
    ` | successes ${queueSummary.successes.length} | failures ${queueSummary.failures.length}` +
    ` | skipped ${queueSummary.skippedTasks}`
  );
}

// Runs in the background — server is already accepting requests before this starts.
async function runBootstrapTasks() {
  try {
    await markStaleJobs();
    console.log("[BOOTSTRAP] Staleness cleanup done.");
  } catch (error) {
    console.error("[BOOTSTRAP] Staleness cleanup failed:", error.message);
  }

  if (process.env.SKIP_BOOTSTRAP) {
    console.log("[BOOTSTRAP] Full ingestion skipped (SKIP_BOOTSTRAP=true)");
    return;
  }

  try {
    await backfillJobFreshness();
    await backfillCompanyCoords();
    await runManualIngestion();
    await runCompanyGrowthCycle("bootstrap");
    await computeHiringVelocity();
    await backfillAtsProviders();
    console.log("[BOOTSTRAP] Initial data preparation finished.");
  } catch (error) {
    console.error("[BOOTSTRAP] Initial data preparation failed:", error.message);
  }
}

// ─── Scheduled tasks ───────────────────────────────────────────────────────────
// Each background job is a named task so it can run either on a cron inside this
// server (single-machine deploy) or once from the command line:
//   node index.js --task ingest
// which is how the GitHub Actions workflow runs them when the web server is
// deployed with WEB_ONLY=true (e.g. Render's 512 MB free tier).

const TASKS = {
  // Full ingestion (every 12h)
  async ingest() {
    await backfillCompanyCoords();
    await runScheduledIngestion();
    await runCompanyGrowthCycle("cron");
    await runDedup();
  },

  // Staleness sweep + storage cleanup (daily 1am UTC).
  // markStaleJobs marks dead jobs inactive; runStorageCleanup then deletes
  // inactive jobs past the grace period (and caps total job count) so the DB
  // can't fill up the free 512 MB tier.
  async daily() {
    await markStaleJobs();
    await runStorageCleanup();
  },

  // Job-link verification (nightly 3am UTC).
  //  - runJobVerification checks aggregator jobs (Adzuna/JSearch/etc.) for dead links.
  //  - runNaukriVerification checks Naukri jobs via Naukri's job-detail API, which
  //    reveals the real expired status (the public job page needs login).
  async verify() {
    try {
      const result = await runJobVerification();
      console.log(`[CRON] Job verification done | checked: ${result.checked} | marked inactive: ${result.markedInactive}`);
    } catch (error) {
      console.error("[CRON] Job verification failed:", error.message);
    }
    try {
      const naukri = await runNaukriVerification();
      console.log(`[CRON] Naukri verification done | checked: ${naukri.checked} | marked inactive: ${naukri.markedInactive}`);
    } catch (error) {
      console.error("[CRON] Naukri verification failed:", error.message);
    }
  },

  // Weekly YouTube hiring video discovery (Sunday 3am UTC)
  async youtube() {
    const result = await runYoutubeHiringDiscovery();
    console.log(
      `[CRON] YouTube discovery done | channels ${result.channelsScanned}` +
      ` | videos ${result.videosScanned} | new sources ${result.newSources}`
    );
  },

  // Weekly Workday tenant discovery (Sunday 2am UTC)
  async workday() {
    const result = await discoverAndIngestWorkdayBoards();
    console.log(
      `[CRON] Workday discovery done | found ${result.candidatesFound} candidates` +
      ` | ingested ${result.ingestedBoards} boards | new companies ${result.newCompanies}`
    );
  },

  // Weekly dead/duplicate ATS board cleanup (Sunday 4am UTC)
  async atsCleanup() {
    const result = await cleanupDeadAtsBoards();
    console.log(`[CRON] ATS cleanup done | removed ${result.removed} dead/duplicate boards`);
  },

  // Initial data preparation (normally runs on every server start)
  bootstrap: runBootstrapTasks,
};

const SCHEDULE = [
  ["0 */12 * * *", "ingest"],
  ["0 1 * * *",    "daily"],
  ["0 3 * * *",    "verify"],
  ["0 3 * * 0",    "youtube"],
  ["0 2 * * 0",    "workday"],
  ["0 4 * * 0",    "atsCleanup"],
];

async function runTask(name) {
  try {
    await TASKS[name]();
  } catch (error) {
    console.error(`[CRON] ${name} failed:`, error.message);
    throw error;
  }
}

async function bootstrap() {
  await connectDB();

  const PORT = process.env.PORT || 5000;

  // Listen first — server accepts requests immediately while bootstrap runs in background
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  if (process.env.WEB_ONLY === "true") {
    console.log("[WEB_ONLY] Cron jobs and bootstrap ingestion disabled; run them with `node index.js --task <name>`.");
    return;
  }

  for (const [expression, name] of SCHEDULE) {
    cron.schedule(expression, () => runTask(name).catch(() => {}));
  }

  // Bootstrap tasks run after listen — requests are accepted immediately
  runBootstrapTasks().catch(error => {
    console.error("[BOOTSTRAP] Unexpected failure:", error.message);
  });
}

// One-off mode: `node index.js --task <name>` runs a single task and exits.
async function runTaskOnce(name) {
  if (!TASKS[name]) {
    console.error(`Unknown task "${name}". Available: ${Object.keys(TASKS).join(", ")}`);
    process.exit(1);
  }
  await connectDB();
  const t0 = Date.now();
  console.log(`[TASK] ${name} started`);
  await runTask(name);
  console.log(`[TASK] ${name} finished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const taskFlag = process.argv.indexOf("--task");

if (taskFlag !== -1) {
  runTaskOnce(process.argv[taskFlag + 1])
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  bootstrap().catch(error => {
    console.error("Server bootstrap failed:", error.message);
    process.exit(1);
  });
}
