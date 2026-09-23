// Detect which ATS a company's careers site actually runs on — WITHOUT any
// search API (no Serper, no SerpAPI, no key of any kind).
//
// How it's different from detectCompanyATS.js:
//   That script asks Google "site:taleo.net Capgemini" and hopes a snippet
//   contains the tenant URL. This script instead opens the company's real
//   careers page in a real headless browser, captures EVERY network request
//   the page fires (XHRs, redirects, iframe src, fetch calls — the stuff a
//   search-engine snippet would never show you because it's JS-rendered),
//   and runs the same ATS regex bank against that live traffic.
//
// You only need to supply each company's public careers URL once — that's a
// 10-second manual lookup (company.com/careers is public knowledge), not
// something that needs a search API.
//
// Requires: puppeteer-core (already a dependency) + a local Chrome/Edge.
// Set CHROME_PATH in server/.env if it isn't auto-detected.
//
// Run: node server/scripts/detectCompanyATSNoSearch.js

require('dotenv').config();
const fs = require('fs');
const puppeteer = require('puppeteer-core');

// ── Seed with each company's real, public careers URL. Add more as needed. ──
const TARGETS = [
  { name: 'Accenture',  careersUrl: 'https://www.accenture.com/in-en/careers/jobsearch?jk=india' },
  { name: 'Capgemini',  careersUrl: 'https://www.capgemini.com/in-en/careers/join-capgemini/' },
  { name: 'HCLTech',    careersUrl: 'https://www.hcltech.com/careers' },
  { name: 'Google',     careersUrl: 'https://careers.google.com/jobs/results/?location=India' },
];

// Same pattern bank as detectCompanyATS.js — reused so results are compatible
// with the CURATED_*_TENANTS arrays in each ATS service file.
const ATS_PATTERNS = [
  { name: 'Workday',          re: /([a-z0-9-]+\.(?:wd\d+\.)?myworkdayjobs\.com)/i },
  { name: 'Greenhouse',       re: /boards\.greenhouse\.io\/([a-z0-9_-]+)/i },
  { name: 'Lever',            re: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { name: 'Ashby',            re: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
  { name: 'SmartRecruiters',  re: /jobs\.smartrecruiters\.com\/([a-z0-9_-]+)/i },
  { name: 'Taleo',            re: /([a-z0-9-]+)\.taleo\.net/i },
  { name: 'SuccessFactors',   re: /([a-z0-9-]+)\.(?:jobs\.ondemand|successfactors(?:\.eu)?)\.com/i },
  { name: 'iCIMS',            re: /([a-z0-9-]+(?:-[a-z0-9]+)*)\.icims\.com/i },
  { name: 'Kenexa/BrassRing', re: /([a-z0-9-]+)\.brassring\.com/i },
  { name: 'Jobvite',          re: /([a-z0-9-]+)\.jobvite\.com/i },
  { name: 'Workable',         re: /(?:apply\.workable\.com|([a-z0-9-]+)\.workable\.com)/i },
  { name: 'Oracle Recruit',   re: /([a-z0-9-]+)\.fa\.[a-z0-9]+\.oraclecloud\.com/i },
  { name: 'Avature',          re: /([a-z0-9-]+)\.avature\.net/i },
  { name: 'Phenom People',    re: /([a-z0-9-]+)\.phenompeople\.com/i },
  { name: 'Eightfold',        re: /([a-z0-9-]+)\.eightfold\.ai/i },
];

function detectATS(urlOrText) {
  const hits = [];
  for (const { name, re } of ATS_PATTERNS) {
    const m = urlOrText.match(re);
    if (m) hits.push({ ats: name, fragment: m[1] || m[0], raw: m[0] });
  }
  return hits;
}

function getBrowserExecutablePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inspectCompany(browser, target) {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  const seenUrls = new Set();

  // Capture every request the page fires — this is what catches ATS calls
  // loaded via JS/XHR/iframe that a static HTML fetch or search snippet misses.
  page.on('request', (req) => seenUrls.add(req.url()));
  page.on('response', (res) => seenUrls.add(res.url()));
  page.on('frameattached', (frame) => {
    if (frame.url()) seenUrls.add(frame.url());
  });

  const found = new Map();

  try {
    const response = await page.goto(target.careersUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Final URL after any redirect chain — enterprise "careers" links very
    // often just 302 straight to the real ATS domain.
    if (response?.url()) seenUrls.add(response.url());

    // Give lazy-loaded widgets/iframes a moment to fire their calls.
    await sleep(2500);

    // Also scan the rendered HTML body — some ATS URLs only ever appear as
    // a plain <a href> or <iframe src>, never as a captured network request.
    const html = await page.content();

    for (const url of seenUrls) {
      for (const hit of detectATS(url)) {
        if (!found.has(hit.ats)) found.set(hit.ats, hit.raw);
      }
    }
    for (const hit of detectATS(html)) {
      if (!found.has(hit.ats)) found.set(hit.ats, hit.raw);
    }
  } catch (err) {
    console.log(`  ⚠️  ${target.name} — page load failed: ${err.message}`);
  } finally {
    await page.close();
  }

  return [...found.entries()].map(([ats, fragment]) => ({ ats, fragment }));
}

async function run() {
  const executablePath = getBrowserExecutablePath();
  if (!executablePath) {
    console.error('No Chrome/Edge found. Set CHROME_PATH in server/.env');
    process.exit(1);
  }

  console.log(`\n[ATS DETECT] Inspecting ${TARGETS.length} companies via live browser (no search API)...\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const results = {};

  try {
    for (const target of TARGETS) {
      const hits = await inspectCompany(browser, target);
      if (hits.length > 0) {
        console.log(`  ✅ ${target.name.padEnd(20)} → ${hits.map((h) => `${h.ats} (${h.fragment})`).join(', ')}`);
      } else {
        console.log(`  ❓ ${target.name.padEnd(20)} → No known ATS detected — likely custom/proprietary. Route via registerUniversalSource().`);
      }
      results[target.name] = hits;
      await sleep(500);
    }
  } finally {
    await browser.close();
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Next step: paste confirmed tenants into the matching');
  console.log('  CURATED_*_TENANTS array (successFactorsService.js /');
  console.log('  taleoService.js / workdayService.js). Anything "Unknown"');
  console.log('  should go through registerUniversalSource() instead.');
  console.log('══════════════════════════════════════════════════════════\n');

  return results;
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[ATS DETECT] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { run, detectATS, ATS_PATTERNS };