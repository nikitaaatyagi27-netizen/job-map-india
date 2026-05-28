const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { parseResume } = require("../services/resumeParserService");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const resumeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many resume uploads. Please wait a minute and try again." }
});

router.post("/parse", resumeRateLimit, upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const parsed = await parseResume(req.file.buffer, req.file.mimetype);
    res.json(parsed);
  } catch (e) {
    console.error("Resume parse error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
