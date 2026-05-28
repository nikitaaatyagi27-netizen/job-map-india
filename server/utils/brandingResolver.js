function normalizeDomain(domain) {
  if (!domain) return null;

  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function extractDomainFromUrl(url) {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

function isAtsOrJobBoardDomain(domain) {
  const d = normalizeDomain(domain);
  if (!d) return false;

  const patterns = [
    "myworkdayjobs.com",
    "workday.com",
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "smartrecruiters.com",
    "workable.com",
    "jobvite.com",
    "bamboohr.com",
    "icims.com",
    "taleo.net",
    "personio.com"
  ];

  return patterns.some((p) => d === p || d.endsWith(`.${p}`));
}

const BLOCKED_LOGO_HOST_PATTERNS = [
  "bebee.com",
  "gstatic.com",
  "googleusercontent.com",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "naukri.com",
  "monster.com",
  "shine.com",
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
  "personio.com"
];

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedLogoHost(hostname) {
  if (!hostname) return false;

  return BLOCKED_LOGO_HOST_PATTERNS.some((pattern) => hostname.includes(pattern));
}

function encodeCompanyName(name) {
  return encodeURIComponent((name || "").trim());
}

function buildLogoDevDomainUrl(domain) {
  const normalizedDomain = normalizeDomain(domain);
  const token = process.env.LOGO_DEV_API_KEY;

  if (!normalizedDomain || !token) return null;

  return `https://img.logo.dev/${normalizedDomain}?token=${token}&size=200&retina=true&format=png`;
}

function buildLogoDevNameUrl(name) {
  const encodedName = encodeCompanyName(name);
  const token = process.env.LOGO_DEV_API_KEY;

  if (!encodedName || !token) return null;

  return `https://img.logo.dev/name/${encodedName}?token=${token}&size=200&retina=true&format=png&fallback=404`;
}

function buildGoogleFaviconUrl(domain) {
  const normalizedDomain = normalizeDomain(domain);

  if (!normalizedDomain) return null;

  return `https://www.google.com/s2/favicons?domain=${normalizedDomain}&sz=128`;
}

function isTrustedStoredLogo(url) {
  if (!url) return false;

  const hostname = getHostname(url);

  if (!hostname) return false;

  return (
    !url.includes("logo.dev") &&
    !url.includes("google.com/s2/favicons") &&
    !isBlockedLogoHost(hostname)
  );
}

function shouldAcceptCompanyLogo(url, companyDomain) {
  if (!url) return false;

  const hostname = getHostname(url);
  const normalizedCompanyDomain = normalizeDomain(companyDomain);

  if (!hostname || isBlockedLogoHost(hostname)) {
    return false;
  }

  if (!normalizedCompanyDomain) {
    return true;
  }

  return (
    hostname.includes(normalizedCompanyDomain) ||
    normalizedCompanyDomain.includes(hostname.replace(/^www\./, ""))
  );
}

function resolveBranding(company) {
  const normalizedDomain =
    normalizeDomain(company.domain) ||
    extractDomainFromUrl(company.website) ||
    extractDomainFromUrl(company.careersUrl);

  // Avoid using ATS/job-board domains for logo resolution. Prefer the company name fallback instead.
  const usableDomain = isAtsOrJobBoardDomain(normalizedDomain) ? null : normalizedDomain;

  if (isTrustedStoredLogo(company.logo)) {
    return {
      domain: usableDomain,
      logo: company.logo,
      brandingSource: "stored-logo",
      brandingConfidence: "high"
    };
  }

  if (usableDomain) {
    const logoDevUrl = buildLogoDevDomainUrl(usableDomain);

    if (logoDevUrl) {
      return {
        domain: usableDomain,
        logo: logoDevUrl,
        brandingSource: "logo-dev-domain",
        brandingConfidence: "high"
      };
    }

    return {
      domain: usableDomain,
      logo: buildGoogleFaviconUrl(usableDomain),
      brandingSource: "google-favicon-domain",
      brandingConfidence: "medium"
    };
  }

  const nameLogo = buildLogoDevNameUrl(company.name);

  if (nameLogo) {
    return {
      domain: null,
      logo: nameLogo,
      brandingSource: "logo-dev-name",
      brandingConfidence: "medium"
    };
  }

  return {
    domain: null,
    logo: null,
    brandingSource: "none",
    brandingConfidence: "low"
  };
}

module.exports = {
  normalizeDomain,
  extractDomainFromUrl,
  buildLogoDevDomainUrl,
  buildLogoDevNameUrl,
  buildGoogleFaviconUrl,
  shouldAcceptCompanyLogo,
  isTrustedStoredLogo,
  resolveBranding
};
