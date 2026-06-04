require("dotenv").config();

const cron = require("node-cron");
const app = require("./app");
const connectDB = require("./config/db");
const { getIngestionSourceCatalog } = require("./config/ingestionSourceCatalog");
const { runCompanyGrowthCycle }  = require("./services/companyGrowthOrchestratorService");
const { backfillCompanyCoords }  = require("./services/companyCoordsService");
const { markStaleJobs }          = require("./services/staleJobService");
const { backfillJobFreshness }   = require("./services/jobFreshnessService");
const { runIngestionQueue }      = require("./services/ingestionOrchestratorService");
const { runIngestionMonitor }    = require("./services/ingestionMonitorService");
const { runDedup }               = require("./services/dedupeService");
const { computeHiringVelocity } = require("./services/hiringVelocityService");
const { backfillAtsProviders }  = require("./services/atsProviderBackfillService");
const { discoverAndIngestWorkdayBoards } = require("./services/workdayDiscoveryService");
const { runYoutubeHiringDiscovery }      = require("./services/youtubeHiringService");
const { runJobVerification }             = require("./services/jobVerificationService");

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
  await backfillAtsProviders().catch(e => console.error("[ATS BACKFILL] Failed:", e.message));
  await runIngestionMonitor(queueSummary).catch(e => console.error("[MONITOR] Failed:", e.message));
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

async function bootstrap() {
  await connectDB();

  const PORT = process.env.PORT || 5000;

  // Listen first — server accepts requests immediately while bootstrap runs in background
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Cron: full ingestion every 12 hours
  cron.schedule("0 */12 * * *", async () => {
    try {
      await backfillCompanyCoords();
      await runScheduledIngestion();
      await runCompanyGrowthCycle("cron");
      await runDedup();
    } catch (error) {
      console.error("[CRON] Ingestion failed:", error.message);
    }
  });

  // Cron: daily staleness sweep at 1am UTC
  cron.schedule("0 1 * * *", async () => {
    try {
      await markStaleJobs();
    } catch (error) {
      console.error("[CRON] Staleness sweep failed:", error.message);
    }
  });

  // Cron: nightly job verification at 3am UTC — checks aggregator jobs for dead links
  cron.schedule("0 3 * * *", async () => {
    try {
      const result = await runJobVerification();
      console.log(`[CRON] Job verification done | checked: ${result.checked} | marked inactive: ${result.markedInactive}`);
    } catch (error) {
      console.error("[CRON] Job verification failed:", error.message);
    }
  });

  // Cron: weekly YouTube hiring video discovery — Sunday 3am UTC (8:30am IST)
  cron.schedule("0 3 * * 0", async () => {
    try {
      const result = await runYoutubeHiringDiscovery();
      console.log(
        `[CRON] YouTube discovery done | channels ${result.channelsScanned}` +
        ` | videos ${result.videosScanned} | new sources ${result.newSources}`
      );
    } catch (error) {
      console.error("[CRON] YouTube discovery failed:", error.message);
    }
  });

  // Cron: weekly Workday tenant discovery — Sunday 2am UTC
  // Mines GitHub + Serper for new myworkdayjobs.com boards and ingests them.
  cron.schedule("0 2 * * 0", async () => {
    try {
      const result = await discoverAndIngestWorkdayBoards();
      console.log(
        `[CRON] Workday discovery done | found ${result.candidatesFound} candidates` +
        ` | ingested ${result.ingestedBoards} boards | new companies ${result.newCompanies}`
      );
    } catch (error) {
      console.error("[CRON] Workday discovery failed:", error.message);
    }
  });

  // Bootstrap tasks run after listen — requests are accepted immediately
  runBootstrapTasks().catch(error => {
    console.error("[BOOTSTRAP] Unexpected failure:", error.message);
  });
}

bootstrap().catch(error => {
  console.error("Server bootstrap failed:", error.message);
  process.exit(1);
});
