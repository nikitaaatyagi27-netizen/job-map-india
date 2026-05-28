const { normalizeDomain } = require("./brandingResolver");
const { callLLM } = require("./groqClient");

const LEGAL_SUFFIXES = [
  "gmbh",
  "inc",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "technologies",
  "technology",
  "labs",
  "lab",
  "solutions",
  "systems",
  "pvt",
  "private"
];

function stripLegalSuffixes(name) {
  if (!name) return "";

  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !LEGAL_SUFFIXES.includes(part))
    .join(" ")
    .trim();
}

function looksLikeGuessedDomain(company) {
  const normalizedDomain = normalizeDomain(company.domain);
  const strippedName = stripLegalSuffixes(company.name).replace(/\s+/g, "");

  if (!normalizedDomain || !strippedName) return false;

  const root = normalizedDomain.replace(/\.(com|ai|io|co|tech|in|org|net|dev)$/, "");

  return root === company.name?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    root === strippedName ||
    root.includes("gmbh") ||
    root.includes("inc");
}

function parseJsonResponse(text) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fencedMatch ? fencedMatch[1] : text;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function chooseOfficialWebsiteWithOpenRouter(company, candidates = [], jobs = []) {
  if (!candidates.length) return null;

  const sampleRoles = jobs.slice(0, 3).map((job) => ({
    title: job.title,
    location: job.location,
    source: job.source,
    applyLink: job.applyLink
  }));

  const simplifiedCandidates = candidates.slice(0, 8).map((candidate, index) => ({
    index,
    title: candidate.title || null,
    url: candidate.url || null,
    content: candidate.content || null
  }));

  const prompt = [
    "Pick the official company website from these search results.",
    "Be strict and conservative.",
    "Reject job boards, ATS pages, directories, LinkedIn, Crunchbase, and news/profile sites.",
    "Prefer the company's own homepage or main domain.",
    "Return only valid JSON with keys:",
    'selectedIndex, officialDomain, confidence, reasoning',
    'confidence must be one of "high", "medium", "low".',
    "If no result is clearly official, set selectedIndex and officialDomain to null.",
    "",
    JSON.stringify(
      {
        companyName: company.name,
        normalizedCompanyName: stripLegalSuffixes(company.name),
        currentDomain: company.domain || null,
        roles: sampleRoles,
        candidates: simplifiedCandidates
      },
      null,
      2
    )
  ].join("\n");

  const text = await callLLM(
    [
      { role: "system", content: "You choose the official company website from search results and return strict JSON only." },
      { role: "user", content: prompt }
    ],
    { temperature: 0.1, max_tokens: 300 }
  );
  const parsed = parseJsonResponse(text);

  if (!parsed) {
    return null;
  }

  const selectedIndex = Number.isInteger(parsed.selectedIndex)
    ? parsed.selectedIndex
    : null;
  const selectedCandidate =
    selectedIndex !== null ? simplifiedCandidates[selectedIndex] : null;

  return {
    selectedIndex,
    selectedUrl: selectedCandidate?.url || null,
    officialDomain: normalizeDomain(parsed.officialDomain),
    confidence: parsed.confidence || "low",
    reasoning: parsed.reasoning || null
  };
}

async function resolveCompanyWithOpenRouter(company, jobs = []) {
  const sampleRoles = jobs.slice(0, 3).map((job) => ({
    title: job.title,
    location: job.location,
    source: job.source,
    applyLink: job.applyLink
  }));

  const prompt = [
    "Identify the official website domain of a software company from job-data context.",
    "Be strict and conservative.",
    "Strip legal suffixes like gmbh, inc, llc, ltd before reasoning about the brand.",
    "Prefer the real brand domain even if it is .ai, .io, .dev, or another non-.com domain.",
    "Do not return job board or ATS domains.",
    "Return only valid JSON with keys:",
    'officialCompanyName, officialDomain, confidence, reasoning',
    'confidence must be one of "high", "medium", "low".',
    "If unsure, set officialDomain to null.",
    "",
    JSON.stringify(
      {
        companyName: company.name,
        normalizedCompanyName: stripLegalSuffixes(company.name),
        currentDomain: company.domain || null,
        currentLogo: company.logo || null,
        roles: sampleRoles
      },
      null,
      2
    )
  ].join("\n");

  const text = await callLLM(
    [
      { role: "system", content: "You identify official company domains from hiring context and return strict JSON only." },
      { role: "user", content: prompt }
    ],
    { temperature: 0.1, max_tokens: 200 }
  );

  const parsed = parseJsonResponse(text);

  if (!parsed) {
    return null;
  }

  return {
    officialCompanyName: parsed.officialCompanyName || company.name,
    officialDomain: normalizeDomain(parsed.officialDomain),
    confidence: parsed.confidence || "low",
    reasoning: parsed.reasoning || null
  };
}

function isOpenRouterLimitError(error) {
  const status = error?.response?.status;
  const message =
    error?.response?.data?.error?.message ||
    error?.message ||
    "";

  if (status === 429 || status === 402) {
    return true;
  }

  return /quota|rate limit|resource exhausted|too many requests|credits|payment required/i.test(message);
}

module.exports = {
  stripLegalSuffixes,
  looksLikeGuessedDomain,
  chooseOfficialWebsiteWithOpenRouter,
  resolveCompanyWithOpenRouter,
  isOpenRouterLimitError
};
