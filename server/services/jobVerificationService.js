const axios = require("axios");
const Job = require("../models/Job");

// Sources we can reliably verify via HTTP.
// Skipped: naukri (login required), greenhouse/lever/ashby/workday/smartrecruiters (ATS — cleaned by ingestion)
const VERIFIABLE_SOURCES = ["adzuna", "jsearch", "arbeitnow", "remotive"];

// How old a job must be (days) before we bother verifying it.
// Fresh jobs were just confirmed live by ingestion — no need to re-check.
const MIN_AGE_DAYS = 3;

// Known phrases that indicate a dead job page
const DEAD_JOB_PHRASES = [
  "this job is no longer available",
  "job is no longer available",
  "this listing has expired",
  "no longer accepting applications",
  "this position has been filled",
  "position is no longer available",
  "job posting has expired",
  "this job has been closed",
  "no longer accepting",
  "position has been closed",
  "vacancy has been filled",
  "job is closed"
];

const REQUEST_TIMEOUT_MS = 8000;
const CONCURRENCY = 30;
const REQUEST_DELAY_MS = 100; // small delay between batches to be polite

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function isJobLive(applyLink) {
  if (!applyLink) return false;

  try {
    const res = await axios.get(applyLink, {
      maxRedirects: 10,
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*"
      }
    });

    if (res.status === 404 || res.status === 410) return false;
    if (res.status === 401 || res.status === 403) return true; // auth wall — assume live
    if (res.status >= 500) return true; // server error — assume live, don't penalise

    const body = typeof res.data === "string" ? res.data.toLowerCase() : "";
    if (DEAD_JOB_PHRASES.some(phrase => body.includes(phrase))) return false;

    return true;
  } catch {
    // Network error, timeout, DNS failure — assume live to avoid false positives
    return true;
  }
}

async function runConcurrent(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = await tasks[idx]();
      } catch {
        results[idx] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

async function runJobVerification(options = {}) {
  const logger = options.logger || console;
  const dryRun = options.dryRun || false;
  // minAgeDays overrides the default age gate. The cron uses 3 (skip fresh jobs
  // just confirmed live by ingestion). A manual run can pass 0 to check EVERY
  // active aggregator job regardless of age.
  const minAgeDays = options.minAgeDays != null ? options.minAgeDays : MIN_AGE_DAYS;

  // Base filter: active aggregator jobs with an apply link.
  const query = {
    isActive: true,
    source: { $in: VERIFIABLE_SOURCES },
    applyLink: { $exists: true, $ne: null }
  };
  // Apply the age gate only when minAgeDays > 0.
  if (minAgeDays > 0) {
    const cutoff = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000);
    query.$or = [
      { lastSeenAt: { $lt: cutoff } },
      { lastSeenAt: { $exists: false }, firstSeenAt: { $lt: cutoff } }
    ];
  }

  const jobs = await Job.find(query).select("_id applyLink source title").lean();

  logger.log(`[JOB VERIFY] Found ${jobs.length} jobs to verify (sources: ${VERIFIABLE_SOURCES.join(", ")}${minAgeDays > 0 ? `, older than ${minAgeDays}d` : ", ALL ages"})`);

  if (jobs.length === 0) {
    logger.log("[JOB VERIFY] Nothing to verify.");
    return { checked: 0, markedInactive: 0 };
  }

  let markedInactive = 0;
  let checked = 0;

  // Process in batches of CONCURRENCY
  for (let start = 0; start < jobs.length; start += CONCURRENCY) {
    const batch = jobs.slice(start, start + CONCURRENCY);

    const tasks = batch.map(job => async () => {
      const live = await isJobLive(job.applyLink);
      checked++;
      if (!live) {
        if (!dryRun) {
          await Job.findByIdAndUpdate(job._id, { $set: { isActive: false } });
        }
        logger.log(`[JOB VERIFY] Dead — marked inactive: "${job.title}" (${job.source}) ${job.applyLink}`);
        markedInactive++;
      }
      return live;
    });

    await runConcurrent(tasks, CONCURRENCY);

    // Small delay between batches to avoid hammering servers
    if (start + CONCURRENCY < jobs.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  logger.log(`[JOB VERIFY] Done | checked: ${checked} | marked inactive: ${markedInactive}`);
  return { checked, markedInactive };
}

module.exports = { runJobVerification };
