const axios = require('axios');
const Company = require('../models/Company');
const CareerSource = require('../models/CareerSource');
const normalizeCompanyName = require('../utils/normalizeCompanyName');
const getCoords = require('../utils/geocode');

const { isIndianLocation } = require('../utils/indiaLocation');

const CONCURRENCY = 12;
const REQUEST_TIMEOUT = 12000;

// Sitemap-discovery samples a few jobs per company to decide if they hire in
// India. Treat "remote" as India-eligible since we'd rather scan a board that
// might have India jobs than miss companies due to ambiguous location strings.
const isIndiaLocation = (str) =>
  isIndianLocation(str, { hasIndianPresence: true });

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

  for (const query of queries) {
    try {
      const res = await axios.get('https://api.github.com/search/code', {
        params: { q: query, per_page: 100 },
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.text-match+json',
          'User-Agent': 'job-map-india-discovery'
        },
        timeout: 15000
      });

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

      // GitHub code search rate limit: 30 req/min authenticated
      await new Promise(r => setTimeout(r, 2100));
    } catch (e) {
      console.log(`  GitHub search query failed: ${e.message}`);
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

module.exports = { discoverGreenhouse, discoverLever, discoverAshby, discoverSmartRecruiters };
