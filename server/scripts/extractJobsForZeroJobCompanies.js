// server/scripts/extractJobsForZeroJobCompanies.js
//
// Reads zero_job_companies_with_domain.csv (output of diagnoseZeroJobCompanies.js)
// and re-attempts job extraction for each company by guessing an ATS slug from
// its domain and probing Greenhouse / Lever / Ashby / SmartRecruiters directly.
//
// Run from the `server` folder:
//   node scripts/extractJobsForZeroJobCompanies.js
//
// Optional flags:
//   --limit=200      only process the first 200 not-yet-processed companies
//                     (useful for a test run before letting it loose on all
//                     ~18k rows)
//   --restart        ignore the existing report and start over from row 0
//                     (by default the script RESUMES: any _id already present
//                     in extraction_attempt_report.csv is skipped, so you can
//                     safely stop with Ctrl+C and re-run later without
//                     re-probing companies you already checked)
//   --verbose        print a [TRY] line for every slug/fetcher combination
//                     attempted, showing whether each one found a board or
//                     not. Useful for confirming that requests are actually
//                     reaching the ATS APIs and getting real 404s (a genuine
//                     "not on this platform" miss) rather than something else
//                     going wrong silently.
//
// Workday is deliberately NOT probed here — Workday board URLs are keyed by a
// tenant subdomain that can't be reliably guessed from a company's domain.
// server/services/workdayDiscoveryService.js already handles Workday discovery
// properly; run that separately for the Workday backlog.
//
// This reuses the repo's actual persistence + dedup logic instead of writing
// jobs directly with Job.updateOne():
//  - Job.company (ObjectId ref), not companyId
//  - Job.applyLink, not url
//  - upsertIngestedJob() (server/utils/jobPersistence.js) computes
//    canonicalApplyLink / normalizedTitle / normalizedLocation via the same
//    pre('validate') identity logic every other ingestion service uses, so
//    dedup and future updates ("job still live") behave the same way as the
//    rest of the pipeline. Job.updateOne() would skip that hook entirely and
//    create duplicate rows on every re-run.
//  - Only India-located postings are saved, matching every other *Service.js
//    file in server/services (a domain-guessed board often lists global roles).
//  - A successful match is also written to CareerSource, so the normal
//    ingestion orchestrator picks this company up directly next time instead
//    of re-guessing the slug.
//
// RATE LIMITING: a 429 from an ATS API means "we hit the quota", not "this
// company has no board here". The fetchers throw a tagged RATE_LIMITED error
// on 429 instead of returning null, so processCompany() can tell the two
// apart and the main loop can skip writing a report row for it — leaving the
// company eligible to be retried on the next run instead of being
// permanently (and wrongly) marked as "no match found".
//
// LOGGING: every job that gets added or refreshed is printed to the console
// as it happens, tagged with the company name, so you can watch progress
// live or grep the output afterwards. A running summary line is also printed
// after every company.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const axios = require("axios");
const connectDB = require("../config/db");

const Company = require("../models/Company");
const { upsertIngestedJob } = require("../utils/jobPersistence");
const { syncATSCompanySignals } = require("../services/atsConnectorService");
const { isIndianLocation } = require("../utils/indiaLocation");

const CONFIG = {
  csvPath: path.join(__dirname, "zero_job_companies_with_domain.csv"),
  outReportPath: path.join(__dirname, "extraction_attempt_report.csv"),
  concurrency: 5,
  requestDelayMs: 300,
};

const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? parseInt(arg.split("=")[1], 10) : null;
})();
const RESTART = process.argv.includes("--restart");
const VERBOSE = process.argv.includes("--verbose");

function guessSlugsFromDomain(domain) {
  const base = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(".")[0]
    .toLowerCase();
  const variants = new Set([base, base.replace(/-/g, ""), base.replace(/_/g, "")]);
  return [...variants].filter(Boolean);
}

// Tag a rate-limit so callers can tell "quota hit" apart from "no board here".
function rateLimitError() {
  const err = new Error("RATE_LIMITED");
  err.rateLimited = true;
  return err;
}

async function tryGreenhouse(slug) {
  const res = await axios.get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
    params: { content: true },
    validateStatus: () => true,
  });
  if (res.status === 429) throw rateLimitError();
  if (res.status !== 200) return null;
  const jobs = res.data?.jobs || [];
  return jobs.map((j) => ({
    title: j.title,
    applyLink: j.absolute_url,
    location: j.location?.name || null,
    description: j.content ? j.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null,
    postedDate: j.updated_at ? new Date(j.updated_at) : null,
    source: "greenhouse",
    boardUrl: `https://boards.greenhouse.io/${slug}`,
  }));
}

async function tryLever(slug) {
  const res = await axios.get(`https://api.lever.co/v0/postings/${slug}`, {
    params: { mode: "json" },
    validateStatus: () => true,
  });
  if (res.status === 429) throw rateLimitError();
  if (res.status !== 200 || !Array.isArray(res.data)) return null;
  return res.data.map((j) => ({
    title: j.text,
    applyLink: j.hostedUrl,
    location: j.categories?.location || null,
    description: j.descriptionPlain || j.description || null,
    postedDate: j.createdAt ? new Date(j.createdAt) : null,
    source: "lever",
    boardUrl: `https://jobs.lever.co/${slug}`,
  }));
}

async function tryAshby(slug) {
  const res = await axios.get(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, {
    validateStatus: () => true,
  });
  if (res.status === 429) throw rateLimitError();
  if (res.status !== 200) return null;
  const jobs = res.data?.jobs || [];
  return jobs.map((j) => ({
    title: j.title,
    applyLink: j.jobUrl || j.applyUrl,
    // Ashby frequently puts location in a structured address object instead
    // of a flat `location` string — without this fallback, those jobs come
    // through with location: null and get silently dropped by the India
    // filter below, even when they're genuinely India-based roles.
    location: j.location || j.address?.postalAddress?.addressLocality || j.address?.postalAddress?.addressCountry || null,
    isRemote: j.isRemote === true,
    description: j.descriptionPlain || null,
    postedDate: j.publishedAt ? new Date(j.publishedAt) : null,
    source: "ashby",
    boardUrl: `https://jobs.ashbyhq.com/${slug}`,
  }));
}

async function trySmartRecruiters(slug) {
  const res = await axios.get(`https://api.smartrecruiters.com/v1/companies/${slug}/postings`, {
    validateStatus: () => true,
  });
  if (res.status === 429) throw rateLimitError();
  if (res.status !== 200) return null;
  const jobs = res.data?.content || [];
  return jobs.map((j) => ({
    title: j.name,
    applyLink: j.applyUrl || j.postingUrl,
    location: j.location?.city || null,
    description: j.jobAd?.sections?.jobDescription?.text || null,
    postedDate: j.releasedDate ? new Date(j.releasedDate) : null,
    source: "smartrecruiters",
    boardUrl: `https://jobs.smartrecruiters.com/${slug}`,
  }));
}

const FETCHERS = [
  { name: "greenhouse", fn: tryGreenhouse },
  { name: "lever", fn: tryLever },
  { name: "ashby", fn: tryAshby },
  { name: "smartrecruiters", fn: trySmartRecruiters },
];

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  const [, ...rows] = lines; // skip header
  return rows.map((line) => {
    const [_id, name, source, domain] = line.split(",");
    return { _id, name, source, domain };
  });
}

function loadAlreadyProcessedIds() {
  if (RESTART || !fs.existsSync(CONFIG.outReportPath)) return new Set();
  const lines = fs.readFileSync(CONFIG.outReportPath, "utf8").trim().split("\n");
  const [, ...rows] = lines;
  return new Set(rows.map((line) => line.split(",")[0]));
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function pickProviderName(jobs) {
  return jobs[0].source;
}

async function processCompany(company, debugCounters) {
  const slugs = guessSlugsFromDomain(company.domain);

  for (const slug of slugs) {
    for (const { name: fetcherName, fn } of FETCHERS) {
      let jobs;
      try {
        jobs = await fn(slug);
        if (VERBOSE) {
          console.log(`  [TRY] ${company.name} | ${fetcherName} | slug="${slug}" -> ${jobs === null ? "no board (404/non-200)" : jobs.length + " job(s) on board"}`);
        }
      } catch (err) {
        // Quota hit — bail out of this company entirely rather than treating
        // it as "no board found". The main loop will skip writing a report
        // row so this company stays eligible for the next run.
        if (err.rateLimited) {
          return { matched: false, rateLimited: true, fetcher: fetcherName };
        }
        // Any other error (DNS failure, timeout, connection refused, etc.)
        // was previously swallowed silently here and treated exactly like a
        // real "no board at this slug" result — making network/proxy issues
        // indistinguishable from genuine non-matches. Log it so it's visible.
        if (debugCounters) debugCounters.fetchErrors++;
        console.log(`  [FETCH-ERROR] ${company.name} | ${fetcherName} | slug="${slug}" | ${err.code || err.message}`);
        jobs = null;
      }
      await sleep(CONFIG.requestDelayMs);
      if (!jobs || jobs.length === 0) continue;

      // hasIndianPresence:true matches the convention used everywhere else in
      // this codebase (see skillBasedJobSearchService.js's `isIndia` wrapper)
      // — without it, isIndianLocation() defaults ambiguous/missing location
      // strings to `false`, silently dropping real jobs whose location data
      // just wasn't in a plain string (see the Ashby address fallback above).
      //
      // isRemote is ONLY used as a tiebreaker when there's no concrete
      // location string at all. It must NOT override an explicit non-India
      // location (e.g. isRemote:true + location:"South Africa" is a remote
      // role FOR South Africa, not a global-anywhere role) — doing so let 16
      // non-India roles (UAE, Vietnam, Bangladesh, Argentina, etc.) through
      // as false positives on paymentology's test run.
      const indiaJobs = jobs.filter((j) => {
        if (isIndianLocation(j.location, { hasIndianPresence: true })) return true;
        const hasConcreteLocation = j.location && String(j.location).trim().length > 0;
        return j.isRemote === true && !hasConcreteLocation;
      });
      if (indiaJobs.length === 0) continue; // slug matched a real board, but not this company / no India roles

      const companyDoc = await Company.findById(company._id);
      if (!companyDoc) continue;

      console.log(
        `\n[MATCH] ${companyDoc.name} -> ${fetcherName} board "${slug}" — ${indiaJobs.length} India job(s) found`
      );

      let newCount = 0;
      let updatedCount = 0;

      for (const j of indiaJobs) {
        const beforeCall = new Date();
        const savedJob = await upsertIngestedJob({
          title: j.title,
          company: companyDoc._id,
          location: j.location || "India",
          applyLink: j.applyLink,
          description: j.description,
          source: j.source,
          postedDate: j.postedDate,
          isRemote: false,
        });

        // firstSeenAt is only set via $setOnInsert on a brand-new row, so if
        // it lands within a few seconds of our own "before" timestamp this
        // was a genuinely new job; otherwise it's an existing job we just
        // refreshed (lastSeenAt/isActive touched).
        const isNew = savedJob?.firstSeenAt && Math.abs(savedJob.firstSeenAt.getTime() - beforeCall.getTime()) < 5000;
        if (isNew) newCount++;
        else updatedCount++;

        console.log(
          `  ${isNew ? "[NEW]    " : "[REFRESH]"} ${companyDoc.name} | ${j.title || "(untitled)"} | ${
            j.location || "India"
          } | ${j.source}`
        );
      }

      await syncATSCompanySignals({
        company: companyDoc,
        companyName: companyDoc.name,
        provider: pickProviderName(indiaJobs),
        boardUrl: indiaJobs[0].boardUrl,
        careersUrl: indiaJobs[0].boardUrl,
        website: companyDoc.website || null,
        domain: companyDoc.domain || null,
        discoverySource: "zero-job-backfill",
        discoveryMethod: "domain-slug-guess",
        parserType: `${fetcherName}-api`,
        jobsFound: indiaJobs.length,
        status: "active",
      });

      console.log(
        `[DONE]  ${companyDoc.name}: ${newCount} new job(s), ${updatedCount} refreshed job(s) via ${fetcherName}\n`
      );

      return { matched: true, fetcher: fetcherName, slug, jobCount: indiaJobs.length, newCount, updatedCount };
    }
  }
  return { matched: false };
}

async function main() {
  if (!fs.existsSync(CONFIG.csvPath)) {
    console.error(`Missing ${CONFIG.csvPath}. Run diagnoseZeroJobCompanies.js first.`);
    process.exit(1);
  }

  await connectDB();

  let companies = parseCsv(CONFIG.csvPath);
  const alreadyProcessed = loadAlreadyProcessedIds();
  const skippedCount = companies.filter((c) => alreadyProcessed.has(c._id)).length;
  companies = companies.filter((c) => !alreadyProcessed.has(c._id));

  if (skippedCount > 0) {
    console.log(`Resuming: skipping ${skippedCount} companies already processed in a previous run.`);
    console.log(`(Pass --restart to ignore the existing report and start over.)\n`);
  }

  if (LIMIT) {
    companies = companies.slice(0, LIMIT);
    console.log(`--limit=${LIMIT} set: processing only the next ${companies.length} companies.\n`);
  }

  console.log(`Loaded ${companies.length} zero-job companies with a domain to re-probe.\n`);

  const reportIsNew = RESTART || !fs.existsSync(CONFIG.outReportPath);
  if (reportIsNew) {
    fs.writeFileSync(CONFIG.outReportPath, "_id,name,domain,matched,fetcher,slug,jobCount,newCount,updatedCount\n");
  }
  const reportStream = fs.createWriteStream(CONFIG.outReportPath, { flags: "a" });

  let matchedCount = 0;
  let totalNewJobs = 0;
  let totalRefreshedJobs = 0;
  let processedCount = 0;
  let rateLimitedCount = 0;
  const debugCounters = { fetchErrors: 0 };

  let i = 0;
  async function worker() {
    while (i < companies.length) {
      const idx = i++;
      const company = companies[idx];
      let result;
      try {
        result = await processCompany(company, debugCounters);
      } catch (err) {
        result = { matched: false };
        console.log(`  [ERROR] ${company.name}: ${err.message}`);
      }

      if (result.rateLimited) {
        // Quota hit — do NOT write a report row. Leaving this company out of
        // extraction_attempt_report.csv keeps it eligible for the next run
        // instead of permanently blacklisting it as "no match found".
        rateLimitedCount++;
        console.log(`  [SKIP-QUOTA] ${company.name}: ${result.fetcher} rate-limited, will retry next run`);
        processedCount++;
        if (processedCount % 25 === 0) {
          console.log(
            `--- Progress: ${processedCount}/${companies.length} | matched: ${matchedCount} | new jobs: ${totalNewJobs} | refreshed: ${totalRefreshedJobs} | rate-limited (retry next run): ${rateLimitedCount} ---`
          );
        }
        continue;
      }

      if (result.matched) {
        matchedCount++;
        totalNewJobs += result.newCount || 0;
        totalRefreshedJobs += result.updatedCount || 0;
      }
      reportStream.write(
        `${company._id},${company.name},${company.domain},${result.matched},${result.fetcher || ""},${
          result.slug || ""
        },${result.jobCount || 0},${result.newCount || 0},${result.updatedCount || 0}\n`
      );
      processedCount++;
      if (processedCount % 25 === 0) {
        console.log(
          `--- Progress: ${processedCount}/${companies.length} | matched: ${matchedCount} | new jobs: ${totalNewJobs} | refreshed: ${totalRefreshedJobs} | rate-limited (retry next run): ${rateLimitedCount} ---`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONFIG.concurrency }, worker));
  reportStream.end();

  console.log(`\nDone. Matched ${matchedCount}/${companies.length} companies to at least one ATS job.`);
  console.log(`Total new jobs added: ${totalNewJobs}`);
  console.log(`Total existing jobs refreshed: ${totalRefreshedJobs}`);
  if (debugCounters.fetchErrors > 0) {
    console.log(
      `\n${debugCounters.fetchErrors} requests failed outright (DNS/timeout/connection errors, NOT 404s) — see [FETCH-ERROR] lines above.`
    );
    console.log(
      `If this number is high relative to companies processed, it likely means requests aren't reaching the ATS APIs at all`
    );
    console.log(
      `(no internet from this machine/network, a corporate proxy/firewall, or axios needing a proxy config) — NOT that 0 real boards exist.`
    );
  }
  if (rateLimitedCount > 0) {
    console.log(
      `${rateLimitedCount} companies were skipped due to rate limiting and were NOT written to the report — re-run the script to retry them.`
    );
  }
  console.log(`Full report: ${CONFIG.outReportPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});