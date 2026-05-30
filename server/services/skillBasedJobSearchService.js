const axios = require('axios');
const Company = require('../models/Company');
const Job = require('../models/Job');
const { upsertIngestedJob } = require('../utils/jobPersistence');
const { classifyExperienceLevel } = require('../utils/experienceLevelClassifier');
const getCoords = require('../utils/geocode');
const normalizeCompanyName = require('../utils/normalizeCompanyName');
const { isGarbageCompanyName } = require('../utils/companyNameValidator');
const {
  extractIndianCityCoords,
  spreadCoordsForCompany,
  isIndiaCenter,
  isIndianLocation
} = require('../utils/indiaLocation');
const resolveLogo = require('../utils/logoResolver');
const { getCachedResults, setCachedResults } = require('./searchCacheService');

const JSEARCH_URL = 'https://jsearch.p.rapidapi.com/search';

const isIndia = (str) => isIndianLocation(str, { hasIndianPresence: true });

const INDIA_CITIES = ['Bangalore', 'Hyderabad', 'Pune', 'Noida', 'Gurgaon', 'Mumbai', 'Chennai'];

const ATS_META = {
  greenhouse:      { label: 'Greenhouse',       hint: 'Structured hiring, ~2–4 weeks' },
  lever:           { label: 'Lever',             hint: 'Fast decisions, ~1–2 weeks' },
  ashby:           { label: 'Ashby',             hint: 'Startup speed, often < 2 weeks' },
  smartrecruiters: { label: 'SmartRecruiters',   hint: 'Enterprise, ~3–5 weeks' },
  workday:         { label: 'Workday',           hint: 'Enterprise, ~4–6 weeks' },
  taleo:           { label: 'Taleo',             hint: 'Legacy enterprise, ~4–8 weeks' },
  successfactors:  { label: 'SAP SuccessFactors', hint: 'Enterprise, ~4–6 weeks' },
};

// ─── Query builder ────────────────────────────────────────────────────────────

function buildQueries(skills, roles) {
  const queries = new Set();
  const topSkills = skills.slice(0, 6);
  const topRoles  = roles.slice(0, 3);

  for (const role of topRoles) {
    queries.add(`${role} India`);
    queries.add(`${role} fresher India`);
  }

  if (topSkills.length >= 2) {
    queries.add(`${topSkills[0]} ${topSkills[1]} developer India`);
    queries.add(`${topSkills[0]} ${topSkills[1]} jobs India`);
  }
  if (topSkills.length >= 1) {
    queries.add(`${topSkills[0]} developer jobs India`);
    queries.add(`${topSkills[0]} software engineer India`);
  }
  if (topSkills.length >= 3) {
    queries.add(`${topSkills[2]} developer India`);
    queries.add(`${topSkills[0]} ${topSkills[2]} India`);
  }

  for (const city of INDIA_CITIES) {
    if (topSkills.length >= 1) queries.add(`${topSkills[0]} developer ${city}`);
    if (topRoles.length >= 1)  queries.add(`${topRoles[0]} ${city}`);
  }

  queries.add(`fresher software developer India`);
  queries.add(`junior developer India`);

  return Array.from(queries).slice(0, 1);
}

// ─── Relevance scoring ────────────────────────────────────────────────────────

function scoreJob(title, location, source, primarySkills, suggestedRoles, domain) {
  let score = 0;
  const t = (title || '').toLowerCase();
  const sourceQuality = {
    greenhouse: 90, lever: 90, ashby: 90, smartrecruiters: 88,
    workday: 95, naukri: 75, jsearch: 70, adzuna: 68
  };

  score += (sourceQuality[source] || 60);

  for (const role of suggestedRoles) {
    const roleLower = role.toLowerCase().replace(/[()]/g, '').trim();
    if (t.includes(roleLower)) { score += 40; break; }
    const tokens = extractRoleTokens(role).filter(tok => tok.length > 3);
    if (tokens.length > 0 && tokens.some(tok => t.includes(tok))) { score += 25; break; }
  }

  const primaryLower = primarySkills.map(s => s.toLowerCase().replace(/\./g, ''));
  const skillHits = primaryLower.filter(s => s.length > 3 && t.includes(s)).length;
  score += skillHits * 15;

  if (['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters'].includes(source)) {
    score += 20;
  }

  return score;
}

// ─── Concurrency helper ───────────────────────────────────────────────────────

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        const value = await worker(items[index], index);
        if (value) results.push(value);
      } catch { /* swallow per-item errors */ }
    }
  });
  await Promise.all(runners);
  return results;
}

// ─── Title matching helpers ───────────────────────────────────────────────────

function matchesSkills(text, skillsLower) {
  if (skillsLower.length === 0) return true;
  const lower = (text || '').toLowerCase();
  return skillsLower.some(s => s && lower.includes(s));
}

const GENERIC_DOMAINS = new Set(['fullstack', 'web', 'backend', 'other']);

const IRRELEVANT_TITLES = [
  'officer','director','vp ','vice president','head of','chief','cto','ceo','coo',
  'principal officer','country head','managing director','general manager',
  'business development','sales','marketing','finance','accounting','legal',
  'hr ','human resources','recruiter','talent acquisition',
  'strategy','consulting partner','account manager','account executive',
  'presales','pre-sales','value consultant','engagement manager',
  'technical writer','customer success','it support','helpdesk','help desk'
];

const GENERIC_ROLE_WORDS = new Set([
  'developer','engineer','designer','analyst','architect','manager','lead',
  'senior','junior','intern','associate','specialist','consultant','head',
  'officer','director','vp','chief','principal','staff','mid','entry','level',
  'focus','role','position','job','opening','opportunity','and','the','for',
  'with','based','remote','hybrid','onsite','india','bangalore','mumbai',
  'software','application','solutions','systems'
]);

function extractRoleTokens(roleTitle) {
  return roleTitle
    .toLowerCase()
    .replace(/[()\/\-,]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !GENERIC_ROLE_WORDS.has(w));
}

function tokenMatchesTitle(token, titleLower) {
  if (token.length <= 3) {
    return new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(titleLower);
  }
  return titleLower.includes(token);
}

function isTitleRelevant(title, primarySkills, secondarySkills, suggestedRoles, domain) {
  if (!title) return false;
  const t = title.toLowerCase();

  if (IRRELEVANT_TITLES.some(w => t.includes(w))) return false;

  const isSpecialized = domain && !GENERIC_DOMAINS.has(domain);

  for (const role of suggestedRoles) {
    const roleLower = role.toLowerCase().replace(/[()]/g, '').trim();
    if (t.includes(roleLower)) return true;

    const tokens = extractRoleTokens(role);
    if (tokens.length > 0 && tokens.every(tok => tokenMatchesTitle(tok, t))) return true;

    const specific = tokens.filter(tok => tok.length > 3);
    if (specific.length > 0 && specific.some(tok => tokenMatchesTitle(tok, t))) return true;
  }

  const primaryKeywords = primarySkills.map(s => s.toLowerCase().replace(/\./g, ''));
  if (primaryKeywords.some(s => s.length > 3 && t.includes(s))) return true;

  if (!isSpecialized) {
    const secondaryKeywords = secondarySkills.map(s => s.toLowerCase().replace(/\./g, ''));
    if (secondaryKeywords.some(s => s.length > 2 && t.includes(s))) return true;

    const GENERIC_DEV_KEYWORDS = [
      'software engineer', 'software developer', 'software programmer',
      'web developer', 'web engineer',
      'fullstack', 'full stack', 'full-stack',
      'frontend', 'front-end', 'backend', 'back-end',
      'mern', 'mean', 'sde', 'swe',
      'software intern', 'tech intern', 'software trainee', 'software fresher',
      'associate engineer', 'associate developer',
    ];
    return GENERIC_DEV_KEYWORDS.some(k => t.includes(k));
  }

  return false;
}

// ─── JSearch ──────────────────────────────────────────────────────────────────

// Converts JSearch's structured required_experience_in_months to our level enum.
function jsearchExpToLevel(exp) {
  if (!exp) return null;
  if (exp.no_experience_required === true) return 'fresher';
  if (typeof exp.required_experience_in_months !== 'number') return null;
  const months = exp.required_experience_in_months;
  if (months === 0)      return 'fresher';
  if (months <= 12)      return 'fresher'; // 0–1 year — entry level
  if (months <= 60)      return 'mid';     // 1–5 years
  return 'senior';                          // 5+ years
}

// Runs all queries with a concurrency cap of 3 (max 6 active API calls at once).
// Stops issuing new calls immediately when a 429 is received.
async function searchAllJSearch(queries) {
  let rateLimited = false;

  const fetchOne = async (query) => {
    if (rateLimited) return [];

    const fetchPage = async (page) => {
      if (rateLimited) return [];
      try {
        const res = await axios.get(JSEARCH_URL, {
          headers: {
            'X-RapidAPI-Key':   process.env.RAPID_API_KEY,
            'X-RapidAPI-Host':  'jsearch.p.rapidapi.com'
          },
          params: { query, num_pages: 1, page, date_posted: 'month' },
          timeout: 20000
        });
        return res.data?.data || [];
      } catch (err) {
        if (err.response?.status === 429) {
          rateLimited = true;
          console.warn('[JSEARCH] Rate limit hit — halting remaining queries for this search');
        } else {
          console.log(`[JSEARCH ERROR] status=${err.response?.status} — ${err.response?.data?.message || err.message}`);
        }
        return [];
      }
    };

    return fetchPage(1);
  };

  const batches = await mapWithConcurrency(queries, 3, fetchOne);
  return batches.flat();
}

// ─── Direct ATS searches ──────────────────────────────────────────────────────

async function searchGreenhouse(skills) {
  const CareerSource = require('../models/CareerSource');
  const sources = await CareerSource.find({ provider: 'greenhouse', status: 'active' })
    .select('boardUrl companyName').lean();
  const skillsLower = skills.map(s => s.toLowerCase());

  const perBoard = await mapWithConcurrency(sources, 10, async (source) => {
    const slug = new URL(source.boardUrl).pathname.split('/').filter(Boolean)[0];
    if (!slug) return null;
    const res = await axios.get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, { timeout: 10000 });
    const jobs = res.data?.jobs || [];
    const matched = jobs.filter(j => isIndia(j.location?.name) && matchesSkills(`${j.title || ''} ${j.location?.name || ''}`, skillsLower));
    if (matched.length === 0) return null;
    return matched.map(j => ({
      employer_name: source.companyName || slug,
      job_title: j.title,
      job_city: j.location?.name || 'India',
      job_country: 'IN',
      job_apply_link: j.absolute_url,
      employer_logo: null,
      source: 'greenhouse'
    }));
  });

  return perBoard.flat();
}

async function searchLever(skills) {
  const CareerSource = require('../models/CareerSource');
  const sources = await CareerSource.find({ provider: 'lever', status: 'active' })
    .select('boardUrl companyName').lean();
  const skillsLower = skills.map(s => s.toLowerCase());

  const perBoard = await mapWithConcurrency(sources, 10, async (source) => {
    const slug = new URL(source.boardUrl).pathname.split('/').filter(Boolean)[0];
    if (!slug) return null;
    const res = await axios.get(`https://api.lever.co/v0/postings/${slug}`, { timeout: 10000, params: { mode: 'json' } });
    const jobs = Array.isArray(res.data) ? res.data : [];
    const matched = jobs.filter(j => {
      const location = j.categories?.location || '';
      return isIndia(location) && matchesSkills(`${j.text || ''} ${location}`, skillsLower);
    });
    if (matched.length === 0) return null;
    return matched.map(j => ({
      employer_name: source.companyName || slug,
      job_title: j.text,
      job_city: j.categories?.location || 'India',
      job_country: 'IN',
      job_apply_link: j.hostedUrl || j.applyUrl,
      employer_logo: null,
      source: 'lever'
    }));
  });

  return perBoard.flat();
}

async function searchAshby(skills) {
  const CareerSource = require('../models/CareerSource');
  const sources = await CareerSource.find({ provider: 'ashby', status: 'active' })
    .select('boardUrl companyName').lean();
  const skillsLower = skills.map(s => s.toLowerCase());

  const perBoard = await mapWithConcurrency(sources, 10, async (source) => {
    const board = new URL(source.boardUrl).pathname.split('/').filter(Boolean)[0];
    if (!board) return null;
    const res = await axios.get(`https://api.ashbyhq.com/posting-api/job-board/${board}`, { timeout: 10000 });
    const jobs = res.data?.jobs || [];
    const matched = jobs.filter(j => {
      if (j.isListed === false) return false;
      const location = j.location || j.address?.postalAddress?.addressLocality || j.address?.postalAddress?.addressCountry || '';
      return (isIndia(location) || j.isRemote === true) && matchesSkills(`${j.title || ''} ${location}`, skillsLower);
    });
    if (matched.length === 0) return null;
    return matched.map(j => ({
      employer_name: source.companyName || board,
      job_title: j.title,
      job_city: j.location || j.address?.postalAddress?.addressLocality || 'India',
      job_country: 'IN',
      job_apply_link: j.applyUrl || j.jobUrl,
      employer_logo: null,
      source: 'ashby'
    }));
  });

  return perBoard.flat();
}

async function searchSmartRecruiters(skills) {
  const CareerSource = require('../models/CareerSource');
  const sources = await CareerSource.find({ provider: 'smartrecruiters', status: 'active' })
    .select('boardUrl companyName').lean();
  const skillsLower = skills.map(s => s.toLowerCase());

  const perBoard = await mapWithConcurrency(sources, 10, async (source) => {
    const identifier = new URL(source.boardUrl).pathname.split('/').filter(Boolean)[0];
    if (!identifier) return null;
    const res = await axios.get(
      `https://api.smartrecruiters.com/v1/companies/${identifier}/postings`,
      { timeout: 10000, params: { limit: 100 } }
    );
    const jobs = res.data?.content || res.data?.jobs || [];
    const matched = jobs.filter(j => {
      const location = j.location?.fullLocation || j.location?.city || j.location?.region || j.location?.country || '';
      return isIndia(location) && matchesSkills(`${j.name || ''} ${location}`, skillsLower);
    });
    if (matched.length === 0) return null;
    return matched.map(j => ({
      employer_name: j.company?.name || source.companyName || identifier,
      job_title: j.name,
      job_city: j.location?.fullLocation || j.location?.city || 'India',
      job_country: 'IN',
      job_apply_link: j.ref || j.applyUrl || j.jobAdUrl,
      employer_logo: null,
      source: 'smartrecruiters'
    }));
  });

  return perBoard.flat();
}

// ─── DB search ────────────────────────────────────────────────────────────────

async function searchDBJobs(primarySkills, secondarySkills, suggestedRoles, domain) {
  const isSpecialized = domain && !GENERIC_DOMAINS.has(domain);

  const normalizeForRegex = (t) => {
    const stripped = t.replace(/\.(js|ts|jsx|tsx)$/i, '');
    return stripped.length >= 2 ? stripped : t;
  };

  const roleTokens  = suggestedRoles.flatMap(r => extractRoleTokens(r));
  const skillTerms  = isSpecialized
    ? primarySkills.map(s => s.toLowerCase())
    : [...primarySkills, ...secondarySkills].map(s => s.toLowerCase());

  const allTerms    = [...new Set([...roleTokens, ...skillTerms].map(normalizeForRegex))].filter(t => t.length > 2);
  const regexParts  = allTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const titleRegex  = new RegExp(regexParts.join('|'), 'i');

  console.log(`[SKILL SEARCH DB] Terms (${allTerms.length}): ${allTerms.join(', ')}`);

  const SOURCE_FRESHNESS_DAYS = {
    naukri: 5, jsearch: 10, adzuna: 14, arbeitnow: 14, remotive: 14,
    greenhouse: 45, lever: 45, ashby: 45, smartrecruiters: 45,
    workday: 45, taleo: 45, successfactors: 45,
  };
  const DEFAULT_FRESHNESS_DAYS = 21;
  const HARD_AGE_CAP_DAYS      = 45;
  const hardAgeCutoff          = new Date(Date.now() - HARD_AGE_CAP_DAYS * 24 * 60 * 60 * 1000);

  const jobs = await Job.find({
    isActive: true,
    firstSeenAt: { $gte: hardAgeCutoff },
    title: titleRegex
  })
    .populate('company', 'name logo domain lat lng atsProvider hiringVelocity careersProvider')
    .limit(1500)
    .lean();

  console.log(`[SKILL SEARCH DB] Query hit ${jobs.length} jobs (max age: ${HARD_AGE_CAP_DAYS}d)`);

  const results = [];
  for (const job of jobs) {
    if (!job.company || !isTitleRelevant(job.title, primarySkills, secondarySkills, suggestedRoles, domain)) continue;

    const freshDays  = SOURCE_FRESHNESS_DAYS[job.source] ?? DEFAULT_FRESHNESS_DAYS;
    const freshCutoff = new Date(Date.now() - freshDays * 24 * 60 * 60 * 1000);
    const ageDatum   = job.lastSeenAt || job.firstSeenAt;
    if (ageDatum && new Date(ageDatum) < freshCutoff) continue;

    results.push({
      employer_name:    job.company.name,
      job_title:        job.title,
      job_city:         job.location || 'India',
      job_country:      'IN',
      job_apply_link:   job.applyLink,
      employer_logo:    job.company.logo || resolveLogo(job.company),
      source:           job.source || 'db',
      _fromDB:          true,
      _jobId:           job._id,
      _firstSeenAt:     job.firstSeenAt || null,
      _postedDate:      job.postedDate   || null,
      _companyCoords:   { lat: job.company.lat, lng: job.company.lng },
      _companyDomain:   job.company.domain,
      _atsProvider:     job.company.atsProvider || job.company.careersProvider || job.source,
      _hiringVelocity:  job.company.hiringVelocity || null,
      _description:     job.description || null,
      _experienceLevel: job.experienceLevel || null,
      _yearsMin:        job.yearsMin ?? null,
      _yearsMax:        job.yearsMax ?? null,
      _experienceText:  job.experienceText || null,
      _requiredSkills:  job.requiredSkills || [],
      _qualifications:  job.qualifications || [],
      _responsibilityBullets: job.responsibilityBullets || []
    });
  }
  return results;
}

// ─── Coords resolver (extracted from inline closure) ─────────────────────────

async function resolveCompanyCoords(data, normalized) {
  for (const job of data.jobs) {
    if (job._companyCoords?.lat && !isIndiaCenter(job._companyCoords)) return job._companyCoords;
  }
  for (const job of data.jobs) {
    const cityCoords = extractIndianCityCoords(job.location);
    if (cityCoords) return cityCoords;
  }
  for (const job of data.jobs) {
    const geo = await getCoords(job.location);
    if (geo && !isIndiaCenter(geo)) return geo;
  }
  return spreadCoordsForCompany(normalized);
}

// ─── Persist + group ──────────────────────────────────────────────────────────

async function persistAndGroupJobs(rawJobs, primarySkills = [], suggestedRoles = [], secondarySkills = [], domain = 'other') {
  const companyMap = new Map();

  const JOB_BOARD_DOMAINS = ['linkedin.com','naukri.com','indeed.com','glassdoor.com','monster.com','shine.com','foundit.in','timesjobs.com'];
  const isJobBoard = logo => logo && JOB_BOARD_DOMAINS.some(d => logo.includes(d));

  // Build company → jobs map (deduplicate by normalised name)
  for (const job of rawJobs) {
    const companyName = job.employer_name;
    if (!companyName || isGarbageCompanyName(companyName)) continue;
    if (isJobBoard(job.employer_logo)) continue;

    const normalized = normalizeCompanyName(companyName);
    if (!normalized) continue;

    if (!companyMap.has(normalized)) {
      companyMap.set(normalized, {
        employer_name:  companyName,
        employer_logo:  isJobBoard(job.employer_logo) ? null : (job.employer_logo || null),
        jobs:           [],
        source:         job.source || 'jsearch',
        _atsProvider:   job._atsProvider   || null,
        _hiringVelocity: job._hiringVelocity || null
      });
    }

    const entry = companyMap.get(normalized);
    if (job._atsProvider   && !entry._atsProvider)   entry._atsProvider   = job._atsProvider;
    if (job._hiringVelocity && !entry._hiringVelocity) entry._hiringVelocity = job._hiringVelocity;

    entry.jobs.push({
      title:            job.job_title,
      location:         job.job_city || job.job_state || 'India',
      applyLink:        job.job_apply_link,
      description:      job._description    || null,
      source:           job.source          || 'jsearch',
      _fromDB:          job._fromDB         || false,
      _jobId:           job._jobId          || null,
      _firstSeenAt:     job._firstSeenAt    || null,
      _postedDate:      job._postedDate     || null,
      _companyCoords:   job._companyCoords  || null,
      _experienceLevel: job._experienceLevel
        || classifyExperienceLevel(job.job_title, job._description)
        || null,
      _yearsMin:        job._yearsMin ?? null,
      _yearsMax:        job._yearsMax ?? null,
      _experienceText:  job._experienceText || null,
      _requiredSkills:  job._requiredSkills || [],
      _qualifications:  job._qualifications || [],
      _responsibilityBullets: job._responsibilityBullets || []
    });
  }

  // ── STEP 1: Batch-fetch all existing companies in one query ──────────────────
  //    Replaces the original N sequential Company.findOne() calls.
  const allNormalizedNames = [...companyMap.keys()];
  const existingDocs = await Company.find({ name: { $in: allNormalizedNames } });
  const companyDocMap = new Map(existingDocs.map(c => [c.name, c]));

  const hasValidCoords = (c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lng);

  const bulkExistingUpdates = [];  // collected, applied in one bulkWrite after the loop
  const results = [];

  for (const [normalized, data] of companyMap) {
    let company = companyDocMap.get(normalized);  // O(1) map lookup — no DB call

    if (!company) {
      // New company — must create individually to obtain the _id for job upserts below
      const coords = await resolveCompanyCoords(data, normalized);
      company = await Company.create({
        name:              normalized,
        logo:              data.employer_logo || null,
        domain:            null,
        website:           null,
        careersUrl:        null,
        careersProvider:   null,
        discoverySources:  ['skill-search'],
        intelligenceStatus: 'pending',
        source:            'skill-search',
        atsProvider:       data._atsProvider || null,
        lat:               coords.lat,
        lng:               coords.lng,
        lastIntelligenceAt: new Date()
      });
      console.log(`[SKILL SEARCH] New company saved: ${normalized}`);
    } else {
      // ── STEP 2: Collect field updates — applied in one bulkWrite after the loop ──
      const updates = {};

      const currentCoords = { lat: company.lat, lng: company.lng };
      if (!hasValidCoords(currentCoords) || isIndiaCenter(currentCoords)) {
        const coords = await resolveCompanyCoords(data, normalized);
        updates.lat = coords.lat;
        updates.lng = coords.lng;
        company.lat = coords.lat;  // keep local copy current for result building
        company.lng = coords.lng;
      }
      if (!company.logo && data.employer_logo) {
        updates.logo = data.employer_logo;
        company.logo = data.employer_logo;
      }
      if (!company.atsProvider && data._atsProvider) {
        updates.atsProvider = data._atsProvider;
        company.atsProvider = data._atsProvider;
      }

      if (Object.keys(updates).length > 0) {
        bulkExistingUpdates.push({
          updateOne: { filter: { _id: company._id }, update: { $set: updates } }
        });
      }
    }

    // Upsert live-fetched jobs; stamp lastSearchedAt for DB-sourced jobs
    for (const jobData of data.jobs) {
      if (jobData._fromDB) {
        if (jobData._jobId) {
          Job.findByIdAndUpdate(jobData._jobId, {
            $set: { lastSearchedAt: new Date() },
            $inc: { searchHitCount: 1 }
          }).catch(() => {});
        }
        continue;
      }
      try {
        const upserted = await upsertIngestedJob({
          title:      jobData.title,
          company:    company._id,
          location:   jobData.location,
          applyLink:  jobData.applyLink,
          description: jobData.description || null,
          source:     jobData.source,
          postedDate: jobData._postedDate ? new Date(jobData._postedDate) : null,
          isRemote:   jobData.location?.toLowerCase().includes('remote')
        });
        if (upserted?._id) {
          Job.findByIdAndUpdate(upserted._id, {
            $set: { lastSearchedAt: new Date() },
            $inc: { searchHitCount: 1 }
          }).catch(() => {});
        }
      } catch {}
    }

    if (!Number.isFinite(company.lat) || !Number.isFinite(company.lng)) continue;

    const scoredRoles = data.jobs
      .filter(j => isTitleRelevant(j.title, primarySkills, secondarySkills, suggestedRoles, domain))
      .map(j => ({
        title:           j.title,
        location:        j.location,
        applyLink:       j.applyLink,
        description:     j.description || null,
        experienceLevel: j._experienceLevel || null,
        yearsMin:        j._yearsMin ?? null,
        yearsMax:        j._yearsMax ?? null,
        experienceText:  j._experienceText || null,
        requiredSkills:  j._requiredSkills || [],
        qualifications:  j._qualifications || [],
        responsibilityBullets: j._responsibilityBullets || [],
        source:          j.source || 'unknown',
        postedDate:      j._postedDate || null,
        relevanceScore:  scoreJob(j.title, j.location, j.source, primarySkills, suggestedRoles, domain)
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    if (scoredRoles.length === 0) continue;

    const sources     = [...new Set(scoredRoles.map(r => r.source))];
    const atsProvider = company.atsProvider || data._atsProvider || sources.find(s => ATS_META[s]) || null;
    const atsMeta     = atsProvider ? ATS_META[atsProvider] : null;
    const hiringVelocity = company.hiringVelocity?.last7Days > 0
      ? company.hiringVelocity
      : (data._hiringVelocity || null);

    results.push({
      employer_name:  data.employer_name,
      employer_logo:  company.logo || data.employer_logo || resolveLogo(company),
      coords:         { lat: company.lat, lng: company.lng },
      roles:          scoredRoles,
      domain:         company?.domain || null,
      sources,
      atsProvider,
      atsMeta,
      hiringVelocity,
      companyId:      company._id
    });
  }

  // ── STEP 3: Apply all updates to existing companies in one bulkWrite ──────────
  //    Replaces the original N individual company.save() calls.
  if (bulkExistingUpdates.length > 0) {
    await Company.bulkWrite(bulkExistingUpdates).catch(e =>
      console.warn('[SKILL SEARCH] Company bulk update failed:', e.message)
    );
  }

  results.sort((a, b) => (b.roles[0]?.relevanceScore || 0) - (a.roles[0]?.relevanceScore || 0));
  return results;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

// Returns { companies, fromCache } so callers can relay the cache flag to clients.
async function searchJobsBySkills({ primarySkills = [], secondarySkills = [], skills = [], roles = [], domain = 'other' }) {
  const primary      = primarySkills.length ? primarySkills : skills;
  const secondary    = secondarySkills.length ? secondarySkills : [];
  const suggestedRoles = roles;

  if (!primary.length && !suggestedRoles.length) {
    throw new Error('No skills or roles provided');
  }

  console.log(`[SKILL SEARCH] Domain: ${domain}`);
  console.log(`[SKILL SEARCH] Suggested roles: ${suggestedRoles.join(' | ')}`);
  console.log(`[SKILL SEARCH] Primary skills: ${primary.join(', ')}`);

  // ── Cache check ─────────────────────────────────────────────────────────────
  const cached = await getCachedResults({ domain, primarySkills: primary, secondarySkills: secondary, roles: suggestedRoles });
  if (cached) {
    console.log(`[SKILL SEARCH] Serving from cache (${cached.length} companies)`);
    return { companies: cached, fromCache: true };
  }

  // ── DB-first: skip live APIs if we already have enough results ───────────────
  const dbJobsEarly = await searchDBJobs(primary, secondary, suggestedRoles, domain);

  // Always run live APIs — DB results are merged in below
  const queries = buildQueries(primary, suggestedRoles);
  console.log(`[SKILL SEARCH] DB: ${dbJobsEarly.length} jobs — running ${queries.length} JSearch queries + ATS boards...`);

  const filter = (jobs, titleField) =>
    jobs.filter(j => isTitleRelevant(j[titleField], primary, secondary, suggestedRoles, domain));

  const [
    allJSearchJobsRaw,
    greenhouseJobsRaw,
    leverJobsRaw,
    ashbyJobsRaw,
    smartRecruitersJobsRaw,
  ] = await Promise.all([
    searchAllJSearch(queries),
    searchGreenhouse(primary),
    searchLever(primary),
    searchAshby(primary),
    searchSmartRecruiters(primary),
  ]);
  const seenUrls = new Set();
  const dedupedJSearch = allJSearchJobsRaw.filter(j => {
    if (!j.job_apply_link) return true;
    if (seenUrls.has(j.job_apply_link)) return false;
    seenUrls.add(j.job_apply_link);
    return true;
  });

  dedupedJSearch.forEach(j => {
    if (!j._description && j.job_description)            j._description    = j.job_description;
    if (!j._postedDate  && j.job_posted_at_datetime_utc) j._postedDate     = j.job_posted_at_datetime_utc;
    if (!j._experienceLevel)                             j._experienceLevel = jsearchExpToLevel(j.job_required_experience);
    if (j._yearsMin == null) {
      const months = j.job_required_experience?.required_experience_in_months;
      j._yearsMin = typeof months === 'number' ? Math.round(months / 12 * 10) / 10 : null;
      j._yearsMax = null;
    }
  });

  const allJSearchJobs      = filter(dedupedJSearch,         'job_title');
  const greenhouseJobs      = filter(greenhouseJobsRaw,      'job_title');
  const leverJobs           = filter(leverJobsRaw,           'job_title');
  const ashbyJobs           = filter(ashbyJobsRaw,           'job_title');
  const smartRecruitersJobs = filter(smartRecruitersJobsRaw, 'job_title');

  console.log(
    `[SKILL SEARCH] JSearch: ${allJSearchJobs.length} | GH: ${greenhouseJobs.length}` +
    ` | Lever: ${leverJobs.length} | Ashby: ${ashbyJobs.length}` +
    ` | SR: ${smartRecruitersJobs.length} | DB: ${dbJobsEarly.length}`
  );

  const allJobs = [...allJSearchJobs, ...greenhouseJobs, ...leverJobs, ...ashbyJobs, ...smartRecruitersJobs, ...dbJobsEarly];
  console.log(`[SKILL SEARCH] Total combined: ${allJobs.length}`);

  const companies = await persistAndGroupJobs(allJobs, primary, suggestedRoles, secondary, domain);
  console.log(`[SKILL SEARCH] Unique companies: ${companies.length}`);

  setCachedResults(
    { domain, primarySkills: primary, secondarySkills: secondary, roles: suggestedRoles },
    companies
  ).catch(() => {});

  return { companies, fromCache: false };
}

module.exports = { searchJobsBySkills };
