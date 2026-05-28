const express = require("express");
const { getSourceHealthForApi } = require("../services/sourceHealthService");
const { getRecentIngestionRuns } = require("../services/ingestionRunLogService");

const router = express.Router();

router.get("/health", async (_req, res) => {
  try {
    const healthRows = await getSourceHealthForApi(50);
    res.json({ updatedAt: new Date().toISOString(), sources: healthRows });
  } catch (error) {
    console.error("[INGESTION HEALTH API] Failed:", error.message);
    res.status(500).json({ error: "Failed to load ingestion health" });
  }
});

router.get("/runs", async (_req, res) => {
  try {
    const runs = await getRecentIngestionRuns(20);
    res.json({ updatedAt: new Date().toISOString(), runs });
  } catch (error) {
    console.error("[INGESTION RUNS API] Failed:", error.message);
    res.status(500).json({ error: "Failed to load ingestion runs" });
  }
});

module.exports = router;
