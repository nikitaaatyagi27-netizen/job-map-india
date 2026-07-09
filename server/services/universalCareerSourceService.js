const CareerSource = require("../models/CareerSource");
const Company = require("../models/Company");
const { scrapeJobsWithLLM } = require("./universalScraperService");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const getCoords = require("../utils/geocode");
const extractDomain = require("../utils/extractDomain");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { isAggregatorUrl } = require("../utils/isAggregatorUrl");
const { isQuotaError } = require("../utils/dbQuota");

// Concurrency 1 by default: each page needs an LLM extraction call, and the free
// Groq/Gemini tiers rate-limit on bursts. Serial keeps us under the per-minute
// limit. Raise UNIVERSAL_CONCURRENCY if you move to paid LLM tiers.
const UNIVERSAL_CONCURRENCY = Number(process.env.UNIVERSAL_CONCURRENCY || 1);
const MAX_FAILURES_BEFORE_DISABLE = Number(process.env.UNIVERSAL_MAX_FAILURES || 5);

// Delay between sources, on top of the natural page-load time, to stay well under
// free LLM per-minute limits. 5s ≈ ~12 LLM calls/min, comfortably under Groq's
// ~30/min and Gemini's ~15/min free caps. Raise if you still see rate-limits.
const UNIVERSAL_SOURCE_DELAY_MS = Number(process.env.UNIVERSAL_SOURCE_DELAY_MS || 5000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findOrCreateCompany(companyName, careersUrl, location) {
  const normalized = normalizeCompanyName(companyName);

  let company = await Company.findOne({ name: normalized });

  if (!company) {
    const coords = await getCoords(location || "India");

    company = await Company.create({
      name: normalized,
      logo: null,
      domain: extractDomain({ employer_name: companyName, job_apply_link: careersUrl }),
      city: location || "India",
      location: location || "India",
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      source: "universal"
    });

    console.log(`[Universal] New company: ${companyName}`);
  }

  return company;
}

// Scrape one source and persist its jobs. Returns the job count (or 0 on skip/fail).
async function processUniversalSource(source) {
  const company = source.company;

  if (!company) {
    console.warn(`[Universal] Skipping ${source.boardUrl} — company not found`);
    return 0;
  }

  // Aggregator URLs aren't single-company pages — auto-disable so we never waste
  // a browser launch on them again.
  if (isAggregatorUrl(source.boardUrl)) {
    console.warn(`[Universal] Disabling aggregator URL: ${source.boardUrl}`);
    await CareerSource.findByIdAndUpdate(source._id, {
      $set: { status: "disabled", lastError: "aggregator URL — not a company page", updatedAt: new Date() }
    });
    return 0;
  }

  try {
    const jobs = await scrapeJobsWithLLM(source.boardUrl);

    for (const job of jobs) {
      await upsertIngestedJob({
        title: job.title,
        company: company._id,
        location: job.location || "India",
        applyLink: job.applyUrl || source.boardUrl,
        description: job.description || null,
        source: "universal",
        postedDate: null,
        isRemote: (job.location || "").toLowerCase().includes("remote")
      });
    }

    await CareerSource.findByIdAndUpdate(source._id, {
      $set: {
        jobsFound: jobs.length,
        lastCheckedAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        failureCount: 0,
        status: "active",
        updatedAt: new Date()
      }
    });

    console.log(`[Universal] ${company.name}: ${jobs.length} jobs`);
    return jobs.length;
  } catch (err) {
    // DB full — stop the whole run cleanly rather than failing every source.
    if (isQuotaError(err)) {
      console.error("\n[DB FULL] ❌ MongoDB storage quota is full — stopping universal ingestion.");
      const e = new Error("DB_QUOTA_FULL");
      e.isQuotaFull = true;
      throw e;
    }

    // All LLM providers exhausted (daily token/quota limits) — no point trying
    // the remaining sources, every extraction will fail. Stop cleanly.
    if (err && err.allProvidersExhausted) {
      console.error("\n[LLM EXHAUSTED] ❌ All LLM providers are rate-limited/out of quota — stopping universal scrape. Re-run after quotas reset (daily).");
      const e = new Error("LLM_EXHAUSTED");
      e.isQuotaFull = true; // reuse the same stop-the-run mechanism
      throw e;
    }

    const failureCount = (source.failureCount || 0) + 1;
    const disable = failureCount >= MAX_FAILURES_BEFORE_DISABLE;
    console.warn(`[Universal] Failed for ${source.boardUrl}: ${err.message}${disable ? " — disabling (too many failures)" : ""}`);

    await CareerSource.findByIdAndUpdate(source._id, {
      $set: {
        lastCheckedAt: new Date(),
        lastError: err.message,
        lastFailureAt: new Date(),
        ...(disable ? { status: "disabled" } : {}),
        updatedAt: new Date()
      },
      $inc: { failureCount: 1 }
    });
    return 0;
  }
}

// Simple concurrency-limited runner. Stops all runners if a worker throws a
// DB-quota-full error (no point continuing — every write will fail).
async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  let stop = false;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length && !stop) {
      const idx = cursor++;
      try {
        results[idx] = await worker(items[idx]);
      } catch (err) {
        if (err && err.isQuotaFull) { stop = true; throw err; }
        results[idx] = 0;
      }
      // Pace between sources to stay under free LLM per-minute limits.
      if (cursor < items.length && !stop && UNIVERSAL_SOURCE_DELAY_MS > 0) {
        await sleep(UNIVERSAL_SOURCE_DELAY_MS);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function fetchUniversalJobs() {
  console.log("[Universal] Starting universal LLM scrape ingestion");

  const sources = await CareerSource.find({
    provider: "universal",
    status: "active"
  }).populate("company");

  console.log(`[Universal] ${sources.length} active sources | concurrency ${UNIVERSAL_CONCURRENCY}`);

  let counts = [];
  try {
    counts = await mapWithConcurrency(
      sources,
      UNIVERSAL_CONCURRENCY,
      (source) => processUniversalSource(source)
    );
  } catch (err) {
    if (err && err.isQuotaFull) {
      const partial = counts.reduce((s, n) => s + (n || 0), 0);
      console.log(`[Universal] Stopped — DB full. Free space, then re-run.`);
      return partial;
    }
    throw err;
  }

  const total = counts.reduce((sum, n) => sum + (n || 0), 0);
  console.log(`[Universal] Done. Total India jobs: ${total}`);
  return total;
}

async function registerUniversalSource({ companyName, careersUrl, location }) {
  if (!companyName || !careersUrl) {
    throw new Error("companyName and careersUrl are required");
  }

  const company = await findOrCreateCompany(companyName, careersUrl, location);

  const source = await CareerSource.findOneAndUpdate(
    { company: company._id, provider: "universal", boardUrl: careersUrl },
    {
      $set: {
        companyName: company.name,
        careersUrl,
        discoveryMethod: "admin-registered",
        parserType: "llm-universal",
        status: "active",
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true, returnDocument: "after" }
  );

  return { company, source };
}

module.exports = { fetchUniversalJobs, registerUniversalSource };
