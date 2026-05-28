const ATS_PROVIDERS = [
  {
    provider: "lever",
    match: (hostname) => hostname === "jobs.lever.co",
    buildBoardUrl: (parsed, pathSegments) =>
      pathSegments[0] ? `https://jobs.lever.co/${pathSegments[0]}` : null,
    getCompanySlug: (pathSegments) => cleanSlug(pathSegments[0]) || null
  },
  {
    provider: "greenhouse",
    match: (hostname) => hostname === "boards.greenhouse.io",
    buildBoardUrl: (parsed, pathSegments) =>
      pathSegments[0] ? `https://boards.greenhouse.io/${pathSegments[0]}` : null,
    getCompanySlug: (pathSegments) => cleanSlug(pathSegments[0]) || null
  },
  {
    provider: "ashby",
    match: (hostname) => hostname === "jobs.ashbyhq.com",
    buildBoardUrl: (parsed, pathSegments) =>
      pathSegments[0] ? `https://jobs.ashbyhq.com/${pathSegments[0]}` : null,
    getCompanySlug: (pathSegments) => cleanSlug(pathSegments[0]) || null
  },
  {
    provider: "smartrecruiters",
    match: (hostname) =>
      hostname === "jobs.smartrecruiters.com" ||
      hostname === "careers.smartrecruiters.com",
    buildBoardUrl: (parsed, pathSegments) =>
      pathSegments[0]
        ? `https://jobs.smartrecruiters.com/${pathSegments[0]}`
        : null,
    getCompanySlug: (pathSegments) => cleanSlug(pathSegments[0]) || null
  },
  {
    provider: "workday",
    match: (hostname) => hostname.endsWith(".myworkdayjobs.com"),
    buildBoardUrl: (parsed, pathSegments) => {
      const localeIndex = pathSegments.findIndex((segment) =>
        /^[a-z]{2}-[A-Z]{2}$/i.test(segment)
      );

      if (localeIndex < 0 || !pathSegments[localeIndex + 1]) {
        return null;
      }

      return `${parsed.origin}/${pathSegments[localeIndex]}/${pathSegments[localeIndex + 1]}`;
    },
    getCompanySlug: (pathSegments, parsed) => parsed.hostname.split(".")[0] || null
  },
  {
    provider: "teamtailor",
    match: (hostname) => hostname.endsWith(".teamtailor.com"),
    buildBoardUrl: (parsed) => `${parsed.origin}`,
    getCompanySlug: (_, parsed) => parsed.hostname.split(".")[0] || null
  },
  {
    provider: "recruitee",
    match: (hostname) => hostname.endsWith(".recruitee.com"),
    buildBoardUrl: (parsed) => `${parsed.origin}`,
    getCompanySlug: (_, parsed) => parsed.hostname.split(".")[0] || null
  },
  {
    provider: "workable",
    match: (hostname) =>
      hostname === "apply.workable.com" || hostname.endsWith(".workable.com"),
    buildBoardUrl: (parsed, pathSegments) =>
      pathSegments[0] ? `${parsed.origin}/${pathSegments[0]}` : `${parsed.origin}`,
    getCompanySlug: (pathSegments, parsed) =>
      cleanSlug(pathSegments[0]) || cleanSlug(parsed.hostname.split(".")[0]) || null
  },
  {
    provider: "jobvite",
    match: (hostname) => hostname.endsWith(".jobvite.com"),
    buildBoardUrl: (parsed, pathSegments) =>
      pathSegments[0] ? `${parsed.origin}/${pathSegments[0]}` : `${parsed.origin}`,
    getCompanySlug: (pathSegments, parsed) =>
      cleanSlug(pathSegments[0]) || cleanSlug(parsed.hostname.split(".")[0]) || null
  },
  {
    provider: "bamboohr",
    match: (hostname) => hostname.endsWith(".bamboohr.com"),
    buildBoardUrl: (parsed) => `${parsed.origin}`,
    getCompanySlug: (_, parsed) => cleanSlug(parsed.hostname.split(".")[0]) || null
  },
  {
    provider: "icims",
    match: (hostname) => hostname.includes("icims.com"),
    buildBoardUrl: (parsed) => `${parsed.origin}`,
    getCompanySlug: (_, parsed) => cleanSlug(parsed.hostname.split(".")[0]) || null
  },
  {
    provider: "taleo",
    match: (hostname) => hostname.includes("taleo.net"),
    buildBoardUrl: (parsed) => `${parsed.origin}`,
    getCompanySlug: (_, parsed) => cleanSlug(parsed.hostname.split(".")[0]) || null
  },
  {
    provider: "personio",
    match: (hostname) => hostname.includes("personio.com"),
    buildBoardUrl: (parsed) => `${parsed.origin}`,
    getCompanySlug: (_, parsed) => cleanSlug(parsed.hostname.split(".")[0]) || null
  }
];

const GENERIC_PATH_SEGMENTS = new Set([
  "jobs",
  "job",
  "careers",
  "career",
  "openings",
  "open",
  "work"
]);

function cleanSlug(slug) {
  if (!slug) {
    return null;
  }

  const normalized = String(slug).trim();

  if (!normalized) {
    return null;
  }

  if (GENERIC_PATH_SEGMENTS.has(normalized.toLowerCase())) {
    return null;
  }

  return normalized;
}

function normalizeHostname(hostname) {
  return (hostname || "").replace(/^www\./i, "").toLowerCase();
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function detectATSProvider(url) {
  const parsed = parseUrl(url);

  if (!parsed) {
    return null;
  }

  const hostname = normalizeHostname(parsed.hostname);

  for (const definition of ATS_PROVIDERS) {
    if (!definition.match(hostname, parsed)) {
      continue;
    }

    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const boardUrl = definition.buildBoardUrl(parsed, pathSegments);

    if (!boardUrl) {
      continue;
    }

    return {
      provider: definition.provider,
      boardUrl,
      careersUrl: boardUrl,
      companySlug: definition.getCompanySlug(pathSegments, parsed)
    };
  }

  return null;
}

module.exports = {
  ATS_PROVIDERS,
  detectATSProvider,
  normalizeHostname
};