const express = require("express");
const { requireAdminAuth } = require("../middleware/adminAuth");
const { runIngestionQueue } = require("../services/ingestionOrchestratorService");
const { runAlertDigest } = require("../services/jobAlertService");
const { clearSourceBackoff } = require("../services/sourceHealthService");
const { registerUniversalSource } = require("../services/universalCareerSourceService");
const { getIngestionSourceCatalog } = require("../config/ingestionSourceCatalog");
const { getLastQuotaStatus } = require("../services/jsearchService");

const router = express.Router();

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

function selectIngestionTasks(keys = []) {
  const catalog = getIngestionSourceCatalog();
  if (!Array.isArray(keys) || keys.length === 0) {
    const disabled = getDisabledSources();
    return catalog.filter(task => !disabled.has(task.key));
  }
  const wanted = new Set(keys.map(v => String(v || "").toLowerCase().trim()));
  return catalog.filter(task => wanted.has(task.key));
}

// All routes below require a valid admin token
router.use(requireAdminAuth);

router.post("/ingestion/run", async (req, res) => {
  try {
    const sources   = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const forceRun  = req.body?.forceRun === true;
    const retries   = Number.isFinite(Number(req.body?.retries))
      ? Math.max(Number(req.body.retries), 0) : INGESTION_QUEUE_RETRIES;
    const concurrency = Number.isFinite(Number(req.body?.concurrency))
      ? Math.max(Number(req.body.concurrency), 1) : INGESTION_QUEUE_CONCURRENCY;

    const selectedTasks = selectIngestionTasks(sources);
    if (selectedTasks.length === 0) {
      return res.status(400).json({ error: "No valid sources provided" });
    }

    const summary = await runIngestionQueue(selectedTasks, {
      trigger: "admin-run",
      retries,
      concurrency,
      forceRunSources: forceRun ? selectedTasks.map(t => t.key) : []
    });
    return res.json({ ok: true, summary });
  } catch (error) {
    console.error("[ADMIN INGESTION RUN] Failed:", error.message);
    return res.status(500).json({ error: "Failed to run ingestion" });
  }
});

router.post("/alerts/test", async (req, res) => {
  try {
    const result = await runAlertDigest("daily", { lookbackDays: 30, force: true });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/ingestion/backoff/reset", async (req, res) => {
  try {
    const sourceKey = String(req.body?.sourceKey || "").toLowerCase().trim();
    if (!sourceKey) {
      return res.status(400).json({ error: "sourceKey is required" });
    }
    const updated = await clearSourceBackoff(sourceKey);
    if (!updated) {
      return res.status(404).json({ error: "Source health row not found" });
    }
    return res.json({
      ok: true,
      sourceKey:            updated.sourceKey,
      backoffUntil:         updated.backoffUntil,
      consecutiveFailures:  updated.consecutiveFailures
    });
  } catch (error) {
    console.error("[ADMIN INGESTION BACKOFF RESET] Failed:", error.message);
    return res.status(500).json({ error: "Failed to reset source backoff" });
  }
});

router.post("/universal/register", async (req, res) => {
  try {
    const companyName = String(req.body?.companyName || "").trim();
    const careersUrl  = String(req.body?.careersUrl  || "").trim();
    const location    = String(req.body?.location    || "").trim() || null;

    if (!companyName || !careersUrl) {
      return res.status(400).json({ error: "companyName and careersUrl are required" });
    }
    const { company, source } = await registerUniversalSource({ companyName, careersUrl, location });
    return res.json({
      ok: true,
      company: { id: company._id, name: company.name },
      source:  { id: source._id, boardUrl: source.boardUrl, status: source.status }
    });
  } catch (err) {
    console.error("[ADMIN UNIVERSAL REGISTER] Failed:", err.message);
    return res.status(500).json({ error: "Failed to register universal source" });
  }
});

// GET /api/admin/quota-status
// Returns the last-seen RapidAPI quota headers captured from JSearch responses.
// No API call is made — reflects state from the most recent ingestion run.
router.get("/quota-status", (req, res) => {
  const quota = getLastQuotaStatus();
  if (!quota) {
    return res.json({
      ok: true,
      message: "No JSearch requests made yet this session — run ingestion first"
    });
  }
  return res.json({ ok: true, jsearch: quota });
});

module.exports = router;
