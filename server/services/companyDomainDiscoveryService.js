// server/services/companyDomainDiscoveryService.js
//
// Resolves and PERSISTS company.domain for companies that don't have one yet.
//
// Provider cascade (same pattern as this codebase's existing LLM fallback:
// Groq -> Gemini -> OpenRouter):
//   1. Clearout Autocomplete — free, instant, no API key. Exact/near-exact
//      match against Clearout's own company database. Great for well-known
//      brand names, empty for almost everything else (verified: catches
//      "amazon"/"microsoft"/"micron technology" but misses smaller/regional
//      companies entirely). Run first so known companies never cost a paid
//      call.
//   2. Serper — real web search, already used elsewhere in this codebase
//      (webCompanyDiscoveryService.js, workdayDiscoveryService.js) with a
//      much larger request budget than Tavily. Primary workhorse for
//      companies Clearout can't find.
//   3. Tavily — kept as a last-resort fallback for whatever Serper misses.
//      This is the provider that was hitting rate limits on its own, so it
//      only gets called for the smallest slice of companies now.

const Company = require("../models/Company");
const { searchOfficialWebsiteViaClearout } = require("../utils/clearoutSearchResolver");
const { searchOfficialWebsiteViaSerper, isSerperLimitError, getSerperErrorDetails } = require("../utils/serperSearchResolver");
const { searchOfficialWebsite, isTavilyLimitError } = require("../utils/tavilySearchResolver");

const DEFAULT_LIMIT = Math.max(Number(process.env.COMPANY_DOMAIN_DISCOVERY_LIMIT || 30), 1);
const TAVILY_REQUEST_PAUSE_MS = Number(process.env.COMPANY_DOMAIN_DISCOVERY_PAUSE_MS || 1200);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCompaniesMissingDomain(limit) {
  return Company.find({
    $or: [{ domain: null }, { domain: "" }, { domain: { $exists: false } }],
  })
    .sort({ updatedAt: 1, createdAt: 1 })
    .limit(limit);
}

/**
 * Runs the Clearout -> Serper -> Tavily cascade for a single company.
 * Returns { officialDomain, confidence, reasoning, provider } or null if
 * nobody found a confident match. Also signals rateLimited if Tavily (the
 * only provider with a hard quota worth protecting) hit its limit, so the
 * caller can stop the batch early instead of burning through remaining
 * companies on a provider that will just keep failing.
 */
async function resolveCompanyDomain(company) {
  const clearoutResult = await searchOfficialWebsiteViaClearout(company.name);
  if (clearoutResult) return { ...clearoutResult, provider: "clearout" };

  try {
    const serperResult = await searchOfficialWebsiteViaSerper(
      { name: company.name, domain: company.domain || null },
      []
    );
    if (serperResult) return { ...serperResult, provider: "serper" };
  } catch (err) {
    const { status, message } = getSerperErrorDetails(err);
    if (isSerperLimitError(err)) {
      console.warn(
        `[DOMAIN DISCOVERY] Serper rate/quota limit hit on "${company.name}" ` +
          `(status: ${status}, message: "${message}") — falling back to Tavily.`
      );
    } else {
      console.warn(`[DOMAIN DISCOVERY] Serper lookup failed for "${company.name}" (status: ${status}): ${message}`);
    }
  }

  await sleep(TAVILY_REQUEST_PAUSE_MS);

  try {
    const tavilyResult = await searchOfficialWebsite({ name: company.name, domain: company.domain || null }, []);
    if (tavilyResult) return { ...tavilyResult, provider: "tavily" };
  } catch (err) {
    if (isTavilyLimitError(err)) {
      console.warn(`[DOMAIN DISCOVERY] Tavily rate/quota limit hit on "${company.name}".`);
      return { rateLimited: true };
    }
    console.warn(`[DOMAIN DISCOVERY] Tavily lookup failed for "${company.name}": ${err.message}`);
  }

  return null;
}

async function discoverMissingCompanyDomains(limit = DEFAULT_LIMIT) {
  const companies = await loadCompaniesMissingDomain(Math.max(limit, DEFAULT_LIMIT));

  let scannedCompanies = 0;
  let domainsFound = 0;
  let notFoundCount = 0;
  let rateLimited = false;
  const byProvider = { clearout: 0, serper: 0, tavily: 0 };

  for (const company of companies) {
    scannedCompanies++;

    const result = await resolveCompanyDomain(company);

    if (result?.rateLimited) {
      rateLimited = true;
      break;
    }

    if (!result?.officialDomain) {
      notFoundCount++;
      console.log(`[DOMAIN DISCOVERY] No confident match for "${company.name}" (checked all providers)`);
      continue;
    }

    company.domain = result.officialDomain;
    if (!company.website) {
      company.website = `https://${result.officialDomain}`;
    }
    company.updatedAt = new Date();
    await company.save();

    domainsFound++;
    byProvider[result.provider] = (byProvider[result.provider] || 0) + 1;

    console.log(
      `[DOMAIN DISCOVERY] "${company.name}" -> ${result.officialDomain} ` +
        `(via ${result.provider}, confidence: ${result.confidence})`
    );
  }

  console.log(
    `[DOMAIN DISCOVERY] Batch done — found ${domainsFound}/${scannedCompanies} ` +
      `(clearout: ${byProvider.clearout}, serper: ${byProvider.serper}, tavily: ${byProvider.tavily})`
  );

  return {
    scannedCompanies,
    domainsFound,
    notFoundCount,
    rateLimited,
    byProvider,
  };
}

module.exports = {
  discoverMissingCompanyDomains,
};