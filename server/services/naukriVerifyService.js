const axios = require("axios");
const Job = require("../models/Job");

// Verifies Naukri jobs against Naukri's own job-detail API. Unlike a normal
// dead-link check (which fails on Naukri because the public job page needs
// login), this hits the API endpoint, which leaks the real expired status:
//   - a DEAD/expired job → 303 redirect with body { metaSearch: { isExpiredJob: "1" } }
//   - a LIVE job         → 406 "recaptcha required" (the detail is protected, but
//                          the job clearly still exists)
// So we can reliably tell live from dead without logging in.

const REQUEST_TIMEOUT_MS = 12000;
const CONCURRENCY = Number(process.env.NAUKRI_VERIFY_CONCURRENCY || 8);
const MIN_AGE_DAYS = Number(process.env.NAUKRI_VERIFY_MIN_AGE_DAYS || 3); // skip very fresh jobs

function naukriHeaders() {
  return {
    appid: "109",
    systemid: "Naukri",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json",
    "Accept-Language": "en-IN,en;q=0.9",
    Referer: "https://www.naukri.com/",
    Origin: "https://www.naukri.com"
  };
}

// Pull the numeric jobId from a Naukri apply link (trailing digits before ? or end).
function extractNaukriJobId(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/-(\d{6,})(?:\?|$)/);
  return m ? m[1] : null;
}

// Returns true = live, false = dead. On any uncertainty, returns true so we
// never mark a job dead by mistake (false deletions are worse than missing one).
async function isNaukriJobLive(jobId) {
  if (!jobId) return true;
  try {
    const res = await axios.get(`https://www.naukri.com/jobapi/v4/job/${jobId}`, {
      headers: naukriHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      maxRedirects: 0
    });
    const expired = res.data?.metaSearch?.isExpiredJob;
    if (expired === "1" || expired === 1) return false; // explicit expired flag
    return true; // 406 recaptcha (live & protected) or anything else → assume live
  } catch {
    return true; // network error → assume live
  }
}

async function runConcurrent(tasks, concurrency) {
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { await tasks[idx](); } catch { /* ignore per-task */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}

async function runNaukriVerification(options = {}) {
  const logger = options.logger || console;
  const dryRun = options.dryRun || false;
  // minAgeDays overrides the default age gate. The cron uses 3 (skip fresh jobs
  // just confirmed live by ingestion). A manual run can pass 0 to check EVERY
  // active Naukri job regardless of age.
  const minAgeDays = options.minAgeDays != null ? options.minAgeDays : MIN_AGE_DAYS;

  // Base filter: active Naukri jobs with an apply link.
  const query = {
    isActive: true,
    source: "naukri",
    applyLink: { $exists: true, $ne: null }
  };
  if (minAgeDays > 0) {
    const cutoff = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000);
    query.$or = [
      { lastSeenAt: { $lt: cutoff } },
      { lastSeenAt: { $exists: false }, firstSeenAt: { $lt: cutoff } }
    ];
  }

  const jobs = await Job.find(query).select("_id applyLink title").lean();

  logger.log(`[NAUKRI VERIFY] Checking ${jobs.length} active Naukri jobs (${minAgeDays > 0 ? `older than ${minAgeDays}d` : "ALL ages"})${dryRun ? " [DRY RUN]" : ""}`);
  if (jobs.length === 0) return { checked: 0, markedInactive: 0 };

  let checked = 0;
  let markedInactive = 0;
  const CHUNK = 200;

  for (let start = 0; start < jobs.length; start += CHUNK) {
    const slice = jobs.slice(start, start + CHUNK);
    const deadIds = [];

    const tasks = slice.map((job) => async () => {
      const jobId = extractNaukriJobId(job.applyLink);
      const live = await isNaukriJobLive(jobId);
      checked++;
      if (!live) deadIds.push(job._id);
    });

    await runConcurrent(tasks, CONCURRENCY);

    if (deadIds.length && !dryRun) {
      await Job.updateMany({ _id: { $in: deadIds } }, { $set: { isActive: false } });
    }
    markedInactive += deadIds.length;
    logger.log(`[NAUKRI VERIFY] ${Math.min(start + CHUNK, jobs.length)}/${jobs.length} checked | dead so far: ${markedInactive}`);
  }

  logger.log(`[NAUKRI VERIFY] Done | checked: ${checked} | marked inactive (expired): ${markedInactive}`);
  return { checked, markedInactive };
}

module.exports = { runNaukriVerification, isNaukriJobLive, extractNaukriJobId };
