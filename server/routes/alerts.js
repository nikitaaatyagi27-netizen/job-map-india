const express = require("express");
const {
  subscribe: subscribeAlert,
  unsubscribe: unsubscribeAlert
} = require("../services/jobAlertService");

const router = express.Router();

router.post("/subscribe", async (req, res) => {
  try {
    const { email, domain, primarySkills, secondarySkills, roles, cities, frequency } = req.body;
    if (!email || !domain || !primarySkills?.length) {
      return res.status(400).json({ error: "email, domain, and primarySkills required" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    await subscribeAlert({
      email,
      domain,
      primarySkills,
      secondarySkills: secondarySkills || [],
      roles: roles || [],
      cities: cities || [],
      frequency: frequency || "daily"
    });
    res.json({ ok: true, message: `Job alerts set up for ${email}` });
  } catch (e) {
    console.error("[ALERT SUBSCRIBE] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/unsubscribe/:token", async (req, res) => {
  try {
    const result = await unsubscribeAlert(req.params.token);
    if (!result) {
      return res.status(404).send("<h2>Link not found or already unsubscribed.</h2>");
    }
    res.send(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f172a;color:white">` +
      `<h2>Unsubscribed</h2><p style="color:#94a3b8">You won't receive any more job alerts.</p></body></html>`
    );
  } catch (e) {
    res.status(500).send("<h2>Error unsubscribing. Please try again.</h2>");
  }
});

module.exports = router;
