require("dotenv").config();

const connectDB = require("../config/db");
const { cleanupDeadAtsBoards } = require("../services/atsCleanupService");

// Cleans up ATS CareerSource registrations across greenhouse / lever / ashby /
// smartrecruiters: removes duplicates and dead (0-India) boards.
// Only deletes registrations — never already-ingested Jobs. Boards that can't be
// reached are left alone.
//
// Run:  node scripts/cleanupDeadAtsBoards.js --dry-run
//       node scripts/cleanupDeadAtsBoards.js                (apply)
//       node scripts/cleanupDeadAtsBoards.js greenhouse     (one provider)

const dryRun = process.argv.includes("--dry-run");
const providers = process.argv.slice(2).filter(a => !a.startsWith("--"));

(async () => {
  await connectDB();
  await cleanupDeadAtsBoards({ dryRun, providers: providers.length ? providers : undefined });
  if (dryRun) console.log("[DRY RUN] Re-run without --dry-run to apply.");
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
