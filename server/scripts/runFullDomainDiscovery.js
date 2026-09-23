// Runs discoverCompanyWebsiteCareers() repeatedly until the backlog of
// companies missing careersUrl/careersProvider is exhausted, or until a
// safety cap is hit. This is a LONG-RUNNING job — with ~21,885 companies
// needing discovery and Tavily's own 1.2s inter-request pacing, expect this
// to take several hours. Run it with nohup/pm2/screen so it survives you
// closing the terminal, e.g.:
//
//   nohup node server/scripts/runFullDomainDiscovery.js > domain-discovery.log 2>&1 &
//
// Progress is logged every batch, so you can `tail -f domain-discovery.log`
// to watch it work.
//
// CHECKPOINT / RESUME:
// The actual discovery progress is already safe by construction — every
// company gets saved to MongoDB immediately after being processed (whether
// it found a signal or not, thanks to the starvation-bug fix), so if this
// process dies mid-run, nothing already-processed is lost, and simply
// re-running the script picks up the real remaining backlog from the DB.
// What WOULD be lost on a restart is the cumulative running totals (how many
// scanned/updated/providers found across the whole effort) and iteration
// count, since those previously only lived in memory. This version persists
// those to a small JSON checkpoint file next to this script, loaded on
// startup and updated after every iteration, so a `tail -f` after a crash
// and restart shows continuous totals instead of resetting to zero.

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Company = require("../models/Company");
const { discoverCompanyWebsiteCareers } = require("../services/companyWebsiteDiscoveryService");

const BATCH_SIZE = Number(process.env.DOMAIN_DISCOVERY_BATCH_SIZE || 30);
const MAX_ITERATIONS = Number(process.env.DOMAIN_DISCOVERY_MAX_ITERATIONS || 500);
const ITERATION_PAUSE_MS = Number(process.env.DOMAIN_DISCOVERY_ITERATION_PAUSE_MS || 2000);

const CHECKPOINT_PATH = path.join(__dirname, ".domain-discovery-checkpoint.json");

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
      totalUpdated: parsed.totalUpdated || 0,
      totalProvidersFound: parsed.totalProvidersFound || 0,
      totalWebsitesFound: parsed.totalWebsitesFound || 0,
      totalElapsedMsBeforeThisProcess: parsed.totalElapsedMsSoFar || 0,
      firstStartedAt: parsed.firstStartedAt || null,
      completed: parsed.completed || false
    };
  } catch {
    return null; // no checkpoint yet, or unreadable — start fresh
  }
}

function saveCheckpoint(state) {
  try {
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`[FULL DOMAIN DISCOVERY] Failed to write checkpoint file: ${err.message}`);
  }
}

async function remainingBacklog() {
  return Company.countDocuments({
    $or: [{ careersUrl: null }, { careersProvider: null }]
  });
}

async function run() {
  await connectDB();

  const processStartedAt = Date.now();
  const startBacklog = await remainingBacklog();

  const existing = loadCheckpoint();
  const resuming = existing && !existing.completed;

  let iterationsRun = resuming ? existing.iterationsRun : 0;
  let totalScanned = resuming ? existing.totalScanned : 0;
  let totalUpdated = resuming ? existing.totalUpdated : 0;
  let totalProvidersFound = resuming ? existing.totalProvidersFound : 0;
  let totalWebsitesFound = resuming ? existing.totalWebsitesFound : 0;
  let totalElapsedMsBeforeThisProcess = resuming ? existing.totalElapsedMsBeforeThisProcess : 0;
  const firstStartedAt = resuming && existing.firstStartedAt ? existing.firstStartedAt : new Date().toISOString();

  console.log(`\n[FULL DOMAIN DISCOVERY] ${resuming ? "Resuming from checkpoint" : "Starting fresh"}.`);
  if (resuming) {
    console.log(`  Checkpoint found: ${existing.iterationsRun} iterations already run across previous session(s).`);
    console.log(`  Cumulative so far: scanned=${totalScanned} updated=${totalUpdated} providersFound=${totalProvidersFound} careersUrlsFound=${totalWebsitesFound}`);
    console.log(`  First started at: ${firstStartedAt}`);
  }
  console.log(`  Backlog right now: ${startBacklog} companies missing careersUrl/careersProvider`);
  console.log(`  Batch size: ${BATCH_SIZE} (service internally scans up to ~${BATCH_SIZE * 8} per call)`);
  console.log(`  Max iterations this process: ${MAX_ITERATIONS}`);
  console.log(`  This will take a while — Tavily paces itself at ~1.2s/request.\n`);

  const writeCheckpoint = (completed = false) => {
    saveCheckpoint({
      iterationsRun,
      totalScanned,
      totalUpdated,
      totalProvidersFound,
      totalWebsitesFound,
      totalElapsedMsSoFar: totalElapsedMsBeforeThisProcess + (Date.now() - processStartedAt),
      firstStartedAt,
      lastUpdatedAt: new Date().toISOString(),
      completed
    });
  };

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const before = await remainingBacklog();
    if (before === 0) {
      console.log(`\n[FULL DOMAIN DISCOVERY] Backlog is empty — nothing left to discover. Stopping.`);
      writeCheckpoint(true);
      break;
    }

    const iterStart = Date.now();
    const result = await discoverCompanyWebsiteCareers(BATCH_SIZE);
    const iterElapsedSec = ((Date.now() - iterStart) / 1000).toFixed(1);

    iterationsRun++;
    totalScanned += result.scannedCompanies;
    totalUpdated += result.updatedCompanies;
    totalProvidersFound += result.providersDiscovered;
    totalWebsitesFound += result.careersUrlsDiscovered;

    const after = await remainingBacklog();
    const totalElapsedMin = ((totalElapsedMsBeforeThisProcess + (Date.now() - processStartedAt)) / 60000).toFixed(1);

    console.log(
      `[ITERATION ${iterationsRun}] scanned=${result.scannedCompanies} ` +
      `updated=${result.updatedCompanies} ` +
      `providersFound=${result.providersDiscovered} ` +
      `careersUrlsFound=${result.careersUrlsDiscovered} ` +
      `| backlog: ${before} → ${after} ` +
      `| took ${iterElapsedSec}s | total elapsed (all sessions) ${totalElapsedMin}min`
    );

    if (after >= before) {
      console.warn(
        `[FULL DOMAIN DISCOVERY] ⚠️  Backlog did not shrink this iteration ` +
        `(${before} → ${after}). If this repeats for several iterations, discovery ` +
        `may be failing silently (network/API issue) rather than genuinely finding ` +
        `nothing — check TAVILY_API_KEY / network connectivity if this stacks up.`
      );
    }

    // Checkpoint after every iteration, not just at the end — this is what
    // actually protects you against a kill/crash mid-run.
    writeCheckpoint(false);

    await sleep(ITERATION_PAUSE_MS);
  }

  const finalBacklog = await remainingBacklog();
  const finalElapsedMin = ((totalElapsedMsBeforeThisProcess + (Date.now() - processStartedAt)) / 60000).toFixed(1);
  const completed = finalBacklog === 0;

  writeCheckpoint(completed);

  console.log(`\n=== SUMMARY (cumulative across all sessions) ===`);
  console.log(`Backlog remaining:               ${finalBacklog}`);
  console.log(`Total iterations run:             ${iterationsRun}`);
  console.log(`Total companies scanned:          ${totalScanned}`);
  console.log(`Total companies updated:          ${totalUpdated}`);
  console.log(`Total careers providers found:    ${totalProvidersFound}`);
  console.log(`Total careers URLs found:         ${totalWebsitesFound}`);
  console.log(`Total time (all sessions):        ${finalElapsedMin} minutes`);
  console.log(`First started:                    ${firstStartedAt}`);

  if (!completed) {
    console.log(`\n${finalBacklog} companies still remain. Just re-run this script — it will`);
    console.log(`automatically resume from the checkpoint file:`);
    console.log(`  ${CHECKPOINT_PATH}`);
  } else {
    console.log(`\n✅ Backlog fully cleared. Checkpoint marked complete.`);
    console.log(`Delete ${path.basename(CHECKPOINT_PATH)} manually if you want the next run to start fresh`);
    console.log(`(e.g. after adding a large batch of new companies later).`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[FULL DOMAIN DISCOVERY] Fatal:", error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});