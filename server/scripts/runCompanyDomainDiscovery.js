// server/scripts/runCompanyDomainDiscovery.js
//
// Runs discoverMissingCompanyDomains() repeatedly until every company
// missing a `domain` has been resolved (or a safety cap is hit).
//
// This is DIFFERENT from runFullDomainDiscovery.js:
//   - runFullDomainDiscovery.js  -> fills in careersUrl/careersProvider
//                                   (probes each company's site for a
//                                   careers page). Never touches `domain`.
//   - runCompanyDomainDiscovery.js (this file) -> fills in ONLY `domain`
//                                   (and `website` if empty), via Tavily,
//                                   with no HTML probing. Much lighter per
//                                   company, meant specifically to unblock
//                                   extractJobsForZeroJobCompanies.js, which
//                                   needs a domain to guess an ATS slug from.
//
// With ~17,814 companies missing a domain and Tavily's own ~1.2s pacing,
// expect this to take a few hours. Run it with nohup/pm2/screen:
//
//   nohup node scripts/runCompanyDomainDiscovery.js > domain-fill.log 2>&1 &
//   tail -f domain-fill.log
//
// CHECKPOINT / RESUME:
// Every company is saved to MongoDB immediately after being resolved, so
// the real backlog always lives safely in the DB — re-running this script
// after a crash/kill just picks up wherever the backlog actually is. This
// checkpoint file only preserves the CUMULATIVE counters (scanned/found/etc.)
// across process restarts so your running totals don't reset to zero.

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Company = require("../models/Company");
const { discoverMissingCompanyDomains } = require("../services/companyDomainDiscoveryService");

const BATCH_SIZE = Number(process.env.DOMAIN_DISCOVERY_BATCH_SIZE || 30);
const MAX_ITERATIONS = Number(process.env.DOMAIN_DISCOVERY_MAX_ITERATIONS || 1000);
const ITERATION_PAUSE_MS = Number(process.env.DOMAIN_DISCOVERY_ITERATION_PAUSE_MS || 2000);

const CHECKPOINT_PATH = path.join(__dirname, ".company-domain-discovery-checkpoint.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCheckpoint() {
  try {
    const raw = fs.readFileSync(CHECKPOINT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      iterationsRun: parsed.iterationsRun || 0,
      totalScanned: parsed.totalScanned || 0,
      totalDomainsFound: parsed.totalDomainsFound || 0,
      totalNotFound: parsed.totalNotFound || 0,
      totalElapsedMsBeforeThisProcess: parsed.totalElapsedMsSoFar || 0,
      firstStartedAt: parsed.firstStartedAt || null,
      completed: parsed.completed || false,
    };
  } catch {
    return null; // no checkpoint yet, or unreadable — start fresh
  }
}

function saveCheckpoint(state) {
  try {
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`[DOMAIN FILL] Failed to write checkpoint file: ${err.message}`);
  }
}

async function remainingBacklog() {
  return Company.countDocuments({
    $or: [{ domain: null }, { domain: "" }, { domain: { $exists: false } }],
  });
}

async function run() {
  await connectDB();

  // Clearout needs no key at all, and Serper is now the primary paid
  // provider — so neither key is a hard requirement to start. But warn
  // clearly if both paid providers are unconfigured, since then you're
  // relying entirely on Clearout's free-but-narrow exact-match lookup.
  if (!process.env.SERPER_API_KEY && !process.env.TAVILY_API_KEY) {
    console.warn(
      "[DOMAIN FILL] Neither SERPER_API_KEY nor TAVILY_API_KEY is set — only Clearout's free " +
        "exact-match lookup will run, which misses most small/regional companies. Add at least " +
        "SERPER_API_KEY in .env for meaningfully better coverage."
    );
  } else if (!process.env.SERPER_API_KEY) {
    console.warn("[DOMAIN FILL] SERPER_API_KEY is not set — skipping straight to Tavily after Clearout misses.");
  }

  const processStartedAt = Date.now();
  const startBacklog = await remainingBacklog();

  const existing = loadCheckpoint();
  const resuming = existing && !existing.completed;

  let iterationsRun = resuming ? existing.iterationsRun : 0;
  let totalScanned = resuming ? existing.totalScanned : 0;
  let totalDomainsFound = resuming ? existing.totalDomainsFound : 0;
  let totalNotFound = resuming ? existing.totalNotFound : 0;
  let totalElapsedMsBeforeThisProcess = resuming ? existing.totalElapsedMsBeforeThisProcess : 0;
  const firstStartedAt = resuming && existing.firstStartedAt ? existing.firstStartedAt : new Date().toISOString();

  console.log(`\n[DOMAIN FILL] ${resuming ? "Resuming from checkpoint" : "Starting fresh"}.`);
  if (resuming) {
    console.log(`  Checkpoint found: ${existing.iterationsRun} iterations already run across previous session(s).`);
    console.log(`  Cumulative so far: scanned=${totalScanned} domainsFound=${totalDomainsFound} notFound=${totalNotFound}`);
    console.log(`  First started at: ${firstStartedAt}`);
  }
  console.log(`  Backlog right now: ${startBacklog} companies missing domain`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Max iterations this process: ${MAX_ITERATIONS}`);
  console.log(`  Tavily paces itself at ~1.2s/request — this will take a while.\n`);

  const writeCheckpoint = (completed = false) => {
    saveCheckpoint({
      iterationsRun,
      totalScanned,
      totalDomainsFound,
      totalNotFound,
      totalElapsedMsSoFar: totalElapsedMsBeforeThisProcess + (Date.now() - processStartedAt),
      firstStartedAt,
      lastUpdatedAt: new Date().toISOString(),
      completed,
    });
  };

  let stoppedForRateLimit = false;

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const before = await remainingBacklog();
    if (before === 0) {
      console.log(`\n[DOMAIN FILL] Backlog is empty — nothing left to resolve. Stopping.`);
      writeCheckpoint(true);
      break;
    }

    const iterStart = Date.now();
    const result = await discoverMissingCompanyDomains(BATCH_SIZE);
    const iterElapsedSec = ((Date.now() - iterStart) / 1000).toFixed(1);

    iterationsRun++;
    totalScanned += result.scannedCompanies;
    totalDomainsFound += result.domainsFound;
    totalNotFound += result.notFoundCount;

    const after = await remainingBacklog();
    const totalElapsedMin = ((totalElapsedMsBeforeThisProcess + (Date.now() - processStartedAt)) / 60000).toFixed(1);

    console.log(
      `[ITERATION ${iterationsRun}] scanned=${result.scannedCompanies} ` +
        `domainsFound=${result.domainsFound} ` +
        `notFound=${result.notFoundCount} ` +
        `| backlog: ${before} → ${after} ` +
        `| took ${iterElapsedSec}s | total elapsed (all sessions) ${totalElapsedMin}min`
    );

    writeCheckpoint(false);

    if (result.rateLimited) {
      console.warn(`[DOMAIN FILL] Stopping run — Tavily rate/quota limit was hit mid-batch. Re-run later to resume.`);
      stoppedForRateLimit = true;
      break;
    }

    await sleep(ITERATION_PAUSE_MS);
  }

  const finalBacklog = await remainingBacklog();
  const finalElapsedMin = ((totalElapsedMsBeforeThisProcess + (Date.now() - processStartedAt)) / 60000).toFixed(1);
  const completed = finalBacklog === 0;

  writeCheckpoint(completed);

  console.log(`\n=== SUMMARY (cumulative across all sessions) ===`);
  console.log(`Backlog remaining:        ${finalBacklog}`);
  console.log(`Total iterations run:     ${iterationsRun}`);
  console.log(`Total companies scanned:  ${totalScanned}`);
  console.log(`Total domains found:      ${totalDomainsFound}`);
  console.log(`Total not found:          ${totalNotFound}`);
  console.log(`Total time (all sessions):${finalElapsedMin} minutes`);
  console.log(`First started:            ${firstStartedAt}`);

  if (stoppedForRateLimit) {
    console.log(`\nStopped early due to Tavily rate/quota limit. Just re-run this script later —`);
    console.log(`it will resume from the checkpoint file: ${CHECKPOINT_PATH}`);
  } else if (!completed) {
    console.log(`\n${finalBacklog} companies still remain. Just re-run this script — it will`);
    console.log(`automatically resume from the checkpoint file: ${CHECKPOINT_PATH}`);
  } else {
    console.log(`\n✅ Backlog fully cleared. Checkpoint marked complete.`);
    console.log(`Delete ${path.basename(CHECKPOINT_PATH)} manually if you want the next run to start fresh.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[DOMAIN FILL] Fatal:", error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});