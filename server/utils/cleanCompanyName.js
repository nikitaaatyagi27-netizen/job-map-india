const GENERIC_TOKENS = new Set([
  "career",
  "careers",
  "jobs",
  "job",
  "search",
  "for",
  "english",
  "sign",
  "in",
  "home",
  "join",
  "our",
  "talent",
  "community",
  "introduce",
  "yourself",
  "page",
  "pages",
  "external",
  "myworkdayjobs",
  "workdayjobs",
  "workday"
]);

const GENERIC_SITE_SEGMENTS = new Set([
  "external",
  "career",
  "careers",
  "jobs",
  "job",
  "apply",
  "recruiting",
  "myworkdayjobs",
  "workdayjobs",
  "workday"
]);

function isGenericHostLabel(value) {
  const cleaned = cleanWord(value);

  if (!cleaned) {
    return true;
  }

  if (/^wd\d+$/i.test(cleaned)) {
    return true;
  }

  return GENERIC_SITE_SEGMENTS.has(cleaned);
}

function toTitleCase(value) {
  return (value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function cleanWord(value) {
  return (value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function extractDomainRoot(value) {
  const match = String(value || "")
    .toLowerCase()
    .match(/\b([a-z0-9-]{2,})\.(com|in|io|co|org|net|ai|tech|dev|app|cloud)\b/i);

  if (!match?.[1]) {
    return null;
  }

  const root = match[1].replace(/[-_]+/g, " ").trim();

  if (isGenericHostLabel(root)) {
    return null;
  }

  return root;
}

function normalizeRawName(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/english\s*sign\s*in/gi, " ")
    .replace(/sign\s*in/gi, " ")
    .replace(/search\s*for\s*jobs?/gi, " ")
    .replace(/careers?\s*home/gi, " ")
    .replace(/join\s*(our\s*)?talent\s*community/gi, " ")
    .replace(/introduce\s*yourself/gi, " ")
    .replace(/[^a-zA-Z0-9&.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getReasonableWords(value) {
  return normalizeRawName(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => {
      const cleaned = cleanWord(word);

      if (!cleaned || cleaned.length < 2) {
        return false;
      }

      return !GENERIC_TOKENS.has(cleaned);
    });
}

function isGenericCompanyName(value) {
  const words = getReasonableWords(value).map((word) => cleanWord(word));

  if (words.length === 0) {
    return true;
  }

  const genericMatches = words.filter((word) => GENERIC_TOKENS.has(word)).length;

  if (genericMatches === words.length) {
    return true;
  }

  const joined = words.join(" ");
  const genericPhrases = [
    "search for jobs",
    "search jobs",
    "sign in",
    "career site",
    "careers site",
    "join our talent community",
    "software companies in india",
    "best tech startup india",
    "opportunities software company"
  ];

  return genericPhrases.some((phrase) => joined.includes(phrase));
}

function fromSiteSegment(site) {
  const words = getReasonableWords(String(site || "").replace(/[-_]+/g, " "));

  if (words.length === 0) {
    return null;
  }

  const cleaned = cleanWord(words.join(""));
  if (isGenericHostLabel(cleaned)) {
    return null;
  }

  return toTitleCase(words.slice(0, 4).join(" "));
}

function fromHost(host) {
  const tenant = String(host || "").split(".")[0] || "";
  const candidate = tenant.replace(/[-_]+/g, " ").trim();

  if (!candidate || isGenericHostLabel(candidate)) {
    return null;
  }

  return toTitleCase(candidate);
}

function cleanCompanyName(rawName, fallback = null, options = {}) {
  const allowUnknown = Boolean(options.allowUnknown);

  const domainRoot = extractDomainRoot(rawName);
  if (domainRoot) {
    return toTitleCase(domainRoot);
  }

  const words = getReasonableWords(rawName);
  if (words.length > 0) {
    return toTitleCase(words.slice(0, 4).join(" "));
  }

  const fallbackWords = getReasonableWords(fallback);
  if (fallbackWords.length > 0) {
    return toTitleCase(fallbackWords.slice(0, 4).join(" "));
  }

  const fallbackDomain = extractDomainRoot(fallback);
  if (fallbackDomain) {
    return toTitleCase(fallbackDomain);
  }

  return allowUnknown ? "Unknown" : null;
}

function cleanCompanyNameOrUnknown(rawName, fallback = null) {
  return cleanCompanyName(rawName, fallback, {
    allowUnknown: true
  });
}

module.exports = {
  cleanCompanyName,
  cleanCompanyNameOrUnknown,
  fromSiteSegment,
  fromHost,
  isGenericCompanyName
};
