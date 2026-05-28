// Probe Oracle Taleo career sites for major Indian companies.
// Taleo is the dominant ATS for Indian IT services companies (Wipro, etc.)
// and many global MNCs with large India centres.
//
// The Taleo REST API endpoint:
//   GET https://{tenant}.taleo.net/careersection/rest/jobboard/requisition/list
//   No auth required for public job listings.
//
// Run: node server/scripts/probeTaleoTenants.js
// Requires SERPER_API_KEY in server/.env

require('dotenv').config();
const axios = require('axios');

const SERPER_URL     = 'https://google.serper.dev/search';
const PROBE_TIMEOUT  = 12000;
const SERPER_TIMEOUT = 15000;

const COMPANIES = [
  // ── Indian IT services ────────────────────────────────────────────────────
  { name: 'Wipro',               hints: ['wipro', 'wiproltd', 'wiprolimited'] },
  { name: 'HCL Technologies',    hints: ['hcl', 'hcltech', 'hclinfosystems'] },
  { name: 'Capgemini',           hints: ['capgemini'] },
  { name: 'Infosys',             hints: ['infosys'] },
  { name: 'Cognizant',           hints: ['cognizant', 'ctsh'] },
  { name: 'LTIMindtree',         hints: ['lti', 'mindtree', 'ltimindtree', 'larsentoubro'] },
  { name: 'Mphasis',             hints: ['mphasis'] },
  { name: 'Hexaware',            hints: ['hexaware'] },
  { name: 'Nagarro',             hints: ['nagarro'] },
  { name: 'Birlasoft',           hints: ['birlasoft'] },
  { name: 'Zensar Technologies', hints: ['zensar'] },
  { name: 'Cyient',              hints: ['cyient', 'infotech'] },
  { name: 'Persistent Systems',  hints: ['persistent'] },
  { name: 'Tata Communications', hints: ['tata', 'tatacommunications', 'tatacomm'] },
  { name: 'KPIT Technologies',   hints: ['kpit'] },
  // ── BPO / GCC ─────────────────────────────────────────────────────────────
  { name: 'Genpact',             hints: ['genpact'] },
  { name: 'Concentrix',          hints: ['concentrix', 'convergys'] },
  { name: 'EXL Service',         hints: ['exl', 'exlservice'] },
  { name: 'WNS',                 hints: ['wns'] },
  { name: 'Amdocs',              hints: ['amdocs'] },
  // ── Global MNCs with large India GCCs ────────────────────────────────────
  { name: 'Siemens',             hints: ['siemens'] },
  { name: 'Ericsson',            hints: ['ericsson'] },
  { name: 'Honeywell',           hints: ['honeywell'] },
  { name: 'Cummins',             hints: ['cummins'] },
  { name: 'Bosch',               hints: ['bosch', 'boschindia'] },
  { name: 'Continental',         hints: ['continental', 'conti'] },
  { name: 'Jabil',               hints: ['jabil'] },
  { name: 'Ansys',               hints: ['ansys'] },
  { name: 'Bentley Systems',     hints: ['bentley'] },
  { name: 'Synopsys',            hints: ['synopsys'] },
  { name: 'Rockwell Automation', hints: ['rockwell'] },
  // ── Finance ───────────────────────────────────────────────────────────────
  { name: 'Standard Chartered',  hints: ['standardchartered', 'scb'] },
  { name: 'American Express',    hints: ['amex', 'americanexpress'] },
  { name: 'JPMorgan Chase',      hints: ['jpmorgan', 'jpmc', 'jpmorganchase'] },
  { name: 'Goldman Sachs',       hints: ['goldman', 'gs', 'goldmansachs'] },
  { name: 'HSBC',                hints: ['hsbc'] },
];

// Taleo URL patterns to extract from search results
const TALEO_HOST_RE = /([a-z0-9-]+)\.taleo\.net/gi;

function tenantMatchesHints(tenant, hints) {
  const t = tenant.toLowerCase().replace(/[-_]/g, '');
  return hints.some(h => t.includes(h.toLowerCase().replace(/[-_]/g, '')));
}

function extractTaleoTenants(text) {
  const tenants = new Set();
  const re = new RegExp(TALEO_HOST_RE.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    tenants.add(m[1].toLowerCase());
  }
  return [...tenants];
}

async function searchSerper(query) {
  const res = await axios.post(
    SERPER_URL,
    { q: query, num: 10 },
    { headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: SERPER_TIMEOUT }
  );
  return res.data?.organic || [];
}

// Probe the Taleo REST API for a given tenant
async function probeTaleoTenant(tenant) {
  // Two API endpoints — Taleo versions differ
  const endpoints = [
    `https://${tenant}.taleo.net/careersection/rest/jobboard/requisition/list`,
    `https://${tenant}.taleo.net/careersection/rest/jobboard/requisition/list?lang=en`,
  ];

  for (const url of endpoints) {
    try {
      const res = await axios.get(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: PROBE_TIMEOUT
      });
      // Taleo response shape: { requisitionList: [...], total: N }
      const total =
        res.data?.totalCount ??
        res.data?.total ??
        (Array.isArray(res.data?.requisitionList) ? res.data.requisitionList.length : 0) ??
        (Array.isArray(res.data?.jobs) ? res.data.jobs.length : 0);
      if (Number(total) > 0) return { ok: true, total: Number(total) };
    } catch { /* try next */ }
  }
  return { ok: false, total: 0 };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findCandidateTenants(company) {
  const candidates = new Set();

  // Strategy 1: Serper — find taleo.net URLs mentioning this company
  const queries = [
    `"${company.name}" "taleo.net"`,
    `"${company.name}" site:taleo.net`,
  ];

  for (const q of queries) {
    try {
      const results = await searchSerper(q);
      for (const r of results) {
        for (const text of [r.link || '', r.snippet || '', r.title || '']) {
          for (const tenant of extractTaleoTenants(text)) {
            if (tenantMatchesHints(tenant, company.hints)) candidates.add(tenant);
          }
        }
      }
      await sleep(200);
    } catch { /* one query failing is ok */ }
  }

  // Strategy 2: Direct probe of common tenant name variants as fallback
  if (candidates.size === 0) {
    for (const hint of company.hints) {
      const cleaned = hint.replace(/[-_]/g, '');
      candidates.add(cleaned);
      candidates.add(`${cleaned}ext`);
      candidates.add(`${cleaned}ltd`);
    }
  }

  return [...candidates];
}

async function run() {
  if (!process.env.SERPER_API_KEY) {
    console.error('SERPER_API_KEY not set in .env');
    process.exit(1);
  }

  console.log(`\n[PROBE] Searching ${COMPANIES.length} companies for Taleo boards...\n`);

  const confirmed = [];
  const notOnTaleo = [];

  for (const c of COMPANIES) {
    let found = null;

    try {
      const tenants = await findCandidateTenants(c);
      for (const tenant of tenants) {
        const result = await probeTaleoTenant(tenant);
        if (result.ok) {
          found = { tenant, total: result.total };
          break;
        }
      }
    } catch (err) {
      console.log(`  ⚠️  ${c.name.padEnd(28)} Error: ${err.message}`);
      await sleep(1000);
      continue;
    }

    if (found) {
      console.log(`  ✅ ${c.name.padEnd(28)} ${found.tenant}.taleo.net | jobs: ${found.total}`);
      confirmed.push({ company: c.name, tenant: found.tenant, total: found.total });
    } else {
      notOnTaleo.push(c.name);
      console.log(`  ❌ ${c.name}`);
    }

    await sleep(400);
  }

  console.log('\n\n══════════════════════════════════════════════════════════');
  console.log('  Paste these into CURATED_TALEO_TENANTS in');
  console.log('  server/services/taleoService.js');
  console.log('══════════════════════════════════════════════════════════\n');

  for (const c of confirmed) {
    console.log(`  { tenant: '${c.tenant}', companyName: '${c.company}' },  // ${c.total} total jobs`);
  }

  if (notOnTaleo.length) {
    console.log(`\n  Not on Taleo (try iCIMS/custom portal): ${notOnTaleo.join(', ')}`);
  }

  console.log(`\n[PROBE] Done — ${confirmed.length}/${COMPANIES.length} confirmed\n`);
}

run().catch(err => {
  console.error('[PROBE] Fatal:', err.message);
  process.exit(1);
});
