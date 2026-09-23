// server/utils/serperSearchResolver.js
//
// Official-website resolver using Serper (google.serper.dev), following the
// exact same request pattern already proven in services/webCompanyDiscoveryService.js.
// Structurally mirrors utils/tavilySearchResolver.js — same scoring/ranking/
// blocked-host logic, same OpenRouter re-ranking step — just swapping the
// underlying search provider and its response shape (Serper: `organic[].link`
// vs Tavily: `results[].url`).
//
// Why this exists: Tavily's free search quota is tight and was getting
// rate-limited well before your actual monthly credit balance ran out.
// Serper is already integrated and working elsewhere in this codebase with
// a much larger request budget, so it's used as the primary paid fallback,
// with Tavily kept as a last-resort behind it.

const axios = require("axios");
const { normalizeDomain } = require("./brandingResolver");
const {
  stripLegalSuffixes,
  chooseOfficialWebsiteWithOpenRouter,
} = require("./openrouterResolver");

const SERPER_SEARCH_API_URL = "https://google.serper.dev/search";
const SERPER_REQUEST_DELAY_MS = 400;

// Same blocklist as tavilySearchResolver.js — job boards, ATS platforms,
// and social/data sites are never a company's own official website.
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
  "pitchbook.com",
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

  const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[left.length][right.length];
}

function scoreResult(result, normalizedName) {
  const hostname = getHostname(result.url);
  if (!hostname || isBlockedHost(hostname)) return -1;

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

function rankCandidates(results, normalizedName) {
  return results
    .map((result) => ({ ...result, score: scoreResult(result, normalizedName) }))
    .filter((result) => result.score >= 0)
    .sort((left, right) => right.score - left.score);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSerperErrorDetails(error) {
  const status = error?.response?.status || null;
  const message = error?.response?.data?.message || error?.message || "Unknown Serper error";
  return { status, message };
}

function isSerperLimitError(error) {
  const { status, message } = getSerperErrorDetails(error);
  if (status === 429 || status === 402) return true;
  return /quota|rate limit|too many requests|credits|payment/i.test(message);
}

/**
 * @param {{ name: string, domain?: string|null }} company
 * @param {Array} jobs optional, same shape tavilySearchResolver.js expects (for AI re-ranking context)
 * @returns {Promise<{ officialDomain: string, confidence: string, reasoning: string } | null>}
 */
async function searchOfficialWebsiteViaSerper(company, jobs = []) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return null;

  const normalizedName = stripLegalSuffixes(company.name);
  if (!normalizedName) return null;

  const topRole = jobs[0];
  const queries = [
    `${normalizedName} official website`,
    topRole?.title ? `${normalizedName} company official website ${topRole.title}` : null,
    company.name !== normalizedName ? `${company.name} official site` : null,
  ].filter(Boolean);

  let allCandidates = [];

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    if (index > 0) await sleep(SERPER_REQUEST_DELAY_MS);

    const response = await axios.post(
      SERPER_SEARCH_API_URL,
      { q: query, gl: "in", num: 8 },
      {
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const results = (response.data?.organic || []).map((r) => ({
      url: r.link,
      title: r.title,
      content: r.snippet,
      query,
    }));

    allCandidates = allCandidates.concat(results);
  }

  const rankedCandidates = rankCandidates(allCandidates, normalizedName);

  const aiSelection = process.env.OPENROUTER_API_KEY
    ? await chooseOfficialWebsiteWithOpenRouter(company, rankedCandidates, jobs)
    : null;

  if (aiSelection?.officialDomain && aiSelection.confidence !== "low") {
    return {
      officialDomain: aiSelection.officialDomain,
      confidence: aiSelection.confidence,
      reasoning: aiSelection.reasoning || "AI selected official website from Serper results",
    };
  }

  const bestCandidate = rankedCandidates[0];
  if (!bestCandidate) return null;

  const hostname = getHostname(bestCandidate.url);
  const fallbackConfidence = bestCandidate.score >= 10 ? "high" : bestCandidate.score >= 6 ? "medium" : "low";
  if (fallbackConfidence === "low") return null;

  return {
    officialDomain: normalizeDomain(hostname),
    confidence: fallbackConfidence,
    reasoning: `Serper scored match from "${bestCandidate.query}" using ${hostname}`,
  };
}

module.exports = {
  searchOfficialWebsiteViaSerper,
  isSerperLimitError,
  getSerperErrorDetails,
};