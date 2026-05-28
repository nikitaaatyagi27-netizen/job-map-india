const express = require("express");
const Job = require("../models/Job");
const {
  getOrCreateSession,
  getSession,
  saveJob,
  unsaveJob,
  trackApply
} = require("../services/sessionService");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    const session = await getOrCreateSession(sessionId);
    res.json({
      sessionId:     session.sessionId,
      savedJobs:     session.savedJobs,
      appliedJobs:   session.appliedJobs,
      lastSearch:    session.lastSearch,
      searchHistory: session.searchHistory
    });
  } catch (e) {
    console.error("Session error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:sessionId", async (req, res) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({
      sessionId:     session.sessionId,
      savedJobs:     session.savedJobs,
      appliedJobs:   session.appliedJobs,
      lastSearch:    session.lastSearch,
      searchHistory: session.searchHistory
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:sessionId/save-job", async (req, res) => {
  try {
    const { title, company, applyLink } = req.body;
    if (!applyLink || !title || !company) {
      return res.status(400).json({ error: "title, company, and applyLink are required" });
    }
    const session = await saveJob(req.params.sessionId, req.body);
    res.json({ ok: true, savedCount: session.savedJobs.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:sessionId/save-job", async (req, res) => {
  try {
    const { applyLink } = req.body;
    if (!applyLink) return res.status(400).json({ error: "applyLink required" });
    const session = await unsaveJob(req.params.sessionId, applyLink);
    res.json({ ok: true, savedCount: session.savedJobs.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:sessionId/apply-job", async (req, res) => {
  try {
    await trackApply(req.params.sessionId, req.body);
    if (req.body.jobId) {
      Job.findByIdAndUpdate(req.body.jobId, { $inc: { applyClickCount: 1 } }).catch(() => {});
    } else if (req.body.applyLink) {
      Job.findOneAndUpdate(
        { applyLink: req.body.applyLink },
        { $inc: { applyClickCount: 1 } }
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
