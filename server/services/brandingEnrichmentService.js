const Job = require("../models/Job");
const {
  resolveBranding,
  buildLogoDevNameUrl
} = require("../utils/brandingResolver");
const {
  searchOfficialWebsite,
  isTavilyLimitError,
  getTavilyErrorDetails
} = require("../utils/tavilySearchResolver");
const {
  looksLikeGuessedDomain,
  resolveCompanyWithOpenRouter,
  isOpenRouterLimitError
} = require("../utils/openrouterResolver");

const inFlight = new Map();
const cooldowns = new Map();
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

function shouldTryOpenRouter(company, branding) {
  if (!process.env.OPENROUTER_API_KEY && !process.env.TAVILY_API_KEY) {
    return false;
  }

  if (looksLikeGuessedDomain(company)) {
    return true;
  }

  if (branding.logo && branding.brandingConfidence === "high") {
    return false;
  }

  return !branding.logo || looksLikeGuessedDomain(company);
}

async function ensureCompanyBranding(company, jobs) {
  const cachedBranding = resolveBranding(company);

  if (!shouldTryOpenRouter(company, cachedBranding)) {
    return cachedBranding;
  }

  const companyId = String(company._id);
  const lastAttempt = cooldowns.get(companyId);

  if (lastAttempt && Date.now() - lastAttempt < COOLDOWN_MS) {
    return cachedBranding;
  }

  if (inFlight.has(companyId)) {
    return inFlight.get(companyId);
  }

  const enrichmentPromise = (async () => {
    try {
      const sampleJobs =
        jobs ||
        (await Job.find({ company: company._id }).limit(3));

      let repairedBy = null;
      let repairedResult = null;

      if (process.env.TAVILY_API_KEY) {
        repairedResult = await searchOfficialWebsite(company, sampleJobs);
        if (repairedResult?.officialDomain) {
          repairedBy = "tavily";
        }
      }

      if (!repairedResult && process.env.OPENROUTER_API_KEY) {
        repairedResult = await resolveCompanyWithOpenRouter(company, sampleJobs);
        if (repairedResult) {
          repairedBy = "openrouter";
        }
      }

      if (!repairedResult || repairedResult.confidence === "low") {
        cooldowns.set(companyId, Date.now());
        return cachedBranding;
      }

      if (repairedResult.officialDomain) {
        company.domain = repairedResult.officialDomain;
      }

      const improvedBranding = resolveBranding(company);
      const nameBasedLogo =
        repairedBy === "openrouter" &&
        !repairedResult.officialDomain &&
        repairedResult.officialCompanyName
          ? buildLogoDevNameUrl(repairedResult.officialCompanyName)
          : null;

      if (improvedBranding.logo) {
        company.logo = improvedBranding.logo;
      } else if (nameBasedLogo) {
        company.logo = nameBasedLogo;
      }

      company.brandingSource = repairedResult.officialDomain
        ? `${repairedBy}-${improvedBranding.brandingSource}`
        : "openrouter-logo-dev-name";
      company.brandingConfidence = repairedResult.confidence;
      company.brandingReasoning = repairedResult.reasoning;
      company.updatedAt = new Date();

      await company.save();
      cooldowns.set(companyId, Date.now());

      console.log(
        `${repairedBy === "tavily" ? "Search" : "OpenRouter"} branding correction:`,
        company.name,
        "| old domain:",
        cachedBranding.domain || "none",
        "| new domain:",
        company.domain,
        "| source:",
        company.brandingSource,
        "| confidence:",
        company.brandingConfidence
      );

      return {
        domain: company.domain,
        logo: company.logo || improvedBranding.logo || nameBasedLogo,
        brandingSource: company.brandingSource,
        brandingConfidence: company.brandingConfidence
      };
    } catch (error) {
      cooldowns.set(companyId, Date.now());

      if (isTavilyLimitError(error)) {
        const details = getTavilyErrorDetails(error);
        console.log(
          `Tavily request throttled or limited${details.status ? ` (${details.status})` : ""}. ${details.message}`
        );
      } else if (isOpenRouterLimitError(error)) {
        console.log(
          "OpenRouter API limit reached. Logo/domain auto-repair is temporarily paused."
        );
      } else {
        console.log(
          "OpenRouter branding lookup failed for:",
          company.name
        );
        console.log(
          error.response?.data?.error?.message || error.message
        );
      }

      return cachedBranding;
    } finally {
      inFlight.delete(companyId);
    }
  })();

  inFlight.set(companyId, enrichmentPromise);
  return enrichmentPromise;
}

module.exports = {
  ensureCompanyBranding
};
