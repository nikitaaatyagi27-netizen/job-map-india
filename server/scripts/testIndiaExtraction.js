// server/scripts/testIndiaExtraction.js
//
// Smoke test: runs the SAME fetch + India-filter logic as
// extractJobsForZeroJobCompanies.js, but against a small hardcoded list of
// companies known to actively hire in India on Greenhouse/Lever/Ashby/
// SmartRecruiters — instead of your DB's zero-job-company CSV.
//
// Does NOT touch the database at all. No upsertIngestedJob, no
// syncATSCompanySignals, no CareerSource writes. Pure read + print, so you
// can sanity-check the pipeline logic is working before trusting the real
// (DB-writing) extraction run.
//
// Run from the `server` folder:
//   node scripts/testIndiaExtraction.js
//
// NOTE: the slugs below are best-guess based on public knowledge of these
// companies' career pages — they may be stale or wrong (companies change ATS
// providers, board slugs aren't always the obvious company name). If a
// company shows "no board found" on every fetcher, that's not necessarily a
// pipeline bug — verify manually first at:
//   https://boards.greenhouse.io/<slug>
//   https://jobs.lever.co/<slug>
//   https://jobs.ashbyhq.com/<slug>
//   https://jobs.smartrecruiters.com/<slug>
// before assuming the script is broken. Feel free to add/replace entries
// below with companies + slugs you've confirmed yourself.

require("dotenv").config();
const axios = require("axios");
const { isIndianLocation } = require("../utils/indiaLocation");

// name, slug-to-try (script will try this slug across all 4 fetchers)
const TEST_COMPANIES = [
  { name: "Razorpay", slug: "razorpay" },
  { name: "Postman", slug: "postman" },
  { name: "Chargebee", slug: "chargebee" },
  { name: "Browserstack", slug: "browserstack" },
  { name: "Freshworks", slug: "freshworks" },
  { name: "CleverTap", slug: "clevertap" },
];

async function tryGreenhouse(slug) {
  const res = await axios.get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
    params: { content: false },
    validateStatus: () => true,
  });
  if (res.status !== 200) return { status: res.status, jobs: null };
  const jobs = (res.data?.jobs || []).map((j) => ({
    title: j.title,
    location: j.location?.name || null,
    source: "greenhouse",
  }));
  return { status: res.status, jobs };
}

async function tryLever(slug) {
  const res = await axios.get(`https://api.lever.co/v0/postings/${slug}`, {
    params: { mode: "json" },
    validateStatus: () => true,
  });
  if (res.status !== 200 || !Array.isArray(res.data)) return { status: res.status, jobs: null };
  const jobs = res.data.map((j) => ({
    title: j.text,
    location: j.categories?.location || null,
    source: "lever",
  }));
  return { status: res.status, jobs };
}

async function tryAshby(slug) {
  const res = await axios.get(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, {
    validateStatus: () => true,
  });
  if (res.status !== 200) return { status: res.status, jobs: null };
  const jobs = (res.data?.jobs || []).map((j) => ({
    title: j.title,
    location: j.location || j.address?.postalAddress?.addressLocality || j.address?.postalAddress?.addressCountry || null,
    isRemote: j.isRemote === true,
    source: "ashby",
  }));
  return { status: res.status, jobs };
}

async function trySmartRecruiters(slug) {
  const res = await axios.get(`https://api.smartrecruiters.com/v1/companies/${slug}/postings`, {
    validateStatus: () => true,
  });
  if (res.status !== 200) return { status: res.status, jobs: null };
  const jobs = (res.data?.content || []).map((j) => ({
    title: j.name,
    location: j.location?.city || null,
    source: "smartrecruiters",
  }));
  return { status: res.status, jobs };
}

const FETCHERS = [
  { name: "greenhouse", fn: tryGreenhouse },
  { name: "lever", fn: tryLever },
  { name: "ashby", fn: tryAshby },
  { name: "smartrecruiters", fn: trySmartRecruiters },
];

function isIndiaJob(job) {
  if (isIndianLocation(job.location, { hasIndianPresence: true })) return true;
  const hasConcreteLocation = job.location && String(job.location).trim().length > 0;
  return job.isRemote === true && !hasConcreteLocation;
}

async function testCompany(company) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${company.name}  (slug="${company.slug}")`);
  console.log("=".repeat(60));

  let foundAnyBoard = false;

  for (const { name: fetcherName, fn } of FETCHERS) {
    let result;
    try {
      result = await fn(company.slug);
    } catch (err) {
      console.log(`  [${fetcherName}] ERROR: ${err.code || err.message}`);
      continue;
    }

    if (result.jobs === null) {
      console.log(`  [${fetcherName}] no board (status ${result.status})`);
      continue;
    }

    foundAnyBoard = true;
    const total = result.jobs.length;
    const indiaJobs = result.jobs.filter(isIndiaJob);

    console.log(`  [${fetcherName}] BOARD FOUND — ${total} total job(s), ${indiaJobs.length} pass India filter`);
    for (const j of indiaJobs.slice(0, 8)) {
      console.log(`      [INDIA] ${j.title} | ${j.location || "(no location / ambiguous-remote)"}`);
    }
    if (indiaJobs.length > 8) {
      console.log(`      ...and ${indiaJobs.length - 8} more`);
    }

    // Show a couple of rejected ones too, so you can eyeball the filter is
    // correctly excluding non-India roles, not just correctly including
    // India ones.
    const rejected = result.jobs.filter((j) => !isIndiaJob(j)).slice(0, 3);
    if (rejected.length > 0) {
      console.log(`      (sample rejected, correctly excluded):`);
      for (const j of rejected) {
        console.log(`      [SKIP]  ${j.title} | ${j.location || "(no location)"}`);
      }
    }
  }

  if (!foundAnyBoard) {
    console.log(`  No board found on any platform for slug "${company.slug}".`);
    console.log(`  This may mean: wrong slug guess, different ATS provider, or no public API board.`);
  }
}

async function main() {
  console.log(`Testing India-job extraction pipeline against ${TEST_COMPANIES.length} known India-hiring companies.`);
  console.log(`This does NOT write anything to the database — read-only smoke test.\n`);

  for (const company of TEST_COMPANIES) {
    await testCompany(company);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done. If you saw [INDIA] results with real Indian cities (Bangalore,`);
  console.log(`Hyderabad, Pune, Chennai, Gurugram, etc.) above, the pipeline is`);
  console.log(`working correctly. If a company showed "no board found" on every`);
  console.log(`platform, that specific slug guess was likely wrong — verify manually`);
  console.log(`at boards.greenhouse.io/<slug>, jobs.lever.co/<slug>, etc.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});