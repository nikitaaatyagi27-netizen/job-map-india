// Detect which ATS each company actually uses.
//
// Key fix over v1: every matched ATS URL is validated against company hints —
// a Glassdoor/LinkedIn page mentioning "Wipro" that also contains a
// Blackstone Workday link will NOT be reported as Wipro using Workday.
//
// Run: node server/scripts/detectCompanyATS.js
// Requires SERPER_API_KEY in server/.env

require('dotenv').config();
const axios = require('axios');

const SERPER_URL     = 'https://google.serper.dev/search';
const SERPER_TIMEOUT = 15000;

// hints[] = strings that must appear in the ATS URL/path for the match to count
const COMPANIES = [
  { name: 'Wipro',               hints: ['wipro'] },
  { name: 'HCL Technologies',    hints: ['hcl', 'hcltech', 'hclinfosystems'] },
  { name: 'Capgemini',           hints: ['capgemini'] },
  { name: 'Infosys',             hints: ['infosys'] },
  { name: 'Cognizant',           hints: ['cognizant', 'ctsh'] },
  { name: 'LTIMindtree',         hints: ['lti', 'mindtree', 'ltimindtree'] },
  { name: 'Mphasis',             hints: ['mphasis'] },
  { name: 'Hexaware',            hints: ['hexaware'] },
  { name: 'Nagarro',             hints: ['nagarro'] },
  { name: 'Birlasoft',           hints: ['birlasoft'] },
  { name: 'Zensar Technologies', hints: ['zensar'] },
  { name: 'Cyient',              hints: ['cyient'] },
  { name: 'Persistent Systems',  hints: ['persistent', 'persistentsystems'] },
  { name: 'Tata Communications', hints: ['tata', 'tatacommunications', 'tatacomm'] },
  { name: 'KPIT Technologies',   hints: ['kpit'] },
  { name: 'Genpact',             hints: ['genpact'] },
  { name: 'Concentrix',          hints: ['concentrix', 'cnx'] }, // cnx = stock ticker / brand
  { name: 'EXL Service',         hints: ['exl', 'exlservice'] },
  { name: 'WNS',                 hints: ['wns'] },
  { name: 'Amdocs',              hints: ['amdocs'] },
  { name: 'Siemens',             hints: ['siemens'] },
  { name: 'Ericsson',            hints: ['ericsson'] },
  { name: 'Honeywell',           hints: ['honeywell'] },
  { name: 'Cummins',             hints: ['cummins'] },
  { name: 'Bosch',               hints: ['bosch', 'boschindia'] },
  { name: 'Continental',         hints: ['continental', 'conti'] },
  { name: 'Jabil',               hints: ['jabil'] },
];

// ATS patterns — regex extracts a URL fragment; fragment is then validated
// against company hints before being accepted.
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
  { name: 'iBegin',           re: /([a-z0-9-]+)\.ibegin\.com/i },
  { name: 'Jobvite',          re: /([a-z0-9-]+)\.jobvite\.com/i },
  { name: 'BambooHR',         re: /([a-z0-9-]+)\.bamboohr\.com/i },
  { name: 'Workable',         re: /(?:apply\.workable\.com|([a-z0-9-]+)\.workable\.com)/i },
  { name: 'Recruitee',        re: /([a-z0-9-]+)\.recruitee\.com/i },
  { name: 'TeamTailor',       re: /([a-z0-9-]+)\.teamtailor\.com/i },
  { name: 'Oracle Recruit',   re: /([a-z0-9-]+)\.fa\.[a-z0-9]+\.oraclecloud\.com/i },
  { name: 'Personio',         re: /([a-z0-9-]+)\.personio\.com/i },
];

// The matched fragment must contain at least one company hint.
// This filters out "Wipro mentioned on a Blackstone Workday page" false positives.
function fragmentMatchesHints(fragment, hints) {
  const f = fragment.toLowerCase().replace(/[-_.]/g, '');
  return hints.some(h => f.includes(h.toLowerCase().replace(/[-_]/g, '')));
}

function detectValidATS(text, hints) {
  const hits = [];
  for (const { name, re } of ATS_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    // m[1] is the capturing group (subdomain / slug), m[0] is the full match
    const fragment = m[1] || m[0];
    if (fragmentMatchesHints(fragment, hints)) {
      hits.push({ ats: name, fragment: m[0] });
    }
  }
  return hits;
}

async function searchSerper(query) {
  const res = await axios.post(
    SERPER_URL,
    { q: query, num: 10 },
    { headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: SERPER_TIMEOUT }
  );
  return res.data?.organic || [];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function detectForCompany({ name, hints }) {
  const detections = new Map();

  // General search — finds career page; aggregator pages filtered by hint validation
  // Targeted site: searches — forces Google to return ATS-hosted pages directly
  const queries = [
    `"${name}" careers india apply jobs`,
    `"${name}" site:taleo.net OR site:myworkdayjobs.com OR site:icims.com OR site:brassring.com`,
    `"${name}" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com OR site:successfactors.com`,
    `"${name}" site:ibegin.com OR site:oraclecloud.com OR site:smartrecruiters.com`,
  ];

  for (const q of queries) {
    try {
      const results = await searchSerper(q);
      for (const r of results) {
        for (const text of [r.link || '', r.snippet || '']) {
          for (const hit of detectValidATS(text, hints)) {
            if (!detections.has(hit.ats)) detections.set(hit.ats, hit.fragment);
          }
        }
      }
      await sleep(200);
    } catch { /* skip failed query */ }
  }

  return [...detections.entries()].map(([ats, fragment]) => ({ ats, fragment }));
}

async function run() {
  if (!process.env.SERPER_API_KEY) {
    console.error('SERPER_API_KEY not set in .env');
    process.exit(1);
  }

  console.log(`\n[ATS DETECT] Detecting ATS for ${COMPANIES.length} companies...\n`);

  const results = {};

  for (const company of COMPANIES) {
    const hits = await detectForCompany(company);

    if (hits.length > 0) {
      const summary = hits.map(h => `${h.ats} (${h.fragment})`).join(', ');
      console.log(`  ✅ ${company.name.padEnd(28)} → ${summary}`);
    } else {
      console.log(`  ❓ ${company.name.padEnd(28)} → Unknown / proprietary`);
    }

    results[company.name] = hits;
    await sleep(400);
  }

  // Group by ATS
  console.log('\n\n══════════════════════════════════════════════════════════');
  console.log('  Confirmed ATS — only entries where URL matches company name');
  console.log('══════════════════════════════════════════════════════════\n');

  const byATS = {};
  for (const [company, hits] of Object.entries(results)) {
    if (hits.length === 0) {
      (byATS['Unknown'] = byATS['Unknown'] || []).push(company);
    }
    for (const { ats, fragment } of hits) {
      (byATS[ats] = byATS[ats] || []).push(`${company} → ${fragment}`);
    }
  }

  for (const [ats, entries] of Object.entries(byATS).sort()) {
    console.log(`  ${ats}`);
    entries.forEach(e => console.log(`    • ${e}`));
  }

  console.log('\n[ATS DETECT] Done\n');
}

run().catch(err => {
  console.error('[ATS DETECT] Fatal:', err.message);
  process.exit(1);
});
