// Probe SAP SuccessFactors career sites for Indian-company tenants.
//
// Root cause of original ❌: site:jobs.ondemand.com returns near-zero results
// because SF career pages are JS-rendered and rarely indexed by Google.
// Fix: search broadly without site: restriction, extract SF domain patterns
// from both result links AND snippet text, then direct-probe the API.
//
// Run: node server/scripts/probeSuccessFactorsTenants.js
// Requires SERPER_API_KEY in server/.env

require('dotenv').config();
const axios = require('axios');

const SERPER_URL     = 'https://google.serper.dev/search';
const PROBE_TIMEOUT  = 10000;
const SERPER_TIMEOUT = 15000;

const COMPANIES = [
  // ── Indian IT services ────────────────────────────────────────────────────
  { name: 'Wipro',               hints: ['wipro'] },
  { name: 'HCL Technologies',    hints: ['hcl', 'hcltech'] },
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
  { name: 'Persistent Systems',  hints: ['persistent'] },
  { name: 'Tata Communications', hints: ['tata', 'tatacommunications', 'tatacomm'] },
  { name: 'KPIT Technologies',   hints: ['kpit'] },
  // ── BPO / GCC ─────────────────────────────────────────────────────────────
  { name: 'Genpact',             hints: ['genpact'] },
  { name: 'Concentrix',          hints: ['concentrix'] },
  { name: 'EXL Service',         hints: ['exl', 'exlservice'] },
  { name: 'WNS',                 hints: ['wns'] },
  { name: 'Amdocs',              hints: ['amdocs'] },
  // ── Global MNCs with large India GCCs ────────────────────────────────────
  { name: 'Siemens',             hints: ['siemens'] },
  { name: 'Ericsson',            hints: ['ericsson'] },
  { name: 'Honeywell',           hints: ['honeywell'] },
  { name: 'Cummins',             hints: ['cummins'] },
  { name: 'Bosch',               hints: ['bosch', 'rb'] },
  { name: 'Continental',         hints: ['continental', 'conti'] },
  { name: 'Jabil',               hints: ['jabil'] },
  { name: 'Ansys',               hints: ['ansys'] },
  { name: 'Bentley Systems',     hints: ['bentley'] },
  { name: 'Synopsys',            hints: ['synopsys'] },
  { name: 'Rockwell Automation', hints: ['rockwell'] },
  // ── Finance / Banking ─────────────────────────────────────────────────────
  { name: 'Standard Chartered',  hints: ['standardchartered', 'scb'] },
  { name: 'American Express',    hints: ['amex', 'americanexpress'] },
  { name: 'JPMorgan Chase',      hints: ['jpmorgan', 'jpmc'] },
  { name: 'Goldman Sachs',       hints: ['goldman', 'gs'] },
  { name: 'HSBC',                hints: ['hsbc'] },
  { name: 'Morningstar',         hints: ['morningstar'] },
];

// Matches any *.jobs.ondemand.com or *.successfactors.com subdomain
const SF_DOMAIN_RE = /([a-z0-9-]+)\.(?:jobs\.ondemand|successfactors(?:\.eu)?)\.com/gi;

// Validate a bare subdomain string against company hints
function subdomainMatchesHints(sub, hints) {
  const normalized = sub.toLowerCase().replace(/[-_]/g, '');
  return hints.some(h => normalized.includes(h.toLowerCase().replace(/[-_]/g, '')));
}

// Extract all SF subdomains found anywhere in a text string
function extractSFSubdomains(text) {
  const subs = new Set();
  const re = new RegExp(SF_DOMAIN_RE.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    subs.add(m[1].toLowerCase().replace(/[-_]/g, ''));
  }
  return [...subs];
}

async function searchSerper(query) {
  const res = await axios.post(
    SERPER_URL,
    { q: query, num: 10 },
    { headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: SERPER_TIMEOUT }
  );
  return res.data?.organic || [];
}

// Probe the SF tenant API — tries both common param shapes
async function probeSFTenant(subdomain) {
  // SF exposes the career API on both domain patterns
  const bases = [
    `https://${subdomain}.jobs.ondemand.com/api/jobs/v1/jobs`,
    `https://${subdomain}.successfactors.com/api/jobs/v1/jobs`,
  ];
  const paramSets = [
    { pageSize: 1, page: 1 },
    { pageSize: 1, pageNo: 1 },
    { pageSize: 1, page: 0 },
  ];

  for (const base of bases) {
    for (const params of paramSets) {
      try {
        const res = await axios.get(base, {
          params,
          headers: { Accept: 'application/json' },
          timeout: PROBE_TIMEOUT
        });
        const jobs = res.data?.jobs ?? res.data?.reqList ?? [];
        const total =
          res.data?.totalCount ??
          res.data?.total ??
          res.data?.count ??
          (Array.isArray(jobs) ? jobs.length : 0);
        if (Number(total) > 0) return { ok: true, total: Number(total), base };
      } catch { /* try next */ }
    }
  }
  return { ok: false, total: 0 };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findCandidateSubdomains(company) {
  const candidates = new Set();

  // ── Strategy 1: Serper — search for SF URL patterns mentioning the company ─
  // No site: restriction — we look for SF domain strings in snippets and links
  const queries = [
    `"${company.name}" "jobs.ondemand.com"`,
    `"${company.name}" successfactors careers`,
  ];

  for (const q of queries) {
    try {
      const results = await searchSerper(q);
      for (const r of results) {
        const texts = [r.link || '', r.snippet || '', r.title || ''];
        for (const text of texts) {
          for (const sub of extractSFSubdomains(text)) {
            if (subdomainMatchesHints(sub, company.hints)) candidates.add(sub);
          }
        }
      }
      await sleep(200);
    } catch { /* one query failing shouldn't abort */ }
  }

  // ── Strategy 2: Direct probe of likely subdomain variants ─────────────────
  // Real SF subdomains often have suffixes: prod, ext, rpo, ltd, global, careers
  if (candidates.size === 0) {
    for (const hint of company.hints) {
      const base = hint.replace(/[-_]/g, '').toLowerCase();
      candidates.add(base);
      candidates.add(`${base}prod`);
      candidates.add(`${base}-prod`);
      candidates.add(`${base}ext`);
      candidates.add(`${base}-ext`);
      candidates.add(`${base}rpo`);
      candidates.add(`${base}ltd`);
      candidates.add(`${base}global`);
      candidates.add(`${base}careers`);
      candidates.add(`${base}talent`);
    }
  }

  return [...candidates];
}

async function run() {
  if (!process.env.SERPER_API_KEY) {
    console.error('SERPER_API_KEY not set in .env');
    process.exit(1);
  }

  console.log(`\n[PROBE] Searching ${COMPANIES.length} companies for SuccessFactors boards...\n`);

  const confirmed = [];
  const notOnSF   = [];

  for (const c of COMPANIES) {
    let found = null;

    try {
      const subdomains = await findCandidateSubdomains(c);

      for (const sub of subdomains) {
        const result = await probeSFTenant(sub);
        if (result.ok) {
          found = { subdomain: sub, total: result.total };
          break;
        }
      }
    } catch (err) {
      console.log(`  ⚠️  ${c.name.padEnd(28)} Error: ${err.message}`);
      await sleep(1000);
      continue;
    }

    if (found) {
      console.log(`  ✅ ${c.name.padEnd(28)} ${found.subdomain}.jobs.ondemand.com | jobs: ${found.total}`);
      confirmed.push({ company: c.name, subdomain: found.subdomain, total: found.total });
    } else {
      notOnSF.push(c.name);
      console.log(`  ❌ ${c.name}`);
    }

    await sleep(400);
  }

  console.log('\n\n══════════════════════════════════════════════════════════');
  console.log('  Paste these into CURATED_SF_TENANTS in');
  console.log('  server/services/successFactorsService.js');
  console.log('══════════════════════════════════════════════════════════\n');

  for (const c of confirmed) {
    console.log(`  { subdomain: '${c.subdomain}', companyName: '${c.company}' },  // ${c.total} total jobs`);
  }

  if (notOnSF.length) {
    console.log(`\n  Not on SuccessFactors (try Taleo/iCIMS/custom portal): ${notOnSF.join(', ')}`);
  }

  console.log(`\n[PROBE] Done — ${confirmed.length}/${COMPANIES.length} confirmed\n`);
}

run().catch(err => {
  console.error('[PROBE] Fatal:', err.message);
  process.exit(1);
});
