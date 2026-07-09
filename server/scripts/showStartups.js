require("dotenv").config();

const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");

// The curated Indian startups we just added/fixed — check how many jobs each has.
const STARTUPS = [
  "razorpay", "postman", "sarvam", "slice", "devrev", "dream", "nanonets",
  "observe", "porter", "groww", "refyne", "navi", "atlan", "scaler",
  "cars24", "whatfix", "newton", "paytm", "phonepe", "meesho", "cred",
  "freshworks", "fi money", "druva", "inmobi"
];

(async () => {
  await connectDB();
  console.log("\n=== Indian startups → active jobs in DB ===\n");
  let withJobs = 0, totalJobs = 0;

  for (const s of STARTUPS) {
    // Exact / word-boundary match so "cred" doesn't match "cashpor microcredit",
    // "navi" doesn't match "navigation", "scaler" doesn't match "zscaler", etc.
    const exact = new RegExp("^" + s + "( |$)", "i");
    const comps = await Company.find({ name: exact }).select("_id name").lean();
    if (!comps.length) { console.log("  " + s.padEnd(14) + "→ (no exact company match)"); continue; }
    const ids = comps.map(c => c._id);
    const jobs = await Job.countDocuments({ company: { $in: ids }, isActive: true });
    const flag = jobs > 0 ? "✅" : "⚠️ ";
    console.log("  " + flag + " " + s.padEnd(14) + "→ " + jobs + " jobs  (" + comps.map(c => c.name).slice(0, 2).join(", ") + ")");
    if (jobs > 0) { withJobs++; totalJobs += jobs; }
  }

  console.log("\n  " + withJobs + " startups with jobs | " + totalJobs + " total startup jobs");
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
