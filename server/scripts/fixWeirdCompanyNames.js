require("dotenv").config();
const mongoose = require("mongoose");

const Company = require("../models/Company");
const Job = require("../models/Job");
const CareerSource = require("../models/CareerSource");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const {
  fromHost,
  cleanCompanyNameOrUnknown,
  isGenericCompanyName
} = require("../utils/cleanCompanyName");

function looksWeirdCompanyName(name) {
  const value = String(name || "").toLowerCase();
  if (!value) return false;

  if (isGenericCompanyName(value)) {
    return true;
  }

  // Names that are clearly UI strings rather than companies.
  const badPhrases = [
    "search for jobs",
    "sign in",
    "english",
    "career site",
    "careers home"
  ];

  if (badPhrases.some((p) => value.includes(p))) return true;

  // Heuristic: lots of generic tokens, very few meaningful characters.
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    const generic = new Set(["search", "for", "jobs", "job", "careers", "career", "english", "sign", "in", "home"]);
    const genericCount = tokens.filter((t) => generic.has(t)).length;
    if (genericCount >= Math.ceil(tokens.length * 0.6)) return true;
  }

  return false;
}

function inferCanonicalNameFromWorkdayUrls({ careersUrl, sources }) {
  const urls = [];
  if (careersUrl) urls.push(careersUrl);
  for (const s of sources || []) {
    if (s.boardUrl) urls.push(s.boardUrl);
    if (s.careersUrl) urls.push(s.careersUrl);
  }

  for (const url of urls) {
    try {
      const u = new URL(url);
      const hostname = u.hostname.toLowerCase();
      if (hostname.endsWith(".myworkdayjobs.com")) {
        const from = fromHost(hostname);
        if (from) return from;
        const tenant = hostname.split(".")[0];
        return cleanCompanyNameOrUnknown(tenant, hostname);
      }
    } catch {
      // ignore
    }
  }

  return null;
}

async function mergeCompanyInto({ fromCompany, toCompany }) {
  if (String(fromCompany._id) === String(toCompany._id)) return;

  // Move jobs.
  await Job.updateMany({ company: fromCompany._id }, { $set: { company: toCompany._id } });

  // Move career sources. If a duplicate exists on the destination, delete the source copy.
  const fromSources = await CareerSource.find({ company: fromCompany._id });
  for (const src of fromSources) {
    const existing = await CareerSource.findOne({
      company: toCompany._id,
      provider: src.provider,
      boardUrl: src.boardUrl
    });

    if (existing) {
      await CareerSource.deleteOne({ _id: src._id });
      continue;
    }

    src.company = toCompany._id;
    src.companyName = toCompany.name;
    src.updatedAt = new Date();
    await src.save();
  }

  // Delete the old company.
  await Company.deleteOne({ _id: fromCompany._id });
}

async function fixWeirdCompanyNames({ dryRun = false } = {}) {
  const weirdCompanies = await Company.find({}).select("name careersUrl domain website createdAt updatedAt");
  let scanned = 0;
  let renamed = 0;
  let merged = 0;
  let skipped = 0;

  for (const company of weirdCompanies) {
    scanned++;
    if (!looksWeirdCompanyName(company.name)) continue;

    const sources = await CareerSource.find({ company: company._id }).select("provider boardUrl careersUrl");
    const canonicalTitle = inferCanonicalNameFromWorkdayUrls({
      careersUrl: company.careersUrl,
      sources
    });

    if (!canonicalTitle) {
      skipped++;
      continue;
    }

    const canonical = normalizeCompanyName(canonicalTitle);
    if (!canonical || canonical === company.name) {
      skipped++;
      continue;
    }

    const existing = await Company.findOne({ name: canonical }).select("_id name");

    if (dryRun) {
      console.log(`[DRY RUN] ${company.name} -> ${canonical}${existing ? " (merge)" : " (rename)"}`);
      continue;
    }

    if (!existing) {
      company.name = canonical;
      company.updatedAt = new Date();
      await company.save();

      // Keep CareerSource.companyName aligned.
      await CareerSource.updateMany(
        { company: company._id },
        { $set: { companyName: canonical, updatedAt: new Date() } }
      );

      renamed++;
      console.log(`[RENAMED] ${company.name}`);
      continue;
    }

    await mergeCompanyInto({ fromCompany: company, toCompany: existing });
    merged++;
    console.log(`[MERGED] ${company.name} -> ${existing.name}`);
  }

  return { scanned, renamed, merged, skipped };
}

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is required");
  }

  const dryRun = process.argv.includes("--dry-run");

  await mongoose.connect(mongoUri);
  console.log(`[FIX WEIRD NAMES] Connected. dryRun=${dryRun}`);

  const result = await fixWeirdCompanyNames({ dryRun });
  console.log("[FIX WEIRD NAMES] Done:", result);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
