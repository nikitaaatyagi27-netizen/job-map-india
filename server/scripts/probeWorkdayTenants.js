// Probe Workday tenants by searching for each company's real myworkdayjobs.com
// URL via Serper, then validating the subdomain matches the company, then
// probing the CXS API to confirm the board is live.
//
// Run: node server/scripts/probeWorkdayTenants.js
// Requires SERPER_API_KEY in server/.env

require('dotenv').config();
const axios = require('axios');

const SERPER_URL    = 'https://google.serper.dev/search';
const PROBE_TIMEOUT = 10000;
const SERPER_TIMEOUT = 15000;

// hints[] = substrings that must appear in the Workday host's subdomain.
// This prevents a Zillow job (that mentions ServiceNow) being returned as
// ServiceNow's Workday board.
const COMPANIES = [
  // ── Global tech ──────────────────────────────────────────────────────────
  { name: 'ServiceNow',          hints: ['servicenow'] },
  { name: 'Capgemini',           hints: ['capgemini'] },
  { name: 'Ericsson',            hints: ['ericsson'] },
  { name: 'Siemens',             hints: ['siemens'] },
  { name: 'Informatica',         hints: ['informatica'] },
  { name: 'Akamai',              hints: ['akamai'] },
  { name: 'Juniper Networks',    hints: ['juniper'] },
  { name: 'HPE',                 hints: ['hpe'] },
  { name: 'VMware',              hints: ['vmware', 'broadcom'] },   // broadcom acquired vmware
  { name: 'NetApp',              hints: ['netapp'] },
  { name: 'Zebra Technologies',  hints: ['zebra'] },
  { name: 'Honeywell',           hints: ['honeywell'] },
  { name: 'GE Digital',          hints: ['ge', 'geaerospace', 'gehealthcare', 'gevernova'] },
  { name: 'Cummins',             hints: ['cummins'] },
  { name: 'Micron Technology',   hints: ['micron'] },
  { name: 'Bentley Systems',     hints: ['bentley'] },
  { name: 'Synopsys',            hints: ['synopsys'] },
  { name: 'Cadence',             hints: ['cadence'] },
  { name: 'Ansys',               hints: ['ansys'] },
  { name: 'Rockwell Automation', hints: ['rockwell'] },
  { name: 'Trimble',             hints: ['trimble'] },
  // ── Banking / Finance ─────────────────────────────────────────────────────
  { name: 'Visa',                hints: ['visa'] },
  { name: 'JPMorgan Chase',      hints: ['jpmorgan', 'jpmc'] },
  { name: 'Goldman Sachs',       hints: ['goldman', 'gs'] },
  { name: 'Barclays',            hints: ['barclays'] },
  { name: 'HSBC',                hints: ['hsbc'] },
  { name: 'Citi',                hints: ['citi'] },
  { name: 'Deutsche Bank',       hints: ['deutsche', 'db'] },
  { name: 'Standard Chartered',  hints: ['standardchartered', 'scb'] },
  { name: 'American Express',    hints: ['amex', 'americanexpress', 'aexp'] },
  { name: 'Fiserv',              hints: ['fiserv'] },
  { name: 'FIS Global',          hints: ['fis'] },
  { name: 'Refinitiv',           hints: ['refinitiv', 'lseg'] },    // lseg acquired refinitiv
  { name: 'Morningstar',         hints: ['morningstar'] },
  // ── Indian / India-heavy companies ────────────────────────────────────────
  { name: 'Cognizant',           hints: ['cognizant'] },
  { name: 'Mphasis',             hints: ['mphasis'] },
  { name: 'LTIMindtree',         hints: ['lti', 'mindtree', 'ltimindtree'] },
  { name: 'Persistent Systems',  hints: ['persistent'] },
  { name: 'Cyient',              hints: ['cyient'] },
  { name: 'Tata Communications', hints: ['tata'] },
  { name: 'Hexaware',            hints: ['hexaware'] },
  { name: 'Nagarro',             hints: ['nagarro'] },
  { name: 'Birlasoft',           hints: ['birlasoft'] },
  { name: 'Zensar Technologies', hints: ['zensar'] },
];

// Returns true when the Workday host's subdomain contains at least one hint
function subdomainMatchesHints(host, hints) {
  const sub = host.split('.')[0].toLowerCase().replace(/[-_]/g, '');
  return hints.some(h => sub.includes(h.toLowerCase().replace(/[-_]/g, '')));
}

// Extract *.myworkdayjobs.com URLs from Serper organic results
function extractWorkdayUrls(results) {
  const urls = new Set();
  for (const r of results) {
    for (const text of [r.link || '', r.snippet || '']) {
      const matches = text.match(/https?:\/\/[a-z0-9-]+\.(?:wd\d+|myworkday)\.myworkdayjobs\.com[^\s"')>]*/gi) || [];
      for (const m of matches) urls.add(m.split('?')[0]);  // strip query params
      // Also catch bare hostnames mentioned in text
      const hostMatches = text.match(/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/gi) || [];
      for (const h of hostMatches) urls.add(`https://${h.toLowerCase()}`);
    }
  }
  return [...urls];
}

// Parse a myworkdayjobs.com URL → { host, tenant, site, locale }
function parseWorkdayUrl(url) {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (!parsed.hostname.endsWith('.myworkdayjobs.com')) return null;
    const parts   = parsed.pathname.split('/').filter(Boolean);
    const localeRe = /^[a-z]{2}-[A-Z]{2}$/;
    const locale  = localeRe.test(parts[0]) ? parts[0] : 'en-US';
    const site    = localeRe.test(parts[0]) ? parts[1] : parts[0];
    if (!site) return null;
    const tenant  = parsed.hostname.split('.')[0];
    return { host: parsed.origin, tenant, site, locale };
  } catch { return null; }
}

async function searchSerper(query) {
  const res = await axios.post(
    SERPER_URL,
    { q: query, num: 10 },
    { headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: SERPER_TIMEOUT }
  );
  return res.data?.organic || [];
}

async function probeCXS(host, tenant, site) {
  const url = `${host}/wday/cxs/${tenant}/${site}/jobs`;
  try {
    const res = await axios.post(
      url,
      { appliedFacets: {}, limit: 1, offset: 0, searchText: '' },
      { headers: { 'Content-Type': 'application/json' }, timeout: PROBE_TIMEOUT }
    );
    const total = res.data?.total ?? 0;
    return { ok: total > 0, total };
  } catch { return { ok: false, total: 0 }; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  if (!process.env.SERPER_API_KEY) {
    console.error('SERPER_API_KEY not set in .env');
    process.exit(1);
  }

  console.log(`\n[PROBE] Searching ${COMPANIES.length} companies...\n`);

  const confirmed  = [];
  const notOnWorkday = [];

  for (const c of COMPANIES) {
    // Query without site: operator — returns the company's actual Workday page
    const query = `"${c.name}" myworkdayjobs.com careers`;
    let found = null;

    try {
      const results = await searchSerper(query);

      const urls = extractWorkdayUrls(results);
      const configs = urls
        .map(url => parseWorkdayUrl(url))
        .filter(cfg => cfg && subdomainMatchesHints(cfg.host, c.hints));

      for (const cfg of configs) {
        const result = await probeCXS(cfg.host, cfg.tenant, cfg.site);
        if (result.ok) {
          found = { ...cfg, total: result.total };
          break;
        }
      }
    } catch (err) {
      console.log(`  ⚠️  ${c.name.padEnd(28)} Serper error: ${err.message}`);
      await sleep(1000);
      continue;
    }

    if (found) {
      const hostShort = found.host.replace('https://', '');
      console.log(`  ✅ ${c.name.padEnd(28)} ${hostShort} | site=${found.site} | jobs: ${found.total}`);
      confirmed.push({ company: c.name, host: hostShort, site: found.site, locale: found.locale, total: found.total });
    } else {
      notOnWorkday.push(c.name);
      console.log(`  ❌ ${c.name}`);
    }

    await sleep(300);
  }

  console.log('\n\n══════════════════════════════════════════════════════════');
  console.log('  Paste these into CURATED_WORKDAY_TENANTS in');
  console.log('  server/services/workdayDiscoveryService.js');
  console.log('══════════════════════════════════════════════════════════\n');

  for (const c of confirmed) {
    console.log(`  { host: '${c.host}', site: '${c.site}', locale: '${c.locale}' },  // ${c.company} (${c.total} jobs)`);
  }

  if (notOnWorkday.length) {
    console.log(`\n  Not on Workday (use Greenhouse/Lever/manual): ${notOnWorkday.join(', ')}`);
  }

  console.log(`\n[PROBE] Done — ${confirmed.length}/${COMPANIES.length} confirmed\n`);
}

run().catch(err => {
  console.error('[PROBE] Fatal:', err.message);
  process.exit(1);
});
