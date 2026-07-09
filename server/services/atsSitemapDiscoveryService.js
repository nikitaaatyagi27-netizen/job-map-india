const axios = require('axios');
const Company = require('../models/Company');
const CareerSource = require('../models/CareerSource');
const normalizeCompanyName = require('../utils/normalizeCompanyName');
const getCoords = require('../utils/geocode');

const { isIndianLocation } = require('../utils/indiaLocation');

const CONCURRENCY = 12;
const REQUEST_TIMEOUT = 12000;

// Discovery decides whether to REGISTER a whole company based on its jobs, so it
// must require an EXPLICIT Indian location (a city/state/region or the word
// "india") — NOT ambiguous keywords like "remote"/"global"/"anywhere". Otherwise
// US companies posting remote roles get registered with inflated fake "India job"
// counts (e.g. a US AI startup's "Remote - US" roles counted as India), polluting
// the India map. requireExplicit:true also rejects empty/missing locations.
const isIndiaLocation = (str) =>
  isIndianLocation(str, { hasIndianPresence: false, requireExplicit: true });

function slugToName(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

async function runConcurrent(tasks, concurrency) {
  let i = 0;
  const results = new Array(tasks.length).fill(null);
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); } catch { results[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ─── GitHub: mine ATS board slugs from public code search ────────────────────

// existingSlugs: Set of slugs already registered in CareerSource — mined slugs
// that match are skipped immediately without hitting the ATS verification endpoint.
async function mineSlugsByGitHub(atsHost, queries, existingSlugs = new Set()) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN missing');

  const slugSet = new Set();
  const escapedHost = atsHost.replace(/\./g, '\\.');

  // GitHub CODE search has a special low limit of 10 requests/minute (much lower
  // than the 30/min for other search endpoints). Exceeding it returns HTTP 403
  // ("rate limit exceeded"), not 429. Pace requests to ~8.5/min (7s apart) to
  // stay safely under, and honor the rate-limit headers when GitHub signals it's
  // out — waiting for the reset instead of hammering into a wall of 403s.
  const GH_SEARCH_INTERVAL_MS = Number(process.env.GH_SEARCH_INTERVAL_MS || 7000);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  for (const query of queries) {
    try {
      const res = await axios.get('https://api.github.com/search/code', {
        params: { q: query, per_page: 100 },
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.text-match+json',
          'User-Agent': 'job-map-india-discovery'
        },
        timeout: 15000,
        validateStatus: () => true
      });

      // Rate-limit exhausted (403/429 with remaining 0): wait for the reset.
      const remaining = Number(res.headers['x-ratelimit-remaining']);
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers['x-ratelimit-reset']);
        const waitMs = reset ? Math.max(reset * 1000 - Date.now(), 0) + 1000 : 60000;
        console.log(`  GitHub code search throttled (HTTP ${res.status}) — waiting ${Math.ceil(waitMs / 1000)}s for reset`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 400) {
        console.log(`  GitHub search query failed: HTTP ${res.status} ${res.data?.message || ''}`);
        await sleep(GH_SEARCH_INTERVAL_MS);
        continue;
      }

      const items = res.data?.items || [];
      for (const item of items) {
        // Collect all text fragments: the file URL + every text-match snippet
        const sources = [item.html_url || ''];
        for (const match of item.text_matches || []) {
          sources.push(match.fragment || '');
        }
        for (const text of sources) {
          const re = new RegExp(`${escapedHost}/([a-z0-9][a-z0-9-]{0,50})`, 'gi');
          let m;
          while ((m = re.exec(text)) !== null) {
            const slug = m[1].toLowerCase();
            // Skip slugs we already have registered — no need to verify them again
            if (slug.length >= 2 && !existingSlugs.has(slug)) slugSet.add(slug);
          }
        }
      }

      // If we're about to run out, pre-emptively wait for the window reset.
      if (Number.isFinite(remaining) && remaining <= 1) {
        const reset = Number(res.headers['x-ratelimit-reset']);
        const waitMs = reset ? Math.max(reset * 1000 - Date.now(), 0) + 1000 : 60000;
        console.log(`  GitHub code search budget low (remaining ${remaining}) — waiting ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
      } else {
        await sleep(GH_SEARCH_INTERVAL_MS);
      }
    } catch (e) {
      console.log(`  GitHub search query failed: ${e.message}`);
      await sleep(GH_SEARCH_INTERVAL_MS);
    }
  }

  return Array.from(slugSet);
}

// ─── Register company + career source ────────────────────────────────────────

async function registerATSBoard({ slug, companyName, provider, boardUrl }) {
  const normalizedName = normalizeCompanyName(companyName || slugToName(slug));
  if (!normalizedName || normalizedName.length < 2) return null;

  let company = await Company.findOne({ name: normalizedName });
  if (!company) {
    const coords = await getCoords('India');
    company = await Company.create({
      name: normalizedName,
      logo: null,
      domain: null,
      website: null,
      careersUrl: boardUrl,
      careersProvider: provider,
      discoverySources: ['ats-discovery'],
      intelligenceStatus: 'direct-source-linked',
      source: 'ats-discovery',
      coords,
      lastIntelligenceAt: new Date()
    });
  } else if (!company.careersProvider) {
    company.careersProvider = provider;
    company.careersUrl = company.careersUrl || boardUrl;
    await company.save();
  }

  const existing = await CareerSource.findOne({ company: company._id, provider, boardUrl });
  if (!existing) {
    await CareerSource.create({
      company: company._id,
      companyName: normalizedName,
      provider,
      boardUrl,
      discoveryMethod: 'ats-discovery',
      status: 'active'
    });
  }

  return normalizedName;
}

// ─── GREENHOUSE ───────────────────────────────────────────────────────────────

const GREENHOUSE_QUERIES = [
  // Direct ATS URL mentions in code
  '"boards.greenhouse.io" india',
  '"boards.greenhouse.io" bangalore',
  '"boards.greenhouse.io" hyderabad',
  '"boards.greenhouse.io" india developer',
  '"boards.greenhouse.io" india engineer',
  '"boards.greenhouse.io" india hiring',
  '"boards.greenhouse.io" india startup',
  '"boards.greenhouse.io" india fintech',
  // Additional Indian cities not covered above
  '"boards.greenhouse.io" pune',
  '"boards.greenhouse.io" chennai',
  '"boards.greenhouse.io" noida',
  '"boards.greenhouse.io" gurugram',
  '"boards.greenhouse.io" gurgaon',
  '"boards.greenhouse.io" mumbai',
  '"boards.greenhouse.io" delhi',
  '"boards.greenhouse.io" kolkata',
  '"boards.greenhouse.io" ahmedabad',
  // Role-specific India queries
  '"boards.greenhouse.io" india "machine learning"',
  '"boards.greenhouse.io" india "data scientist"',
  '"boards.greenhouse.io" india "product manager"',
  // Category-targeted India queries — fintech / AI / SaaS (the segments with the
  // most modern-ATS Indian startups; broadens the slug space beyond city queries).
  '"boards.greenhouse.io" india fintech payments',
  '"boards.greenhouse.io" india "neobank" OR "lending" OR "wealth"',
  '"boards.greenhouse.io" india "artificial intelligence" OR "generative ai"',
  '"boards.greenhouse.io" india "ML engineer" OR "applied scientist"',
  '"boards.greenhouse.io" india saas "developer tools"',
  '"boards.greenhouse.io" india "api platform" OR "devtools" OR "b2b saas"',
  // robots.txt — companies reference their job board in Disallow or comment blocks
  'filename:robots.txt "boards.greenhouse.io"',
  'filename:robots.txt "greenhouse.io"',
  // sitemap.xml — career page URLs embedded in sitemaps
  'filename:sitemap.xml "boards.greenhouse.io"',
  // LinkedIn profile pages that embed Greenhouse board URLs in their page source
  '"boards.greenhouse.io" "linkedin.com/company"',
  '"greenhouse.io" "linkedin" india careers',
];

async function checkGreenhouseForIndia(slug) {
  try {
    const res = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
      { timeout: REQUEST_TIMEOUT }
    );
    const jobs = res.data?.jobs || [];
    const indiaJobs = jobs.filter(j => isIndiaLocation(j.location?.name));
    if (indiaJobs.length === 0) return null;
    return {
      slug,
      companyName: jobs[0]?.company_name || slugToName(slug),
      indiaJobCount: indiaJobs.length
    };
  } catch { return null; }
}

async function discoverGreenhouse() {
  console.log('\n[GREENHOUSE] Mining company slugs via GitHub search...');

  // Build existingSlugs BEFORE mining so mineSlugsByGitHub can skip them inline
  const existing = await CareerSource.find({ provider: 'greenhouse' }).select('boardUrl').lean();
  const existingSlugs = new Set(existing.map(s => {
    try { return new URL(s.boardUrl).pathname.split('/').filter(Boolean)[0]; } catch { return ''; }
  }));

  const slugs = await mineSlugsByGitHub('boards.greenhouse.io', GREENHOUSE_QUERIES, existingSlugs);
  console.log(`[GREENHOUSE] Found ${slugs.length} unique new slugs (${existingSlugs.size} already registered, skipped during mining)`);

  // slugs is already deduplicated against existingSlugs — no second filter needed
  const newSlugs = slugs;

  const tasks = newSlugs.map(slug => () => checkGreenhouseForIndia(slug));
  const results = await runConcurrent(tasks, CONCURRENCY);
  const found = results.filter(Boolean);
  console.log(`[GREENHOUSE] ${found.length} companies confirmed with India jobs`);

  let registered = 0;
  for (const { slug, companyName } of found) {
    const name = await registerATSBoard({
      slug, companyName, provider: 'greenhouse',
      boardUrl: `https://boards.greenhouse.io/${slug}`
    });
    if (name) { registered++; process.stdout.write('.'); }
  }
  console.log(`\n[GREENHOUSE] Registered ${registered} new companies`);
  return registered;
}

// ─── LEVER ────────────────────────────────────────────────────────────────────

const LEVER_QUERIES = [
  '"jobs.lever.co" india software engineer careers',
  '"jobs.lever.co" bangalore developer hiring',
  '"jobs.lever.co" india technology remote jobs',
  '"jobs.lever.co" mumbai hyderabad engineer openings',
  '"jobs.lever.co" india fullstack backend jobs 2024',
  '"jobs.lever.co" india startup fintech hiring',
  '"jobs.lever.co" india data engineer ML scientist',
  '"jobs.lever.co" pune noida india technology',
  '"jobs.lever.co" india SaaS product engineer',
  '"jobs.lever.co" india devops cloud platform jobs',
  // Additional Indian cities
  '"jobs.lever.co" chennai',
  '"jobs.lever.co" gurugram',
  '"jobs.lever.co" gurgaon',
  '"jobs.lever.co" delhi',
  '"jobs.lever.co" kolkata',
  '"jobs.lever.co" ahmedabad',
  '"jobs.lever.co" coimbatore',
  '"jobs.lever.co" kochi',
  // Role-specific India queries
  '"jobs.lever.co" india "product manager"',
  '"jobs.lever.co" india "machine learning"',
  '"jobs.lever.co" india "data scientist"',
  '"jobs.lever.co" india "site reliability"',
  // Category-targeted India queries — fintech / AI / SaaS
  '"jobs.lever.co" india fintech payments neobank',
  '"jobs.lever.co" india "lending" OR "wealth" OR "insurance tech"',
  '"jobs.lever.co" india "artificial intelligence" OR "generative ai"',
  '"jobs.lever.co" india "applied scientist" OR "ML engineer"',
  '"jobs.lever.co" india "b2b saas" OR "developer tools" OR "api platform"',
  // robots.txt and sitemap patterns
  'filename:robots.txt "jobs.lever.co"',
  'filename:sitemap.xml "jobs.lever.co"',
  // LinkedIn embedded references
  '"jobs.lever.co" "linkedin.com/company"',
];

async function checkLeverForIndia(slug) {
  try {
    const res = await axios.get(
      `https://api.lever.co/v0/postings/${slug}?mode=json`,
      { timeout: REQUEST_TIMEOUT }
    );
    const jobs = res.data || [];
    const indiaJobs = jobs.filter(j =>
      isIndiaLocation(j.categories?.location) ||
      isIndiaLocation((j.categories?.allLocations || []).join(' '))
    );
    if (indiaJobs.length === 0) return null;
    return { slug, companyName: slugToName(slug), indiaJobCount: indiaJobs.length };
  } catch { return null; }
}

async function discoverLever() {
  console.log('\n[LEVER] Mining company slugs via GitHub search...');

  const existing = await CareerSource.find({ provider: 'lever' }).select('boardUrl').lean();
  const existingSlugs = new Set(existing.map(s => {
    try { return new URL(s.boardUrl).pathname.split('/').filter(Boolean)[0]; } catch { return ''; }
  }));

  const slugs = await mineSlugsByGitHub('jobs.lever.co', LEVER_QUERIES, existingSlugs);
  console.log(`[LEVER] Found ${slugs.length} unique new slugs (${existingSlugs.size} already registered, skipped during mining)`);

  const newSlugs = slugs;

  const tasks = newSlugs.map(slug => () => checkLeverForIndia(slug));
  const results = await runConcurrent(tasks, CONCURRENCY);
  const found = results.filter(Boolean);
  console.log(`[LEVER] ${found.length} companies confirmed with India jobs`);

  let registered = 0;
  for (const { slug, companyName } of found) {
    const name = await registerATSBoard({
      slug, companyName, provider: 'lever',
      boardUrl: `https://jobs.lever.co/${slug}`
    });
    if (name) { registered++; process.stdout.write('.'); }
  }
  console.log(`\n[LEVER] Registered ${registered} new companies`);
  return registered;
}

// ─── ASHBY ────────────────────────────────────────────────────────────────────

const ASHBY_QUERIES = [
  '"jobs.ashbyhq.com" india software engineer jobs',
  '"jobs.ashbyhq.com" bangalore developer careers',
  '"jobs.ashbyhq.com" india technology remote hiring',
  '"jobs.ashbyhq.com" india startup engineering jobs',
  '"jobs.ashbyhq.com" india backend fullstack engineer',
  '"jobs.ashbyhq.com" mumbai hyderabad india jobs',
  // Additional Indian cities
  '"jobs.ashbyhq.com" pune',
  '"jobs.ashbyhq.com" chennai',
  '"jobs.ashbyhq.com" noida',
  '"jobs.ashbyhq.com" gurugram',
  '"jobs.ashbyhq.com" delhi',
  '"jobs.ashbyhq.com" kolkata',
  // Role-specific India queries
  '"jobs.ashbyhq.com" india "product manager"',
  '"jobs.ashbyhq.com" india "machine learning"',
  '"jobs.ashbyhq.com" india "data scientist"',
  // Category-targeted India queries — fintech / AI / SaaS (Ashby skews heavily
  // toward AI-native and devtools startups, so these are especially productive).
  '"jobs.ashbyhq.com" india fintech payments neobank',
  '"jobs.ashbyhq.com" india "lending" OR "wealth" OR "insurtech"',
  '"jobs.ashbyhq.com" india "artificial intelligence" OR "generative ai" OR "LLM"',
  '"jobs.ashbyhq.com" india "applied scientist" OR "ML engineer" OR "research engineer"',
  '"jobs.ashbyhq.com" india "b2b saas" OR "developer tools" OR "api platform"',
  // robots.txt and sitemap patterns
  'filename:robots.txt "jobs.ashbyhq.com"',
  'filename:sitemap.xml "jobs.ashbyhq.com"',
  // LinkedIn embedded references
  '"jobs.ashbyhq.com" "linkedin.com/company"',
];

async function checkAshbyForIndia(slug) {
  try {
    const res = await axios.get(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      { timeout: REQUEST_TIMEOUT }
    );
    const jobs = res.data?.jobs || res.data?.jobPostings || [];
    const indiaJobs = jobs.filter(j =>
      isIndiaLocation(j.location) ||
      isIndiaLocation(j.locationName) ||
      isIndiaLocation(j.address?.postalAddress?.addressCountry) ||
      (j.secondaryLocations || []).some(sl => isIndiaLocation(sl.location))
    );
    if (indiaJobs.length === 0) return null;
    return {
      slug,
      companyName: res.data?.organization?.name || slugToName(slug),
      indiaJobCount: indiaJobs.length
    };
  } catch { return null; }
}

async function discoverAshby() {
  console.log('\n[ASHBY] Mining company slugs via GitHub search...');

  const existing = await CareerSource.find({ provider: 'ashby' }).select('boardUrl').lean();
  const existingSlugs = new Set(existing.map(s => {
    try { return new URL(s.boardUrl).pathname.split('/').filter(Boolean)[0]; } catch { return ''; }
  }));

  const slugs = await mineSlugsByGitHub('jobs.ashbyhq.com', ASHBY_QUERIES, existingSlugs);
  console.log(`[ASHBY] Found ${slugs.length} unique new slugs (${existingSlugs.size} already registered, skipped during mining)`);

  const newSlugs = slugs;

  const tasks = newSlugs.map(slug => () => checkAshbyForIndia(slug));
  const results = await runConcurrent(tasks, CONCURRENCY);
  const found = results.filter(Boolean);
  console.log(`[ASHBY] ${found.length} companies confirmed with India jobs`);

  let registered = 0;
  for (const { slug, companyName } of found) {
    const name = await registerATSBoard({
      slug, companyName, provider: 'ashby',
      boardUrl: `https://jobs.ashbyhq.com/${slug}`
    });
    if (name) { registered++; process.stdout.write('.'); }
  }
  console.log(`\n[ASHBY] Registered ${registered} new companies`);
  return registered;
}

// ─── SMARTRECRUITERS ──────────────────────────────────────────────────────────
// SmartRecruiters publishes a public sitemap at careers.smartrecruiters.com/sitemap.xml
// that lists every company using their platform — no GitHub token needed.

async function fetchSmartRecruitersSitemap() {
  const res = await axios.get('https://careers.smartrecruiters.com/sitemap.xml', {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)' }
  });
  // Extract all slugs from URLs like https://careers.smartrecruiters.com/CompanySlug
  const slugSet = new Set();
  const re = /https:\/\/careers\.smartrecruiters\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,80})(?:\/|<|\s)/g;
  let m;
  while ((m = re.exec(res.data)) !== null) {
    const slug = m[1];
    // Skip generic sitemap pages
    if (!slug || slug.toLowerCase() === 'sitemap' || slug.includes('.xml')) continue;
    slugSet.add(slug);
  }
  return Array.from(slugSet);
}

async function checkSmartRecruitersForIndia(slug) {
  try {
    const res = await axios.get(
      `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
      { params: { country: 'IN', limit: 10 }, timeout: REQUEST_TIMEOUT }
    );
    const jobs = res.data?.content || [];
    if (jobs.length === 0) return null;
    const companyName = jobs[0]?.company?.name || slugToName(slug);
    return { slug, companyName, indiaJobCount: jobs.length };
  } catch { return null; }
}

async function discoverSmartRecruiters() {
  console.log('\n[SMARTRECRUITERS] Fetching public sitemap...');

  const existing = await CareerSource.find({ provider: 'smartrecruiters' }).select('boardUrl').lean();
  const existingSlugs = new Set(existing.map(s => {
    try { return new URL(s.boardUrl).pathname.split('/').filter(Boolean)[0]?.toLowerCase(); } catch { return ''; }
  }));

  let allSlugs;
  try {
    allSlugs = await fetchSmartRecruitersSitemap();
  } catch (e) {
    console.log(`[SMARTRECRUITERS] Sitemap fetch failed: ${e.message}`);
    return 0;
  }

  const newSlugs = allSlugs.filter(s => !existingSlugs.has(s.toLowerCase()));
  console.log(`[SMARTRECRUITERS] ${allSlugs.length} total slugs | ${existingSlugs.size} already registered | ${newSlugs.length} to check`);

  const tasks = newSlugs.map(slug => () => checkSmartRecruitersForIndia(slug));
  const results = await runConcurrent(tasks, CONCURRENCY);
  const found = results.filter(Boolean);
  console.log(`[SMARTRECRUITERS] ${found.length} companies confirmed with India jobs`);

  let registered = 0;
  for (const { slug, companyName } of found) {
    const name = await registerATSBoard({
      slug,
      companyName,
      provider: 'smartrecruiters',
      boardUrl: `https://careers.smartrecruiters.com/${slug}`
    });
    if (name) { registered++; process.stdout.write('.'); }
  }
  console.log(`\n[SMARTRECRUITERS] Registered ${registered} new companies`);
  return registered;
}

module.exports = {
  discoverGreenhouse, discoverLever, discoverAshby, discoverSmartRecruiters,
  // Exported for dry-run probing (scripts/probeAtsDiscovery.js) — mine + verify
  // India jobs without writing anything to the DB.
  mineSlugsByGitHub, checkGreenhouseForIndia, checkLeverForIndia, checkAshbyForIndia,
  GREENHOUSE_QUERIES, LEVER_QUERIES, ASHBY_QUERIES, runConcurrent, CONCURRENCY
};
