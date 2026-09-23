// server/utils/clearoutSearchResolver.js
//
// Wraps Clearout's free public Autocomplete API. No API key needed.
//
// IMPORTANT — verified behavior (see testClearout.js output):
// This is an exact/near-exact lookup against Clearout's own indexed company
// database, NOT a fuzzy web search. It reliably resolves well-known brand
// names typed close to their legal name ("micron technology" -> micron.com,
// confidence 99) but returns an EMPTY data: [] array for anything not
// closely matching an indexed name ("micron semiconductor" fails even
// though it's a real, large company; small/regional companies almost
// always come back empty). Treat a miss here as "try the next provider",
// never as "this company has no domain."
//
// Because it's free and instant, this is meant to run FIRST in a resolver
// chain, so well-known companies never burn a paid Serper/Tavily call.

const axios = require("axios");
const { normalizeDomain } = require("./brandingResolver");

const CLEAROUT_AUTOCOMPLETE_URL = "https://api.clearout.io/public/companies/autocomplete";

// Below this confidence_score, Clearout's own matches get noisy (e.g. querying
// "amazon" also returns "Amazon Bizz" at 29, "Amazon Frontlines" at 22) — those
// are almost never the company that was actually searched for.
const MIN_CONFIDENCE_SCORE = 50;

/**
 * @param {string} companyName
 * @returns {Promise<{ officialDomain: string, confidence: string, reasoning: string } | null>}
 */
async function searchOfficialWebsiteViaClearout(companyName) {
  if (!companyName) return null;

  let response;
  try {
    response = await axios.get(CLEAROUT_AUTOCOMPLETE_URL, {
      params: { query: companyName },
      timeout: 15000,
    });
  } catch (err) {
    // Clearout's own docs list daily-limit (200 OK w/ status:"failed") and
    // 429 rate-limit responses. Either way, just treat it as a miss and let
    // the caller move on to the next provider — this endpoint is free, so
    // there's no budget to protect by stopping early the way Tavily needs.
    return null;
  }

  const results = response?.data?.data;
  if (!Array.isArray(results) || results.length === 0) return null;

  const best = results[0];
  if (!best?.domain || (best.confidence_score ?? 0) < MIN_CONFIDENCE_SCORE) return null;

  return {
    officialDomain: normalizeDomain(best.domain),
    confidence: best.confidence_score >= 80 ? "high" : "medium",
    reasoning: `Clearout autocomplete match "${best.name}" (score ${best.confidence_score})`,
  };
}

module.exports = {
  searchOfficialWebsiteViaClearout,
};