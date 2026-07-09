require("dotenv").config();

const connectDB = require("../config/db");
const { runStorageCleanup } = require("../services/storageCleanupService");

// --now deletes ALL inactive jobs immediately (no grace period).
const now = process.argv.includes("--now");

(async () => {
  await connectDB();
  await runStorageCleanup(now ? { graceDays: 0 } : {});
  process.exit();
})().catch((e) => {
  console.error("[STORAGE CLEANUP] Failed:", e.message);
  process.exit(1);
});
