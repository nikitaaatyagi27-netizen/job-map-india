// Strictly targets companies where `domain` is missing — queried directly,
// NOT via the careersUrl/careersProvider condition that
// companyWebsiteDiscoveryService.js uses. That matters because a company can
// already have careersProvider/careersUrl set (e.g. discovered via
// atsSitemapDiscoveryService.js's GitHub-mined ATS boards) while still having
// domain: null — that company would be silently skipped by the other
// script's batch query, since its $or condition is already satisfied.
// This script closes that gap.
//
// Resolution order per company, cheapest first:
//   1. Already has `website`?        → extract hostname, done. No network call.
//   2. Has `careersUrl` on the company's OWN domain (not an ATS vendor host
//      like boards.greenhouse.io)?   → extract hostname, done. No network call.
//   3. Neither?                      → Tavily search by company name (the
//                                       only step that costs an API call).
//
// Run: node server/scripts/fillMissingDomainsOnly.js
// Background: nohup node server/scripts/fillMissingDomainsOnly.js > fill-domains.log 2>&1 &

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Company = require("../models/Company");
const { searchOfficialWebsite } = require("../utils/tavilySearchResolver");

const BATCH_SIZE = Number(process.env.DOMAIN_FILL_BATCH_SIZE || 50);
const PAUSE_BETWEEN_COMPANIES_MS = Number(process.env.DOMAIN_FILL_PAUSE_MS || 1300); // only applies when Tavily is actually called
const CHECKPOINT_PATH = path.join(__dirname, ".fill-missing-domains-checkpoint.json");

// Known ATS vendor hostnames — never extract a company's `domain` from one of
// these, since it'd save the ATS platform's domain, not the company's own.
const ATS_VENDOR_HOSTS = [
  "jobs.lever.co",
  "boards.greenhouse.io",
  "jobs.ashbyhq.com",
  "jobs.smartrecruiters.com",
  "careers.smartrecruiters.com",
  "linkedin.com",
  "indeed.com",
  "naukri.com",
  "glassdoor.com",
  "foundit.in",
  "timesjobs.com",
  "monster.com"
];

function isAtsVendorHost(hostname) {
  return ATS_VENDOR_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
}

function extractHostname(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return hostname || null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadCheckpoint() {
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveCheckpoint(state) {
  try {
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`[FILL DOMAINS] Failed to write checkpoint: ${err.message}`);
  }
}

function noDomainFilter() {
  return { $or: [{ domain: { $exists: false } }, { domain: null }, { domain: "" }] };
}

async function remainingBacklog() {
  return Company.countDocuments(noDomainFilter());
}

async function processCompany(company, stats) {
  // 1. Cheap path — already has a website, just extract hostname.
  if (company.website) {
    const hostname = extractHostname(company.website);
    if (hostname && !isAtsVendorHost(hostname)) {
      company.domain = hostname;
      company.updatedAt = new Date();
      await company.save();
      console.log(`[FILL DOMAINS] ✔ (from website, no API call) "${company.name}": ${hostname}`);
      stats.fromWebsite++;
      return true;
    }
  }

  // 2. Cheap path — has a careersUrl that's on the company's own domain
  //    (not an ATS vendor host), so it's usable as a domain source too.
  if (company.careersUrl) {
    const hostname = extractHostname(company.careersUrl);
    if (hostname && !isAtsVendorHost(hostname)) {
      company.domain = hostname;
      company.updatedAt = new Date();
      await company.save();
      console.log(`[FILL DOMAINS] ✔ (from careersUrl, no API call) "${company.name}": ${hostname}`);
      stats.fromCareersUrl++;
      return true;
    }
  }

  // 3. Expensive path — nothing to derive from locally, search by name.
  stats.tavilyCalls++;
  const officialWebsite = await searchOfficialWebsite({ name: company.name, domain: null }, []);
  await sleep(PAUSE_BETWEEN_COMPANIES_MS); // respect Tavily's own pacing expectations

  if (officialWebsite?.officialDomain) {
    company.domain = officialWebsite.officialDomain;
    if (!company.website) company.website = `https://${officialWebsite.officialDomain}`;
    company.updatedAt = new Date();
    await company.save();
    console.log(`[FILL DOMAINS] ✔ (from Tavily search) "${company.name}": ${officialWebsite.officialDomain}`);
    stats.fromTavily++;
    return true;
  }

  // Nothing found anywhere — still stamp the attempt so this company doesn't
  // block the oldest-first backlog from advancing on the next run.
  company.updatedAt = new Date();
  await company.save().catch(() => {});
  console.log(`[FILL DOMAINS] ✘ No domain found for "${company.name}"`);
  return false;
}

async function run() {
  await connectDB();

  const startedAt = Date.now();
  const startBacklog = await remainingBacklog();

  const existing = loadCheckpoint();
  const resuming = existing && !existing.completed;

  const stats = {
    scanned: resuming ? existing.scanned || 0 : 0,
    found: resuming ? existing.found || 0 : 0,
    fromWebsite: resuming ? existing.fromWebsite || 0 : 0,
    fromCareersUrl: resuming ? existing.fromCareersUrl || 0 : 0,
    fromTavily: resuming ? existing.fromTavily || 0 : 0,
    tavilyCalls: resuming ? existing.tavilyCalls || 0 : 0,
    notFound: resuming ? existing.notFound || 0 : 0
  };
  const firstStartedAt = resuming && existing.firstStartedAt ? existing.firstStartedAt : new Date().toISOString();

  console.log(`\n[FILL DOMAINS] ${resuming ? "Resuming from checkpoint" : "Starting fresh"}.`);
  console.log(`  Backlog (domain missing, queried directly): ${startBacklog}`);
  if (resuming) {
    console.log(`  Already done across previous sessions: scanned=${stats.scanned} found=${stats.found} (website=${stats.fromWebsite} careersUrl=${stats.fromCareersUrl} tavily=${stats.fromTavily})`);
  }
  console.log(`  Batch size per pass: ${BATCH_SIZE}\n`);

  while (true) {
    const companies = await Company.find(noDomainFilter())
      .sort({ updatedAt: 1, createdAt: 1 })
      .limit(BATCH_SIZE);

    if (companies.length === 0) {
      console.log(`\n[FILL DOMAINS] Backlog is empty — done.`);
      break;
    }

    for (const company of companies) {
      stats.scanned++;
      const found = await processCompany(company, stats);
      if (found) stats.found++; else stats.notFound++;
    }

    const remaining = await remainingBacklog();
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(
      `[FILL DOMAINS] Batch done — scanned=${stats.scanned} found=${stats.found} ` +
      `(website=${stats.fromWebsite} careersUrl=${stats.fromCareersUrl} tavily=${stats.fromTavily}) ` +
      `notFound=${stats.notFound} | backlog remaining: ${remaining} | elapsed ${elapsedMin}min`
    );

    saveCheckpoint({ ...stats, firstStartedAt, lastUpdatedAt: new Date().toISOString(), completed: false });
  }

  saveCheckpoint({ ...stats, firstStartedAt, lastUpdatedAt: new Date().toISOString(), completed: true });

  const finalBacklog = await remainingBacklog();
  const totalElapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Backlog: ${startBacklog} → ${finalBacklog}`);
  console.log(`Scanned:              ${stats.scanned}`);
  console.log(`Domains found:        ${stats.found}`);
  console.log(`  ...from website (free):     ${stats.fromWebsite}`);
  console.log(`  ...from careersUrl (free):  ${stats.fromCareersUrl}`);
  console.log(`  ...from Tavily search:      ${stats.fromTavily}`);
  console.log(`Tavily API calls made: ${stats.tavilyCalls}`);
  console.log(`Not found:            ${stats.notFound}`);
  console.log(`This run took:         ${totalElapsedMin} minutes`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[FILL DOMAINS] Fatal:", error.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});