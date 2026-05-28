require("dotenv").config();

const connectDB = require("../config/db");
const Company = require("../models/Company");
const Job = require("../models/Job");
const CareerSource = require("../models/CareerSource");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const {
  cleanCompanyName,
  fromHost,
  isGenericCompanyName
} = require("../utils/cleanCompanyName");
const { detectCareerProvider } = require("../utils/careerProviderDetector");
const { searchOfficialWebsite } = require("../utils/tavilySearchResolver");
const {
  resolveCompanyWithOpenRouter
} = require("../utils/openrouterResolver");

const BLOCKED_HOST_PATTERNS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "glassdoor.co.in",
  "naukri.com",
  "monsterindia.com",
  "foundit.in",
  "foundit.com",
  "timesjobs.com",
  "shine.com",
  "apna.co",
  "internshala.com",
  "wellfound.com",
  "angel.co",
  "cutshort.io",
  "hirist.tech",
  "workindia.in",
  "simplyhired.co.in",
  "ziprecruiter.com",
  "ambitionbox.com",
  "topstartups.io",
  "freshersworld.com",
  "monster.com",
  "careers-page.com",
  "tracxn.com",
  "crunchbase.com",
  "jobs.",
  "careers.",
  "boards."
];

const BAD_NAME_TOKENS = new Set([
  "job",
  "jobs",
  "vacancy",
  "vacancies",
  "opening",
  "openings",
  "hiring",
  "fresher",
  "freshers",
  "salary",
  "walkin",
  "walk",
  "urgent"
]);

const BLOCKED_NAME_TOKENS = new Set([
  "linkedin",
  "indeed",
  "glassdoor",
  "naukri",
  "monster",
  "foundit",
  "shine",
  "apna",
  "internshala",
  "wellfound",
  "angel",
  "cutshort",
  "hirist",
  "workindia",
  "simplyhired",
  "ziprecruiter",
  "ambitionbox",
  "topstartups",
  "freshersworld",
  "crunchbase",
  "tracxn"
]);

function normalizeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHost(hostname) {
  if (!hostname) {
    return true;
  }

  return BLOCKED_HOST_PATTERNS.some((pattern) => hostname.includes(pattern));
}

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferNameFromProviderUrl(url, provider) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split("/").filter(Boolean);

    if (["lever", "greenhouse", "ashby", "smartrecruiters", "workable", "jobvite"].includes(provider)) {
      return titleCase((path[0] || "").replace(/[-_]+/g, " "));
    }

    if (["workday", "teamtailor", "recruitee", "bamboohr", "icims", "taleo", "personio"].includes(provider)) {
      return titleCase(parsed.hostname.split(".")[0].replace(/[-_]+/g, " "));
    }
  } catch {
    return null;
  }

  return null;
}

function looksInvalidName(value) {
  const name = String(value || "").toLowerCase().trim();

  if (!name) {
    return true;
  }

  const words = name
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return true;
  }

  if (/^\d+\s+/.test(name)) {
    return true;
  }

  if (words.some((word) => BAD_NAME_TOKENS.has(word))) {
    return true;
  }

  if (words.some((word) => BLOCKED_NAME_TOKENS.has(word))) {
    return true;
  }

  const numericWords = words.filter((word) => /^\d+$/.test(word)).length;
  if (numericWords > 0 && numericWords >= Math.ceil(words.length / 2)) {
    return true;
  }

  return false;
}

function normalizeCandidateName(value, fallback = null) {
  const cleaned = cleanCompanyName(value, fallback, { allowUnknown: false });
  const normalized = normalizeCompanyName(cleaned);

  if (!normalized || looksInvalidName(normalized) || isGenericCompanyName(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeCandidateNameFromDomain(domain) {
  const hostName = fromHost(String(domain || "").toLowerCase().replace(/^www\./, ""));

  if (!hostName) {
    return null;
  }

  return normalizeCandidateName(hostName);
}

function confidenceScoreFromLabel(confidence) {
  if (confidence === "high") return 12;
  if (confidence === "medium") return 9;
  return 0;
}

function readFlagValue(flagName) {
  const prefix = `${flagName}=`;
  const flag = process.argv.find((arg) => arg.startsWith(prefix));

  if (!flag) {
    return null;
  }

  return flag.slice(prefix.length);
}

function groupByCompanyId(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = String(row.company || "");

    if (!key) {
      continue;
    }

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(row);
  }

  return grouped;
}

function addCandidate(map, rawName, score, reason, fallback = null, meta = {}) {
  const normalized = normalizeCandidateName(rawName, fallback);

  if (!normalized) {
    return;
  }

  const existing = map.get(normalized) || {
    name: normalized,
    score: 0,
    reasons: [],
    reasonKeys: new Set(),
    providerSignals: 0,
    hostSignals: 0,
    preferredDomain: null
  };

  if (!existing.reasonKeys.has(reason)) {
    existing.score += score;
    existing.reasons.push(reason);
    existing.reasonKeys.add(reason);
  }

  if (
    reason.startsWith("provider") ||
    reason.startsWith("job apply link provider") ||
    reason.startsWith("job board url") ||
    reason.startsWith("tavily") ||
    reason.startsWith("openrouter")
  ) {
    existing.providerSignals += 1;
  }

  if (reason.includes("host")) {
    existing.hostSignals += 1;
  }

  if (!existing.preferredDomain && meta.domain) {
    existing.preferredDomain = meta.domain;
  }

  map.set(normalized, existing);
}

function pickBestCandidate(candidateMap) {
  const candidates = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return null;
  }

  const top = candidates[0];
  const hasStrongProviderEvidence = top.providerSignals > 0;
  const hasStrongHostConsensus = top.hostSignals >= 2 && top.score >= 12;

  if (top.score < 8) {
    return null;
  }

  if (!hasStrongProviderEvidence && !hasStrongHostConsensus) {
    return null;
  }

  return top;
}

async function inferCompanyName(company, relatedData = {}, options = {}) {
  const candidateMap = new Map();
  const useAi = Boolean(options.useAi);
  const aiBudget = Math.max(Number(options.aiBudget || 0), 0);
  let usedAi = false;
  const careerSources = relatedData.careerSources || [];
  const jobs = relatedData.jobs || [];

  const domainsToCheck = [company.domain, company.website, company.careersUrl];

  for (const fieldValue of domainsToCheck) {
    const hostname =
      normalizeHost(fieldValue) ||
      String(fieldValue || "").toLowerCase().replace(/^www\./, "");

    if (!hostname || isBlockedHost(hostname)) {
      continue;
    }

    const hostName = fromHost(hostname);
    if (hostName) {
      addCandidate(candidateMap, hostName, 2, `company host ${hostname}`, hostname, {
        domain: hostname
      });
    }
  }

  for (const source of careerSources) {
    if (source.companyName) {
      addCandidate(candidateMap, source.companyName, 4, `career source name ${source.provider}`);
    }

    const urls = [source.boardUrl, source.careersUrl].filter(Boolean);

    for (const url of urls) {
      const inferredFromProvider = inferNameFromProviderUrl(url, source.provider);
      if (inferredFromProvider) {
        addCandidate(candidateMap, inferredFromProvider, 8, `provider url ${source.provider}`);
      }

      const hostname = normalizeHost(url);
      if (hostname && !isBlockedHost(hostname)) {
        const hostName = fromHost(hostname);
        if (hostName) {
          addCandidate(candidateMap, hostName, 3, `career source host ${hostname}`, hostname, {
            domain: hostname
          });
        }
      }
    }
  }

  for (const job of jobs) {
    if (!job.applyLink) {
      continue;
    }

    const detected = detectCareerProvider(job.applyLink);

    if (detected?.companySlug) {
      addCandidate(
        candidateMap,
        detected.companySlug.replace(/[-_]+/g, " "),
        7,
        `job apply link provider ${detected.provider}`,
        null,
        {
          domain: normalizeHost(detected.boardUrl)
        }
      );
    }

    if (detected?.provider && detected?.boardUrl) {
      const inferredFromBoard = inferNameFromProviderUrl(
        detected.boardUrl,
        detected.provider
      );

      if (inferredFromBoard) {
        addCandidate(candidateMap, inferredFromBoard, 7, `job board url ${detected.provider}`);
      }
    }

    const hostname = normalizeHost(job.applyLink);
    if (hostname && !isBlockedHost(hostname)) {
      const hostName = fromHost(hostname);
      if (hostName) {
        addCandidate(candidateMap, hostName, 2, `job host ${hostname}`, hostname, {
          domain: hostname
        });
      }
    }
  }

  const aiEligible =
    useAi &&
    aiBudget > 0 &&
    (candidateMap.size === 0 || Array.from(candidateMap.values()).every((entry) => entry.score < 8));

  if (aiEligible) {
    if (process.env.TAVILY_API_KEY) {
      try {
        const tavilyResult = await searchOfficialWebsite(company, jobs);

        if (tavilyResult?.officialDomain) {
          const domainName = normalizeCandidateNameFromDomain(tavilyResult.officialDomain);

          if (domainName) {
            addCandidate(
              candidateMap,
              domainName,
              tavilyResult.confidence === "high" ? 12 : 9,
              `tavily official domain ${tavilyResult.officialDomain}`,
              null,
              {
                domain: tavilyResult.officialDomain
              }
            );
          }
        }
      } catch {
        // Ignore search failures and continue to the next resolver.
      }
    }

    if (process.env.OPENROUTER_API_KEY) {
      try {
        const openRouterResult = await resolveCompanyWithOpenRouter(company, jobs);

        if (openRouterResult?.officialCompanyName) {
          const openRouterName = normalizeCandidateName(
            openRouterResult.officialCompanyName,
            company.name
          );

          if (openRouterName) {
            addCandidate(
              candidateMap,
              openRouterName,
              confidenceScoreFromLabel(openRouterResult.confidence),
              `openrouter company name ${openRouterResult.confidence || "low"}`
            );
          }
        }

        if (openRouterResult?.officialDomain) {
          const domainName = normalizeCandidateNameFromDomain(openRouterResult.officialDomain);

          if (domainName) {
            addCandidate(
              candidateMap,
              domainName,
              confidenceScoreFromLabel(openRouterResult.confidence) + 1,
              `openrouter official domain ${openRouterResult.officialDomain}`,
              null,
              {
                domain: openRouterResult.officialDomain
              }
            );
          }
        }
      } catch {
        // Keep the repair job moving; unresolved records remain untouched.
      }
    }

    usedAi = candidateMap.size > 0;
  }

  return {
    best: pickBestCandidate(candidateMap),
    usedAi
  };
}

async function repairInvalidCompanyNames({ apply = false, scope = "web-search" } = {}) {
  const baseFilter =
    scope === "all"
      ? {}
      : {
          $or: [{ source: "web-search" }, { discoverySources: "web-search" }]
        };

  const companies = await Company.find(baseFilter)
    .select("name domain website careersUrl source discoverySources intelligenceStatus")
    .sort({ createdAt: -1 });

  const companyIds = companies.map((company) => company._id);

  const [careerSourceRows, jobRows] = await Promise.all([
    CareerSource.find({ company: { $in: companyIds } })
      .select("company provider boardUrl careersUrl companyName")
      .lean(),
    Job.find({ company: { $in: companyIds } })
      .select("company applyLink source")
      .lean()
  ]);

  const careerSourcesByCompany = groupByCompanyId(careerSourceRows);
  const jobsByCompany = groupByCompanyId(jobRows);

  let scanned = 0;
  let invalidCandidates = 0;
  let renameCandidates = 0;
  let renamed = 0;
  let conflictSkipped = 0;
  let unresolved = 0;

  const useAi =
    process.argv.includes("--with-ai") ||
    process.env.REPAIR_COMPANY_NAMES_USE_AI === "true";

  let remainingAiBudget = Math.max(
    Number(readFlagValue("--ai-budget") || process.env.REPAIR_COMPANY_NAMES_AI_BUDGET || 0),
    0
  );

  for (const company of companies) {
    scanned += 1;

    if (!looksInvalidName(company.name) && !isGenericCompanyName(company.name)) {
      continue;
    }

    invalidCandidates += 1;

    const inferredResult = await inferCompanyName(
      company,
      {
        careerSources: careerSourcesByCompany.get(String(company._id)) || [],
        jobs: jobsByCompany.get(String(company._id)) || []
      },
      {
      useAi,
      aiBudget: remainingAiBudget
      }
    );

    if (inferredResult.usedAi && remainingAiBudget > 0) {
      remainingAiBudget -= 1;
    }

    const inferred = inferredResult.best;

    if (!inferred || inferred.name === company.name) {
      unresolved += 1;
      continue;
    }

    renameCandidates += 1;

    const conflicting = await Company.findOne({
      name: inferred.name,
      _id: {
        $ne: company._id
      }
    }).select("_id name");

    if (conflicting) {
      conflictSkipped += 1;
      console.log(
        `[REPAIR CONFLICT] ${company.name} -> ${inferred.name} | existing id ${conflicting._id}`
      );
      continue;
    }

    if (!apply) {
      continue;
    }

    const oldName = company.name;
    company.name = inferred.name;

    if (inferred.preferredDomain && !isBlockedHost(inferred.preferredDomain)) {
      company.domain = company.domain || inferred.preferredDomain;
      company.website = company.website || `https://${inferred.preferredDomain}`;
    }

    company.intelligenceStatus = "website-known";
    company.lastIntelligenceAt = new Date();
    company.updatedAt = new Date();
    await company.save();

    await CareerSource.updateMany(
      {
        company: company._id
      },
      {
        $set: {
          companyName: inferred.name,
          updatedAt: new Date()
        }
      }
    );

    renamed += 1;

    console.log(
      `[REPAIR] ${oldName} -> ${inferred.name} | score ${inferred.score} | ${inferred.reasons.slice(0, 3).join("; ")}`
    );
  }

  return {
    scanned,
    invalidCandidates,
    renameCandidates,
    renamed,
    conflictSkipped,
    unresolved
  };
}

async function run() {
  await connectDB();

  const apply = process.argv.includes("--apply");
  const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="));
  const scope = (scopeArg ? scopeArg.split("=")[1] : "web-search") || "web-search";

  const summary = await repairInvalidCompanyNames({
    apply,
    scope
  });

  console.log(
    `[REPAIR COMPANY NAMES] apply=${apply} scope=${scope} | scanned ${summary.scanned} | invalid ${summary.invalidCandidates} | rename candidates ${summary.renameCandidates} | renamed ${summary.renamed} | conflicts ${summary.conflictSkipped} | unresolved ${summary.unresolved}`
  );

  process.exit(0);
}

run().catch((error) => {
  console.error("[REPAIR COMPANY NAMES] Failed");
  console.error(error.message);
  process.exit(1);
});
