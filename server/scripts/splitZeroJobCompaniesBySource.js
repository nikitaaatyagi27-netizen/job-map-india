// server/scripts/splitZeroJobCompaniesBySource.js
//
// Splits zero_job_companies_with_domain.csv (output of diagnoseZeroJobCompanies.js)
// into three subsets, routed to whichever discovery method is actually capable
// of finding jobs for that source of company:
//
//   1. ats_candidates.csv       -> feed into extractJobsForZeroJobCompanies.js
//      Sources: skill-search, web-search, manual-seed, bulk-curated-ats,
//      greenhouse, ashby, smartrecruiters, remotive, arbeitnow
//      These are the sources most likely to be startup/VC-backed companies
//      that actually run on Greenhouse/Lever/Ashby/SmartRecruiters — the only
//      4 boards extractJobsForZeroJobCompanies.js knows how to probe.
//
//   2. workday_candidates.csv   -> feed into workdayDiscoveryService.js
//      Source: workday
//      extractJobsForZeroJobCompanies.js deliberately skips these (tenant
//      subdomains can't be guessed from a plain domain) — this is the
//      dedicated Workday discovery path instead.
//
//   3. domain_scrape_candidates.csv -> feed into companyWebsiteDiscoveryService.js
//      Sources: naukri, adzuna, jsearch, ats-discovery
//      Large/traditional employers most likely to run a custom in-house
//      careers page rather than a known ATS — needs direct {domain}/careers,
//      {domain}/jobs probing rather than an ATS-slug guess.
//
// Run from the `server` folder:
//   node scripts/splitZeroJobCompaniesBySource.js
//
// Input:  scripts/zero_job_companies_with_domain.csv
// Output: scripts/ats_candidates.csv
//         scripts/workday_candidates.csv
//         scripts/domain_scrape_candidates.csv

const fs = require("fs");
const path = require("path");

const CONFIG = {
  inCsvPath: path.join(__dirname, "zero_job_companies_with_domain.csv"),
  outAtsPath: path.join(__dirname, "ats_candidates.csv"),
  outWorkdayPath: path.join(__dirname, "workday_candidates.csv"),
  outDomainScrapePath: path.join(__dirname, "domain_scrape_candidates.csv"),
};

// Route table: original ingestion `source` -> which output bucket it belongs in.
const ATS_SOURCES = new Set([
  "skill-search",
  "web-search",
  "manual-seed",
  "bulk-curated-ats",
  "greenhouse",
  "ashby",
  "smartrecruiters",
  "remotive",
  "arbeitnow",
]);
const WORKDAY_SOURCES = new Set(["workday"]);
const DOMAIN_SCRAPE_SOURCES = new Set(["naukri", "adzuna", "jsearch", "ats-discovery"]);

function main() {
  if (!fs.existsSync(CONFIG.inCsvPath)) {
    console.error(`Missing ${CONFIG.inCsvPath}. Run diagnoseZeroJobCompanies.js first.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(CONFIG.inCsvPath, "utf8").trim().split("\n");
  const [header, ...rows] = lines;

  const buckets = {
    ats: [header],
    workday: [header],
    domainScrape: [header],
  };
  const unrouted = [];

  for (const line of rows) {
    if (!line.trim()) continue;
    const source = (line.split(",")[2] || "").trim(); // _id,name,source,domain,...

    if (ATS_SOURCES.has(source)) {
      buckets.ats.push(line);
    } else if (WORKDAY_SOURCES.has(source)) {
      buckets.workday.push(line);
    } else if (DOMAIN_SCRAPE_SOURCES.has(source)) {
      buckets.domainScrape.push(line);
    } else {
      unrouted.push(line);
    }
  }

  fs.writeFileSync(CONFIG.outAtsPath, buckets.ats.join("\n"));
  fs.writeFileSync(CONFIG.outWorkdayPath, buckets.workday.join("\n"));
  fs.writeFileSync(CONFIG.outDomainScrapePath, buckets.domainScrape.join("\n"));

  console.log("Split complete:\n");
  console.log(`  ATS candidates (Greenhouse/Lever/Ashby/SmartRecruiters):  ${buckets.ats.length - 1} -> ${CONFIG.outAtsPath}`);
  console.log(`  Workday candidates:                                       ${buckets.workday.length - 1} -> ${CONFIG.outWorkdayPath}`);
  console.log(`  Domain-scrape candidates (naukri/adzuna/jsearch/ats-disc): ${buckets.domainScrape.length - 1} -> ${CONFIG.outDomainScrapePath}`);

  if (unrouted.length > 0) {
    console.log(`\n  ${unrouted.length} rows had a source not in any known bucket — left out of all three files:`);
    const unknownSources = new Set(unrouted.map((l) => l.split(",")[2] || "(blank)"));
    console.log(`  Unknown source(s): ${[...unknownSources].join(", ")}`);
  }

  console.log(`\nNext steps:`);
  console.log(`  1. Point extractJobsForZeroJobCompanies.js at ats_candidates.csv`);
  console.log(`     (rename it to zero_job_companies_with_domain.csv, or update`);
  console.log(`     CONFIG.csvPath in that script to read ats_candidates.csv directly)`);
  console.log(`  2. Feed workday_candidates.csv into workdayDiscoveryService.js`);
  console.log(`  3. Feed domain_scrape_candidates.csv into companyWebsiteDiscoveryService.js`);
}

main();