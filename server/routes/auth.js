const express = require("express");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const IS_PROD = process.env.NODE_ENV === "production";

// Cross-domain (Vercel frontend ↔ Render backend) requires SameSite=None + Secure.
// In local dev (same-site localhost) fall back to Lax over http.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: IS_PROD ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: "Too many attempts. Please try again later." }
});

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

// POST /api/auth/register
router.post("/register", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "An account with this email already exists" });

    const user = await User.create({ email, password });
    const token = signToken(user._id);

    res.cookie("token", token, COOKIE_OPTS);
    res.status(201).json({ user: { id: user._id, email: user.email, resumeData: user.resumeData } });
  } catch (e) {
    console.error("[AUTH] Register error:", e.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /api/auth/login
router.post("/login", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken(user._id);
    res.cookie("token", token, COOKIE_OPTS);
    res.json({ user: { id: user._id, email: user.email, resumeData: user.resumeData } });
  } catch (e) {
    console.error("[AUTH] Login error:", e.message);
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("token", { ...COOKIE_OPTS, maxAge: 0 });
  res.json({ ok: true });
});

// GET /api/auth/me — returns current user (used on app load to restore session)
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user._id, email: req.user.email, resumeData: req.user.resumeData } });
});

// PATCH /api/auth/resume — save resume data to account
router.patch("/resume", requireAuth, async (req, res) => {
  try {
    const { resumeData } = req.body;
    if (!resumeData) return res.status(400).json({ error: "resumeData required" });
    await User.findByIdAndUpdate(req.user._id, { $set: { resumeData } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to save resume" });
  }
});

module.exports = router;
