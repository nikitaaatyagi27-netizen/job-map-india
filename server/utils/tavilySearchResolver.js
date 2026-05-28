const axios = require("axios");
const { normalizeDomain } = require("./brandingResolver");
const {
  stripLegalSuffixes,
  chooseOfficialWebsiteWithOpenRouter
} = require("./openrouterResolver");

const TAVILY_SEARCH_API_URL =
  "https://api.tavily.com/search";
const TAVILY_REQUEST_DELAY_MS = 1200;

const BLOCKED_HOST_PATTERNS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "naukri.com",
  "wellfound.com",
  "lever.co",
  "greenhouse.io",
  "ashbyhq.com",
  "smartrecruiters.com",
  "workday.com",
  "workable.com",
  "jobvite.com",
  "bamboohr.com",
  "icims.com",
  "taleo.net",
  "personio.com",
  "boards.",
  "jobs.",
  "careers.",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "crunchbase.com",
  "tracxn.com",
  "eu-startups.com",
  "pitchbook.com"
];

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHost(hostname) {
  if (!hostname) return true;

  return BLOCKED_HOST_PATTERNS.some((pattern) => hostname.includes(pattern));
}

function levenshteinDistance(a, b) {
  const left = a || "";
  const right = b || "";

  const dp = Array.from({ length: left.length + 1 }, () =>
    new Array(right.length + 1).fill(0)
  );

  for (let i = 0; i <= left.length; i += 1) {
    dp[i][0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

function scoreResult(result, normalizedName) {
  const hostname = getHostname(result.url);

  if (!hostname || isBlockedHost(hostname)) {
    return -1;
  }

  const host = hostname.replace(/^www\./, "");
  const root = host.replace(/\.(com|ai|io|co|tech|in|org|net|dev|app|cloud|asia)$/, "");
  const haystack = `${result.title || ""} ${result.content || ""} ${host}`.toLowerCase();
  const compactName = normalizedName.replace(/\s+/g, "");
  const compactRoot = root.replace(/[^a-z0-9]/g, "");

  let score = 0;

  if (compactRoot === compactName) score += 10;
  if (host.includes(compactName)) score += 6;
  if (haystack.includes(normalizedName)) score += 4;
  if (!host.includes("blog.")) score += 1;

  const distance = levenshteinDistance(compactRoot, compactName);

  if (distance > 0 && distance <= 2) score += 5;
  if (distance > 2 && distance <= 4) score += 2;

  return score;
}

function extractResults(data) {
  return data?.results || [];
}

function rankCandidates(results, normalizedName) {
  return results
    .map((result) => ({
      ...result,
      score: scoreResult(result, normalizedName)
    }))
    .filter((result) => result.score >= 0)
    .sort((left, right) => right.score - left.score);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTavilyErrorDetails(error) {
  const status = error?.response?.status || null;
  const message =
    error?.response?.data?.detail ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    "Unknown Tavily error";

  return {
    status,
    message
  };
}

async function searchOfficialWebsite(company, jobs = []) {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return null;
  }

  const normalizedName = stripLegalSuffixes(company.name);

  if (!normalizedName) {
    return null;
  }

  const topRole = jobs[0];
  const queries = [
    `${normalizedName} official website`,
    topRole?.title
      ? `${normalizedName} software company official website ${topRole.title}`
      : null,
    company.name !== normalizedName
      ? `${company.name} official site`
      : null
  ].filter(Boolean);

  let allCandidates = [];

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];

    if (index > 0) {
      await sleep(TAVILY_REQUEST_DELAY_MS);
    }

    const response = await axios.post(
      TAVILY_SEARCH_API_URL,
      {
        api_key: apiKey,
        query,
        max_results: 6,
        search_depth: index === 0 ? "basic" : "advanced"
      },
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const results = extractResults(response.data).map((result) => ({
      ...result,
      query
    }));

    allCandidates = allCandidates.concat(results);
  }

  const rankedCandidates = rankCandidates(allCandidates, normalizedName);

  const aiSelection =
    process.env.OPENROUTER_API_KEY
      ? await chooseOfficialWebsiteWithOpenRouter(
          company,
          rankedCandidates,
          jobs
        )
      : null;

  if (aiSelection?.officialDomain && aiSelection.confidence !== "low") {
    return {
      officialDomain: aiSelection.officialDomain,
      confidence: aiSelection.confidence,
      reasoning: aiSelection.reasoning || "AI selected official website from Tavily results"
    };
  }

  const bestCandidate = rankedCandidates[0];

  if (!bestCandidate) {
    return null;
  }

  const hostname = getHostname(bestCandidate.url);
  const fallbackConfidence =
    bestCandidate.score >= 10 ? "high" : bestCandidate.score >= 6 ? "medium" : "low";

  if (fallbackConfidence === "low") {
    return null;
  }

  return {
    officialDomain: normalizeDomain(hostname),
    confidence: fallbackConfidence,
    reasoning: `Tavily scored match from "${bestCandidate.query}" using ${hostname}`
  };
}

function isTavilyLimitError(error) {
  const { status, message } = getTavilyErrorDetails(error);

  if (status === 429 || status === 432 || status === 433 || status === 402) {
    return true;
  }

  return /quota|rate limit|too many requests|credits|payment/i.test(message);
}

module.exports = {
  searchOfficialWebsite,
  isTavilyLimitError,
  getTavilyErrorDetails
};
