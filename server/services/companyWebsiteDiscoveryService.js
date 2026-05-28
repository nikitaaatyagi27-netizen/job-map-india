const axios = require("axios");

const Company = require("../models/Company");
const { upsertCareerSource } = require("./companyIntelligenceService");
const { detectCareerProvider } = require("../utils/careerProviderDetector");
const { searchOfficialWebsite } = require("../utils/tavilySearchResolver");

const PROBE_PATHS = [
  "/careers",
  "/jobs",
  "/openings",
  "/join-us",
  "/work-with-us"
];

const INTERESTING_LINK_PATTERNS = [
  /careers?/i,
  /jobs?/i,
  /open roles?/i,
  /open positions?/i,
  /join/i,
  /work with us/i,
  /about/i,
  /contact/i,
  /company/i
];

const CONCURRENCY = Math.max(Number(process.env.COMPANY_WEBSITE_DISCOVERY_CONCURRENCY || 3), 1);
const DEFAULT_LIMIT = Math.max(Number(process.env.COMPANY_WEBSITE_DISCOVERY_LIMIT || 30), 1);

function buildBaseUrl(company) {
  if (company.website) {
    return company.website;
  }

  if (company.domain) {
    return `https://${company.domain}`;
  }

  return null;
}

async function buildDiscoveredBaseUrl(company) {
  const directBase = buildBaseUrl(company);

  if (directBase) {
    return directBase;
  }

  if (!company?.name) {
    return null;
  }

  const officialWebsite = await searchOfficialWebsite(
    {
      name: company.name,
      domain: company.domain || null
    },
    []
  );

  if (!officialWebsite?.officialDomain) {
    return null;
  }

  return `https://${officialWebsite.officialDomain}`;
}

function extractUrlsFromHtml(html, baseUrl) {
  const urls = new Set();
  const hrefPattern = /href\s*=\s*["']([^"'#>\s]+)["']/gi;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    const href = match[1];

    try {
      const resolved = new URL(href, baseUrl).toString();
      urls.add(resolved);
    } catch {
      continue;
    }
  }

  return Array.from(urls);
}

function extractInterestingUrls(html, baseUrl) {
  return extractUrlsFromHtml(html, baseUrl).filter((url) => {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return false;
      }

      const path = `${parsed.pathname}${parsed.search}`;
      return INTERESTING_LINK_PATTERNS.some((pattern) => pattern.test(path));
    } catch {
      return false;
    }
  });
}

function textLooksLikeCareers(html, url) {
  return /careers?|jobs?|open roles?|open positions?|join our team|work with us/i.test(
    `${html || ""} ${url || ""}`
  );
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: 8000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  return {
    finalUrl: response.request?.res?.responseUrl || url,
    html: typeof response.data === "string" ? response.data : JSON.stringify(response.data)
  };
}

function chooseCareerSignal(pageUrl, html, company, discoveredUrls) {
  for (const discoveredUrl of discoveredUrls) {
    const provider = detectCareerProvider(discoveredUrl);

    if (provider) {
      return {
        careersUrl: provider.careersUrl,
        careersProvider: provider.provider,
        confidence: "medium",
        note: discoveredUrl,
        boardUrl: provider.boardUrl || discoveredUrl
      };
    }
  }

  if (textLooksLikeCareers(html, pageUrl)) {
    try {
      const parsedPageUrl = new URL(pageUrl);
      const candidateBase = buildBaseUrl(company);
      const candidateHost = candidateBase ? new URL(candidateBase).hostname : null;

      if (!candidateHost || parsedPageUrl.hostname.includes(candidateHost) || candidateHost.includes(parsedPageUrl.hostname)) {
        return {
          careersUrl: pageUrl,
          careersProvider: null,
          confidence: "low",
          note: pageUrl,
          boardUrl: pageUrl
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function buildProbeUrls(company) {
  const baseUrl = buildBaseUrl(company);

  if (!baseUrl) {
    return [];
  }

  const urls = new Set();

  try {
    const origin = new URL(baseUrl).origin;
    urls.add(origin);

    for (const path of PROBE_PATHS) {
      urls.add(new URL(path, origin).toString());
    }
  } catch {
    return [];
  }

  return Array.from(urls);
}

async function probeUrl(probeUrl, company) {
  const { finalUrl, html } = await fetchHtml(probeUrl);
  const extractedUrls = extractUrlsFromHtml(html, finalUrl);
  const interestingUrls = extractInterestingUrls(html, finalUrl);

  return {
    signal: chooseCareerSignal(finalUrl, html, company, [
      finalUrl,
      ...extractedUrls,
      ...interestingUrls
    ]),
    finalUrl,
    interestingUrls
  };
}

async function loadCompanyBatch(limit) {
  const companies = await Company.find({
    $or: [
      { careersUrl: null },
      { careersProvider: null }
    ]
  })
    .sort({ updatedAt: 1, createdAt: 1 })
    .limit(Math.max(limit * 8, 80));

  return companies;
}

async function discoverCompanyWebsiteCareers(limit = 10) {
  const companies = await loadCompanyBatch(Math.max(limit, DEFAULT_LIMIT));

  let scannedCompanies = 0;
  let updatedCompanies = 0;
  let providersDiscovered = 0;
  let careersUrlsDiscovered = 0;

  for (const company of companies) {
    scannedCompanies++;

    const discoveredBaseUrl = await buildDiscoveredBaseUrl(company);
    const probeUrls = buildProbeUrls({
      ...company.toObject(),
      website: discoveredBaseUrl || company.website
    });

    console.log(`[WEBSITE DISCOVERY] Probing ${company.name}`);

    const signals = [];
    const probeQueue = [...probeUrls];
    const seenProbeUrls = new Set(probeQueue);
    const probeResults = [];

    while (probeQueue.length > 0 && probeResults.length < 12) {
      const wave = probeQueue.splice(0, CONCURRENCY);
      const settled = await Promise.allSettled(
        wave.map((url) => probeUrl(url, company))
      );

      for (const result of settled) {
        if (result.status === "fulfilled") {
          probeResults.push(result.value);

          const newUrls = (result.value?.interestingUrls || []).filter((url) => {
            if (!url || seenProbeUrls.has(url)) {
              return false;
            }

            seenProbeUrls.add(url);
            return true;
          });

          if (newUrls.length > 0) {
            probeQueue.push(...newUrls.slice(0, 4));
          }
        }
      }
    }

    const normalizedProbeResults = probeResults
      .map((result) => result?.signal || null)
      .filter(Boolean);

    for (const result of normalizedProbeResults) {
      signals.push(result);
    }

    const discoveredSignal = signals
      .filter(Boolean)
      .sort((left, right) => {
        const leftScore = (left.careersProvider ? 8 : 0) + (left.confidence === "medium" ? 5 : left.confidence === "low" ? 2 : 0);
        const rightScore = (right.careersProvider ? 8 : 0) + (right.confidence === "medium" ? 5 : right.confidence === "low" ? 2 : 0);
        return rightScore - leftScore;
      })[0] || null;

    if (!discoveredSignal) {
      continue;
    }

    let changed = false;

    if (!company.website && discoveredBaseUrl) {
      company.website = discoveredBaseUrl;
      changed = true;
    }

    if (!company.website && company.domain) {
      company.website = `https://${company.domain}`;
      changed = true;
    }

    if (discoveredSignal.careersUrl && !company.careersUrl) {
      company.careersUrl = discoveredSignal.careersUrl;
      careersUrlsDiscovered++;
      changed = true;
    }

    if (discoveredSignal.careersProvider && !company.careersProvider) {
      company.careersProvider = discoveredSignal.careersProvider;
      providersDiscovered++;
      changed = true;
    }

    if (discoveredSignal.note && !company.brandingReasoning) {
      company.brandingReasoning = discoveredSignal.note;
      changed = true;
    }

    if (changed) {
      company.intelligenceStatus = company.careersProvider
        ? "direct-source-linked"
        : "website-known";
      company.lastIntelligenceAt = new Date();
      company.updatedAt = new Date();
      await company.save();
      updatedCompanies++;

      if (company.careersProvider && company.careersUrl) {
        await upsertCareerSource({
          company,
          provider: company.careersProvider,
          boardUrl: company.careersUrl,
          careersUrl: company.careersUrl,
          discoveryMethod: "company-website-discovery",
          parserType: "url-detection",
          jobsFound: 0,
          status: "active"
        });
      }
    }
  }

  return {
    scannedCompanies,
    updatedCompanies,
    providersDiscovered,
    careersUrlsDiscovered,
    concurrency: CONCURRENCY,
    limit: Math.max(limit, DEFAULT_LIMIT)
  };
}

module.exports = {
  discoverCompanyWebsiteCareers
};
