require("dotenv").config();

const connectDB = require("../config/db");
const { runNaukriVerification } = require("../services/naukriVerifyService");

// Pass --dry-run to check without marking anything inactive.
// Pass --all to verify EVERY active Naukri job regardless of age (manual cleanup);
// without it the default 3-day age gate applies (same as the cron).
const dryRun = process.argv.includes("--dry-run");
const all = process.argv.includes("--all");

(async () => {
  await connectDB();
  if (all) console.log("[ALL] Ignoring age gate — verifying every active Naukri job.");
  await runNaukriVerification({ dryRun, minAgeDays: all ? 0 : undefined });
  process.exit();
})().catch((e) => {
  console.error("[NAUKRI VERIFY] Failed:", e.message);
  process.exit(1);
});
