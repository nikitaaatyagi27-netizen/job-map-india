const nodemailer = require("nodemailer");
const SourceHealth = require("../models/SourceHealth");

// Recipient for alert emails. Defaults to the same address used for sending.
// Override with ALERT_ADMIN_EMAIL in server/.env
const ADMIN_EMAIL = process.env.ALERT_ADMIN_EMAIL || process.env.EMAIL_USER;

// Thresholds
const CONSECUTIVE_FAILURE_THRESHOLD = 3;  // alert when a source fails this many times in a row
const SILENT_FAILURE_MIN_AVG        = 5;  // alert when a source returns 0 jobs but historically averages >= this many
const RUN_FAILURE_RATE_THRESHOLD    = 0.4; // alert when >= 40% of sources failed in one run

function createTransport() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) return null;
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   Number(process.env.EMAIL_PORT || 587),
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
}

// ── Collect all actionable problems from a completed run ──────────────────────

async function collectAlerts(runSummary) {
  const alerts = [];

  // 1. Run-level: too many sources failed
  const executed = runSummary.executedTasks || 0;
  const failed   = (runSummary.failures || []).length;
  if (executed > 0 && failed / executed >= RUN_FAILURE_RATE_THRESHOLD) {
    alerts.push({
      severity: "critical",
      source:   "pipeline",
      message:  `${failed}/${executed} sources failed (${Math.round(failed / executed * 100)}%) — ingestion severely degraded`
    });
  }

  // 2. Per-source hard failures from this run
  for (const f of (runSummary.failures || [])) {
    alerts.push({
      severity: "warning",
      source:   f.key,
      message:  `${f.label} failed after ${f.attempts} attempt(s): ${f.error || "unknown error"}`
    });
  }

  // 3. Silent failures — source "succeeded" but returned 0 jobs
  //    when its historical average is significantly above zero
  const successKeys = (runSummary.successes || []).map(s => s.key);
  if (successKeys.length > 0) {
    const healthRecords = await SourceHealth.find({ sourceKey: { $in: successKeys } }).lean();
    const healthByKey = new Map(healthRecords.map(h => [h.sourceKey, h]));

    for (const s of (runSummary.successes || [])) {
      const newJobs    = s.metrics?.newJobs || 0;
      const refreshed  = s.metrics?.refreshedJobs || 0;
      const health     = healthByKey.get(s.key);

      if (newJobs === 0 && refreshed === 0 && health && health.avgNewJobs >= SILENT_FAILURE_MIN_AVG) {
        alerts.push({
          severity: "warning",
          source:   s.key,
          message:  `${s.label} returned 0 jobs but historically averages ${Math.round(health.avgNewJobs)} new jobs/run — likely broken silently`
        });
      }
    }
  }

  // 4. Persistent failures — sources that have been failing across multiple runs
  //    (not just this one — catches problems that started before this run)
  const persistentlyFailing = await SourceHealth.find({
    consecutiveFailures: { $gte: CONSECUTIVE_FAILURE_THRESHOLD }
  }).lean();

  const failedKeysThisRun = new Set((runSummary.failures || []).map(f => f.key));

  for (const h of persistentlyFailing) {
    if (failedKeysThisRun.has(h.sourceKey)) continue; // already reported above

    alerts.push({
      severity: "critical",
      source:   h.sourceKey,
      message:  `${h.consecutiveFailures} consecutive failures across runs. Last error: ${h.lastError || "unknown"}`
    });
  }

  return alerts;
}

// ── Build the alert email HTML ────────────────────────────────────────────────

function buildAlertEmail(alerts, runSummary) {
  const critical = alerts.filter(a => a.severity === "critical");
  const subject  = critical.length > 0
    ? `Ingestion Alert: ${critical.length} critical issue(s) — Job Map India`
    : `Ingestion Warning: ${alerts.length} source(s) need attention — Job Map India`;

  const rows = alerts.map(a => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;font-size:12px;font-weight:700;color:${a.severity === "critical" ? "#f87171" : "#fbbf24"}">${a.severity.toUpperCase()}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;font-size:12px;color:#60a5fa;font-family:monospace">${a.source}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;font-size:12px;color:#e2e8f0">${a.message}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%">

        <tr><td style="background:#1e293b;border-radius:12px 12px 0 0;padding:24px 28px">
          <h1 style="margin:0;color:white;font-size:18px;font-weight:700">Job Map India — Ingestion Monitor</h1>
          <p style="margin:6px 0 0;color:${critical.length > 0 ? "#f87171" : "#fbbf24"};font-size:13px">
            ${alerts.length} issue(s) detected in the <strong>${runSummary.trigger}</strong> run
          </p>
        </td></tr>

        <tr><td style="background:#162032;padding:12px 28px;border-left:1px solid #1e293b;border-right:1px solid #1e293b">
          <span style="font-size:12px;color:#64748b">
            ${runSummary.successes?.length || 0} succeeded &nbsp;·&nbsp;
            ${runSummary.failures?.length  || 0} failed &nbsp;·&nbsp;
            ${runSummary.skippedTasks      || 0} skipped
          </span>
        </td></tr>

        <tr><td style="background:#0f172a;padding:16px 28px;border:1px solid #1e293b;border-top:none;border-radius:0 0 12px 12px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th style="text-align:left;padding:8px 12px;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Severity</th>
              <th style="text-align:left;padding:8px 12px;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Source</th>
              <th style="text-align:left;padding:8px 12px;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Issue</th>
            </tr>
            ${rows}
          </table>
        </td></tr>

        <tr><td style="padding:16px 28px;text-align:center">
          <p style="margin:0;font-size:11px;color:#334155">Job Map India · Automated ingestion monitor</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

// ── Public entry point — call after each ingestion run ────────────────────────

async function runIngestionMonitor(runSummary) {
  if (!ADMIN_EMAIL) {
    console.log("[MONITOR] ALERT_ADMIN_EMAIL not set — skipping alert check");
    return;
  }

  let alerts;
  try {
    alerts = await collectAlerts(runSummary);
  } catch (err) {
    console.error("[MONITOR] Health check failed:", err.message);
    return;
  }

  if (alerts.length === 0) {
    console.log("[MONITOR] All sources healthy");
    return;
  }

  // Always log to console regardless of email
  console.warn(`[MONITOR] ${alerts.length} issue(s) detected:`);
  for (const a of alerts) {
    console.warn(`  [${a.severity.toUpperCase()}] ${a.source}: ${a.message}`);
  }

  const transport = createTransport();
  if (!transport) {
    console.warn("[MONITOR] No SMTP configured — issues logged to console only");
    return;
  }

  try {
    const { subject, html } = buildAlertEmail(alerts, runSummary);
    await transport.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to:   ADMIN_EMAIL,
      subject,
      html
    });
    console.log(`[MONITOR] Alert email sent to ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error("[MONITOR] Failed to send alert email:", err.message);
  }
}

module.exports = { runIngestionMonitor };
