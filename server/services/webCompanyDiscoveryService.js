const axios = require("axios");

const Company = require("../models/Company");
const { upsertCareerSource } = require("./companyIntelligenceService");
const { detectCareerProvider } = require("../utils/careerProviderDetector");
const {
  cleanCompanyName,
  fromHost,
  isGenericCompanyName
} = require("../utils/cleanCompanyName");
const { getDiscoveryQueries } = require("./discoveryQueryService");
const { buildIndiaWideDiscoveryQueries } = require("../config/indiaDiscoveryQueries");
const { registerUniversalSource } = require("./universalCareerSourceService");

const SERPER_SEARCH_API_URL = "https://google.serper.dev/search";

const BLOCKED_DISCOVERY_HOST_PATTERNS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "naukri.com",
  "monsterindia.com",
  "foundit.in",
  "foundit.com",
  "timesjobs.com",
  "shine.com",
  "apna.co",
  "internshala.com",
  "wellfound.com",
  "angel.co",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "tracxn.com",
  "crunchbase.com",
  "jobs.",
  "careers.",
  "boards."
];

const JOB_INTENT_TOKENS = new Set([
  "job",
  "jobs",
  "vacancy",
  "vacancies",
  "opening",
  "openings",
  "hiring",
  "walkin",
  "walk",
  "salary",
  "apply",
  "fresher",
  "freshers"
]);

const LOCATION_TOKENS = new Set([
  "india",
  "delhi",
  "gurgaon",
  "gurugram",
  "noida",
  "mumbai",
  "pune",
  "bangalore",
  "bengaluru",
  "hyderabad",
  "chennai",
  "kolkata"
]);

async function buildFallbackDiscoveryQueries() {
  const companies = await Company.find({
    $or: [
      { website: { $ne: null } },
      { domain: { $ne: null } },
      { careersUrl: { $ne: null } }
    ]
  })
    .select("name domain website careersUrl")
    .limit(20);

  const queries = new Set(
    buildIndiaWideDiscoveryQueries("web-company").map((entry) => entry.query)
  );

  for (const company of companies) {
    const name = String(company.name || "").trim();

    if (name) {
      queries.add(`${name} careers india`);
      queries.add(`${name} jobs india`);
    }

    if (company.domain) {
      queries.add(`site:${company.domain} careers`);
    }
  }

  return Array.from(queries).slice(0, 60);
}

function normalizeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedDiscoveryHost(hostname) {
  if (!hostname) {
    return true;
  }

  return BLOCKED_DISCOVERY_HOST_PATTERNS.some((pattern) =>
    hostname.includes(pattern)
  );
}

function titleCase(value) {
  return (value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferCompanyNameFromProviderUrl(url, provider) {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);

    if (
      provider === "lever" ||
      provider === "greenhouse" ||
      provider === "ashby" ||
      provider === "jobvite" ||
      provider === "workable"
    ) {
      return titleCase((pathSegments[0] || "").replace(/[-_]+/g, " "));
    }

    if (provider === "smartrecruiters") {
      return titleCase((pathSegments[0] || "").replace(/[-_]+/g, " "));
    }

    if (provider === "workday") {
      return titleCase(parsed.hostname.split(".")[0].replace(/[-_]+/g, " "));
    }

    if (
      provider === "teamtailor" ||
      provider === "recruitee" ||
      provider === "bamboohr" ||
      provider === "icims" ||
      provider === "taleo" ||
      provider === "personio"
    ) {
      return titleCase(parsed.hostname.split(".")[0].replace(/[-_]+/g, " "));
    }
  } catch {
    return null;
  }

  return null;
}

function inferCompanyNameFromResult(result) {
  const title = (result.title || "").trim();

  if (!title) {
    return null;
  }

  const titleSplit = title
    .split(/[-|–—]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (titleSplit.length > 0) {
    for (const part of titleSplit) {
      if (!isLikelyDiscoveryCompanyName(part)) {
        continue;
      }

      return part;
    }
  }

  return isLikelyDiscoveryCompanyName(title) ? title : null;
}

function normalizeCandidateName(value) {
  const cleaned = cleanCompanyName(value, null, { allowUnknown: false });
  return cleaned || null;
}

function isLikelyDiscoveryCompanyName(value) {
  const raw = String(value || "").trim();

  if (!raw || raw.length > 70) {
    return false;
  }

  const normalized = raw.toLowerCase();
  const words = normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return false;
  }

  const numericTokens = words.filter((word) => /^\d+$/.test(word)).length;
  if (numericTokens > 0 && numericTokens >= Math.ceil(words.length / 2)) {
    return false;
  }

  if (words.some((word) => JOB_INTENT_TOKENS.has(word))) {
    return false;
  }

  const SENTENCE_STARTERS = new Set(['search','find','browse','explore','discover','view','welcome','get','start','apply','check','see','our','we','join']);
  if (SENTENCE_STARTERS.has(words[0])) {
    return false;
  }

  if (/\b(job opportunities|career opportunities|open positions|current openings|job openings|job listings)\b/i.test(raw)) {
    return false;
  }

  const locationHits = words.filter((word) => LOCATION_TOKENS.has(word)).length;
  if (locationHits >= 2) {
    return false;
  }

  return true;
}

function looksLikeCareersPage(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/(career|careers|jobs|join|hiring|work-with-us|open-roles|openings|opportunities)/.test(path);
  } catch {
    return false;
  }
}

async function upsertCompanyFromDiscovery({
  companyName,
  url,
  hostname,
  detectedProvider
}) {
  const normalizedName = normalizeCandidateName(companyName);

  if (!normalizedName || isGenericCompanyName(normalizedName)) {
    return null;
  }

  const now = new Date();
  let company = await Company.findOne({
    name: normalizedName
  });

  const website = detectedProvider?.provider ? null : url;
  const domain = detectedProvider?.provider ? null : hostname;
  const careersUrl = detectedProvider?.careersUrl || null;
  const careersProvider = detectedProvider?.provider || null;

  if (!company) {
    company = await Company.create({
      name: normalizedName,
      logo: null,
      domain,
      website,
      careersUrl,
      careersProvider,
      discoverySources: ["web-search"],
      intelligenceStatus: careersProvider
        ? "direct-source-linked"
        : website
          ? "website-known"
          : "pending",
      lastIntelligenceAt: now,
      source: "web-search"
    });
  } else {
    let changed = false;

    if (!company.domain && domain) {
      company.domain = domain;
      changed = true;
    }

    if (!company.website && website) {
      company.website = website;
      changed = true;
    }

    if (!company.careersUrl && careersUrl) {
      company.careersUrl = careersUrl;
      changed = true;
    }

    if (!company.careersProvider && careersProvider) {
      company.careersProvider = careersProvider;
      changed = true;
    }

    const nextDiscoverySources = new Set(company.discoverySources || []);
    nextDiscoverySources.add("web-search");

    const mergedDiscoverySources = Array.from(nextDiscoverySources).sort();
    if (
      JSON.stringify(mergedDiscoverySources) !==
      JSON.stringify(company.discoverySources || [])
    ) {
      company.discoverySources = mergedDiscoverySources;
      changed = true;
    }

    if (careersProvider && company.careersUrl) {
      company.intelligenceStatus = "direct-source-linked";
    } else if (website && company.intelligenceStatus === "pending") {
      company.intelligenceStatus = "website-known";
    }

    if (changed) {
      company.lastIntelligenceAt = now;
      company.updatedAt = now;
      await company.save();
    }
  }

  if (careersProvider && careersUrl) {
    await upsertCareerSource({
      company,
      provider: careersProvider,
      boardUrl: detectedProvider?.boardUrl || careersUrl || url,
      careersUrl,
      discoveryMethod: "web-search",
      parserType: "url-detection",
      jobsFound: 0,
      status: "active"
    });
  }

  // No known ATS detected but URL looks like a careers page → hand off to universal LLM scraper
  if (!detectedProvider && looksLikeCareersPage(url) && company) {
    await registerUniversalSource({
      companyName: company.name,
      careersUrl: url,
      location: null
    }).catch((err) => {
      console.warn(`[WEB DISCOVERY] Could not register universal source for ${url}: ${err.message}`);
    });
  }

  return company;
}

// Confidence scoring for a discovered result.
// Returns a numeric score; only results that reach MIN_CONFIDENCE are upserted.
//
// Score breakdown:
//   +2  known ATS provider detected (greenhouse, lever, workday, etc.) — very strong signal
//   +1  URL path looks like a careers page (/jobs, /careers, /hiring, etc.)
//   +1  company name is clean, specific, and reasonable length
//
// Minimum score to promote: 2
//   → ATS detected alone is sufficient (score 2)
//   → careers page + clean name is sufficient (score 2)
//   → unrecognised URL with no careers path → score ≤ 1 → rejected
const MIN_CONFIDENCE_SCORE = 2;

function scoreDiscoveryResult({ url, detectedProvider, companyName }) {
  let score = 0;
  if (detectedProvider?.provider) score += 2;
  if (looksLikeCareersPage(url)) score += 1;
  if (companyName && companyName.length >= 3 && companyName.length <= 60) score += 1;
  return score;
}

async function discoverWebCompanies() {
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    throw new Error("SERPER_API_KEY is required for web company discovery");
  }

  const discoveryQueries = await getDiscoveryQueries(
    "web-company",
    await buildFallbackDiscoveryQueries()
  );

  if (discoveryQueries.length === 0) {
    console.log("[WEB COMPANY DISCOVERY] No active discovery queries configured");
    return {
      queriesRun: 0,
      discoveredCompanies: 0,
      failedQueries: 0
    };
  }

  // Domain bloom filter: load all known company domains once at the start.
  // Any Serper result whose hostname matches a known domain is skipped —
  // no DB upsert, no universal-scraper registration, no Serper credit wasted.
  const knownDomains = new Set(
    (await Company.find({ domain: { $ne: null } }).select("domain").lean())
      .map(c => c.domain)
      .filter(Boolean)
  );
  console.log(`[WEB COMPANY DISCOVERY] Bloom filter loaded — ${knownDomains.size} known domains`);

  const seen = new Set();
  let discoveredCompanies = 0;
  let skippedKnown = 0;
  let failedQueries = 0;

  for (const entry of discoveryQueries) {
    const query = entry.query;
    let response;

    try {
      response = await axios.post(
        SERPER_SEARCH_API_URL,
        { q: query, gl: "in", num: 8 },
        {
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );
    } catch (error) {
      failedQueries++;
      console.log(`[WEB COMPANY DISCOVERY] Query failed: ${query}`);
      console.log(error.message);
      continue;
    }

    // Serper returns { organic: [{ title, link, snippet }] }
    // Map to { url, title } to match the shape the rest of the service expects
    const results = (response.data?.organic || []).map(r => ({ url: r.link, title: r.title }));

    for (const result of results) {
      const url = result.url || null;
      const hostname = normalizeHost(url);
      const detectedProvider = detectCareerProvider(url);

      if (!detectedProvider && isBlockedDiscoveryHost(hostname)) {
        continue;
      }

      // Bloom filter: skip hostnames already in our Company collection
      if (hostname && knownDomains.has(hostname)) {
        skippedKnown++;
        continue;
      }

      const inferredProviderName = detectedProvider
        ? (detectedProvider.companySlug
            ? titleCase(detectedProvider.companySlug.replace(/[-_]+/g, " "))
            : null) || inferCompanyNameFromProviderUrl(url, detectedProvider.provider)
        : null;
      const inferredHostName = !detectedProvider
        ? fromHost(hostname)
        : null;
      const inferredResultName = inferCompanyNameFromResult(result);
      const companyName = normalizeCandidateName(
        inferredProviderName || inferredHostName || inferredResultName
      );

      if (
        !companyName ||
        !isLikelyDiscoveryCompanyName(companyName) ||
        isGenericCompanyName(companyName)
      ) {
        continue;
      }

      const dedupeKey = `${companyName.toLowerCase()}|${hostname || "none"}`;

      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);

      // Confidence gate: reject low-signal results before any DB write
      const confidence = scoreDiscoveryResult({ url, detectedProvider, companyName });
      if (confidence < MIN_CONFIDENCE_SCORE) {
        continue;
      }

      const company = await upsertCompanyFromDiscovery({
        companyName,
        url,
        hostname,
        detectedProvider
      });

      if (company) {
        discoveredCompanies++;
        // Add newly discovered domain to bloom filter so it's skipped if the
        // same hostname appears again within this run
        if (hostname) knownDomains.add(hostname);
      }
    }
  }

  return {
    queriesRun: discoveryQueries.length,
    discoveredCompanies,
    skippedKnown,
    failedQueries
  };
}

module.exports = {
  discoverWebCompanies
};
