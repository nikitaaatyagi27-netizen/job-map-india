const crypto = require("crypto");
const nodemailer = require("nodemailer");
const JobAlert = require("../models/JobAlert");
const Job = require("../models/Job");

// ─── Mailer setup ─────────────────────────────────────────────────────────────
// Configure via .env:
//   EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM
// Works with any SMTP provider (Gmail, Resend, SendGrid, Zoho, etc.)
// If env vars are missing, emails are logged to console (dev mode).

function createTransport() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
    return null;   // dev mode — log instead of send
  }
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

const FROM = process.env.EMAIL_FROM || "Job Map India <noreply@jobmapindia.com>";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

// ─── Subscribe ────────────────────────────────────────────────────────────────

async function subscribe({ email, domain, primarySkills, secondarySkills, roles, cities = [], frequency = "daily" }) {
  const unsubToken = crypto.randomBytes(20).toString("hex");

  const alert = await JobAlert.findOneAndUpdate(
    { email, domain },
    {
      $set: { primarySkills, secondarySkills, roles, cities, frequency, isActive: true },
      $setOnInsert: { unsubToken, createdAt: new Date() }
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  return alert;
}

async function unsubscribe(unsubToken) {
  return JobAlert.findOneAndUpdate(
    { unsubToken },
    { $set: { isActive: false } },
    { returnDocument: "after" }
  );
}

// ─── Match new jobs against an alert profile ──────────────────────────────────

async function findNewJobsForAlert(alert, lookbackDays = 1) {
  const since = alert.lastAlertAt || new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const skillTerms = [...(alert.primarySkills || []), ...(alert.secondarySkills || [])]
    .map(s => s.toLowerCase());

  // Split role strings into searchable words ("Software Engineer" → ["software", "engineer"])
  const roleTokens = (alert.roles || [])
    .flatMap(r => r.toLowerCase().split(/\s+/));

  const allTerms = [...new Set([...skillTerms, ...roleTokens])].filter(t => t.length > 2);

  if (allTerms.length === 0) return [];

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const titleRegex = new RegExp(allTerms.map(escape).join("|"), "i");

  const escapedCities = (alert.cities || []).map(escape);
  const cityFilter = escapedCities.length > 0
    ? { location: new RegExp(escapedCities.join("|"), "i") }
    : {};

  const jobs = await Job.find({
    isActive: true,
    firstSeenAt: { $gte: since },
    title: titleRegex,
    ...cityFilter
  })
    .populate("company", "name logo domain")
    .limit(20)
    .lean();

  return jobs;
}

// ─── Build email HTML ─────────────────────────────────────────────────────────

function buildEmailHtml(alert, newJobs) {
  const skillList = [...(alert.primarySkills || []), ...(alert.secondarySkills || [])].slice(0, 6).join(", ");
  const unsubUrl  = `${APP_URL}/api/alerts/unsubscribe/${alert.unsubToken}`;

  const jobRows = newJobs.slice(0, 10).map(job => {
    const company = typeof job.company === "object" ? job.company?.name : "Unknown";
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #1e293b">
          <strong style="color:#f1f5f9">${job.title || "—"}</strong><br/>
          <span style="color:#60a5fa;font-size:13px">${company}</span>
          <span style="color:#475569;font-size:12px;margin-left:8px">${job.location || ""}</span><br/>
          <a href="${job.applyLink || "#"}" style="color:#22c55e;font-size:12px;text-decoration:none;margin-top:4px;display:inline-block">Apply →</a>
        </td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#94a3b8">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

        <!-- Header -->
        <tr><td style="background:#1e293b;border-radius:12px 12px 0 0;padding:24px 28px">
          <h1 style="margin:0;color:white;font-size:20px;font-weight:700">Job Map India</h1>
          <p style="margin:6px 0 0;color:#60a5fa;font-size:14px">
            ${newJobs.length} new ${alert.domain} role${newJobs.length !== 1 ? "s" : ""} matching your profile
          </p>
        </td></tr>

        <!-- Skills pill -->
        <tr><td style="background:#162032;padding:14px 28px;border-left:1px solid #1e293b;border-right:1px solid #1e293b">
          <span style="font-size:12px;color:#64748b">Matched on: </span>
          <span style="font-size:12px;color:#94a3b8">${skillList}</span>
        </td></tr>

        <!-- Jobs -->
        <tr><td style="background:#0f172a;padding:16px 28px;border:1px solid #1e293b;border-top:none;border-radius:0 0 12px 12px">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${jobRows}
          </table>
          <div style="text-align:center;margin-top:20px">
            <a href="${APP_URL}" style="background:#2563eb;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">
              View all on map →
            </a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 28px;text-align:center">
          <p style="margin:0;font-size:11px;color:#334155">
            You're receiving this because you subscribed on Job Map India.<br/>
            <a href="${unsubUrl}" style="color:#475569">Unsubscribe</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Send alert for one subscriber ───────────────────────────────────────────

async function sendAlertEmail(alert, lookbackDays = 1) {
  const newJobs = await findNewJobsForAlert(alert, lookbackDays);
  if (newJobs.length === 0) return { sent: false, reason: "no_new_jobs" };

  const html    = buildEmailHtml(alert, newJobs);
  const subject = `🔥 ${newJobs.length} new ${alert.domain} jobs on Job Map India`;
  const transport = createTransport();

  if (!transport) {
    console.log(`[JOB ALERTS DEV] Would send to ${alert.email}: ${subject}`);
    console.log(`[JOB ALERTS DEV] ${newJobs.length} jobs:`, newJobs.map(j => j.title).join(", "));
  } else {
    await transport.sendMail({
      from: FROM,
      to: alert.email,
      subject,
      html
    });
    console.log(`[JOB ALERTS] Sent to ${alert.email}: ${newJobs.length} new jobs`);
  }

  await JobAlert.findByIdAndUpdate(alert._id, { $set: { lastAlertAt: new Date() } });
  return { sent: true, jobCount: newJobs.length };
}

// ─── Run all pending alerts (called by cron) ─────────────────────────────────

async function runAlertDigest(frequency = "daily", { lookbackDays, force } = {}) {
  const now     = new Date();
  const cutoff  = frequency === "weekly"
    ? new Date(now - 7 * 24 * 60 * 60 * 1000)
    : new Date(now - 20 * 60 * 60 * 1000);

  const query = force
    ? { isActive: true, frequency }
    : {
        isActive: true,
        frequency,
        $or: [{ lastAlertAt: null }, { lastAlertAt: { $lte: cutoff } }]
      };

  const alerts = await JobAlert.find(query);
  console.log(`[JOB ALERTS] Processing ${alerts.length} ${frequency} alerts`);

  const days = lookbackDays || 1;
  let sent = 0;
  for (const alert of alerts) {
    try {
      const result = await sendAlertEmail(alert, days);
      if (result.sent) sent++;
    } catch (err) {
      console.error(`[JOB ALERTS] Failed for ${alert.email}:`, err.message);
    }
  }

  console.log(`[JOB ALERTS] Sent ${sent}/${alerts.length} emails`);
  return { total: alerts.length, sent };
}

module.exports = { subscribe, unsubscribe, runAlertDigest, sendAlertEmail };
