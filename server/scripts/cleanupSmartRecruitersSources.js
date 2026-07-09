require("dotenv").config();

const connectDB = require("../config/db");
const CareerSource = require("../models/CareerSource");
const axios = require("axios");
const { isIndianLocation } = require("../utils/indiaLocation");

// Cleans up SmartRecruiters CareerSource registrations:
//   1. DEDUPE — multiple registrations pointing at the same board (same slug)
//      are collapsed to one.
//   2. DEAD BOARDS — boards that return jobs but ZERO India jobs are removed
//      (e.g. a company's US-only SmartRecruiters board; their India jobs come
//      from Naukri/other sources instead).
//
// Only deletes CareerSource registrations — never the already-ingested Jobs.
//
// Run:  node scripts/cleanupSmartRecruitersSources.js --dry-run
//       node scripts/cleanupSmartRecruitersSources.js          (apply)

const DRY_RUN = process.argv.includes("--dry-run");

function slugOf(boardUrl) {
  return (boardUrl || "").split("/").filter(Boolean).pop().toLowerCase();
}

async function boardIndiaCount(slug) {
  try {
    const r = await axios.get(
      `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`,
      { timeout: 12000, validateStatus: () => true }
    );
    if (r.status !== 200) return null; // can't tell — leave it alone
    const jobs = r.data?.content || [];
    return jobs.filter(j =>
      isIndianLocation(j.location?.city || j.location?.region || j.location?.country || "")
    ).length;
  } catch {
    return null; // network error — leave it alone
  }
}

(async () => {
  await connectDB();
  const all = await CareerSource.find({ provider: "smartrecruiters" }).select("companyName boardUrl status").lean();
  console.log(`SmartRecruiters registrations: ${all.length}${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  // ── 1. DEDUPE by board slug — keep the first, mark the rest for removal ──
  const seenSlug = new Map();
  const dupIds = [];
  for (const s of all) {
    const slug = slugOf(s.boardUrl);
    if (seenSlug.has(slug)) dupIds.push(s._id);
    else seenSlug.set(slug, s._id);
  }
  console.log(`Duplicate registrations to remove: ${dupIds.length}`);

  // ── 2. DEAD BOARDS — among the unique ones, find 0-India boards ──
  const uniqueSlugs = [...seenSlug.keys()];
  const deadIds = [];
  let checked = 0;
  for (const [slug, id] of seenSlug.entries()) {
    const india = await boardIndiaCount(slug);
    checked++;
    if (india === 0) {
      deadIds.push(id);
      console.log(`  dead (0 India): ${slug}`);
    }
    if (checked % 20 === 0) console.log(`  ...checked ${checked}/${uniqueSlugs.length}`);
  }
  console.log(`\nDead 0-India boards to remove: ${deadIds.length}`);

  const removeIds = [...new Set([...dupIds, ...deadIds.map(String)].map(String))];
  console.log(`\nTotal registrations to remove: ${removeIds.length} (of ${all.length})`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] Nothing deleted. Re-run without --dry-run to apply.");
    process.exit();
  }

  const res = await CareerSource.deleteMany({ _id: { $in: removeIds } });
  console.log(`\nDeleted ${res.deletedCount} CareerSource registrations.`);
  const remaining = await CareerSource.countDocuments({ provider: "smartrecruiters" });
  console.log(`SmartRecruiters registrations remaining: ${remaining}`);
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
