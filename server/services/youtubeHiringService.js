const axios = require("axios");
const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const getCoords = require("../utils/geocode");
const { isGarbageCompanyName } = require("../utils/companyNameValidator");
const { upsertIngestedJob } = require("../utils/jobPersistence");

// ─── Fresher-drive signal detection ───────────────────────────────────────────
// A video that mentions any of these is treated as a fresher/entry-level drive,
// so jobs extracted from it are stamped experienceLevel = "fresher".
const FRESHER_SIGNAL_RE = new RegExp(
  [
    "\\bfreshers?\\b",
    "\\boff[\\s-]?campus\\b",
    "\\bon[\\s-]?campus\\b",
    "\\bcampus\\s+(?:drive|hiring|placement)",
    "\\bgraduate\\s+(?:trainee|hiring|program|programme)",
    "\\btrainee\\b",
    "\\bentry[\\s-]?level\\b",
    "\\bnqt\\b", // TCS National Qualifier Test
    "\\b20\\d{2}\\s+batch\\b", // "2024 batch", "2025 batch"
    "\\bbatch\\s+20\\d{2}\\b",
    "\\b0\\s*[-–]\\s*[12]\\s*(?:year|yr)",
    "\\bnew\\s+grad",
    "\\bjunior\\b"
  ].join("|"),
  "i"
);

function isFresherDrive(title, description) {
  return FRESHER_SIGNAL_RE.test(`${title}\n${description}`);
}

// ─── Channel config ───────────────────────────────────────────────────────────
// Add more channels here over time. handle = YouTube @handle or channel ID.
const WATCHED_CHANNELS = [
  { handle: "LokeshBagora", label: "Lokesh Bagora" },
  { handle: "knacademy20", label: "KN Academy" },
  { handle: "ashishcode",  label: "Ashish Code" }
];

const MAX_VIDEOS_PER_CHANNEL = 30;  // how many recent videos to scan per run
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

// ─── URL patterns that indicate a direct ATS or careers page ─────────────────
const ATS_PATTERNS = [
  { re: /boards\.greenhouse\.io\/([a-z0-9-]+)/i,     provider: "greenhouse",      base: "https://boards.greenhouse.io" },
  { re: /jobs\.lever\.co\/([a-z0-9-]+)/i,            provider: "lever",           base: "https://jobs.lever.co" },
  { re: /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i,         provider: "ashby",           base: "https://jobs.ashbyhq.com" },
  { re: /careers\.smartrecruiters\.com\/([A-Za-z0-9-]+)/i, provider: "smartrecruiters", base: "https://careers.smartrecruiters.com" },
  { re: /([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com/i,  provider: "workday",         base: null },
];

// Aggregator domains to skip — links here add no value
const AGGREGATOR_DOMAINS = new Set([
  "naukri.com", "linkedin.com", "indeed.com", "glassdoor.com",
  "unstop.com", "internshala.com", "shine.com", "foundit.in",
  "monster.com", "apna.co", "freshersworld.com", "cutshort.io",
  "wellfound.com", "angel.co", "timesjobs.com", "hirist.com",
  "newoffcampusjobs.com", "offcampusjobs4u.com", "freshersvoice.com"
]);

// ─── YouTube API helpers ──────────────────────────────────────────────────────

async function resolveChannelId(handle) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  // Try @handle lookup first
  try {
    const res = await axios.get(`${YOUTUBE_API_BASE}/channels`, {
      params: { part: "id,snippet", forHandle: handle, key: apiKey },
      timeout: 10000
    });
    const channel = res.data?.items?.[0];
    if (channel) return { id: channel.id, title: channel.snippet?.title };
  } catch {}

  // Fallback: search by name
  try {
    const res = await axios.get(`${YOUTUBE_API_BASE}/search`, {
      params: { part: "snippet", q: handle, type: "channel", maxResults: 1, key: apiKey },
      timeout: 10000
    });
    const item = res.data?.items?.[0];
    if (item) return { id: item.snippet?.channelId, title: item.snippet?.channelTitle };
  } catch {}

  return null;
}

async function fetchRecentVideoIds(channelId, maxResults) {
  try {
    const res = await axios.get(`${YOUTUBE_API_BASE}/search`, {
      params: {
        part: "id,snippet",
        channelId,
        order: "date",
        type: "video",
        maxResults,
        key: process.env.YOUTUBE_API_KEY
      },
      timeout: 10000
    });
    return (res.data?.items || []).map(item => ({
      videoId: item.id?.videoId,
      title:   item.snippet?.title || "",
      publishedAt: item.snippet?.publishedAt
    })).filter(v => v.videoId);
  } catch (e) {
    console.log(`[YOUTUBE] Failed to fetch video list: ${e.message}`);
    return [];
  }
}

async function fetchVideoDescriptions(videoIds) {
  try {
    const res = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
      params: {
        part: "snippet",
        id: videoIds.join(","),
        key: process.env.YOUTUBE_API_KEY
      },
      timeout: 10000
    });
    return (res.data?.items || []).map(item => ({
      videoId:     item.id,
      title:       item.snippet?.title || "",
      description: item.snippet?.description || "",
      publishedAt: item.snippet?.publishedAt
    }));
  } catch (e) {
    console.log(`[YOUTUBE] Failed to fetch descriptions: ${e.message}`);
    return [];
  }
}

// ─── Signal extraction ────────────────────────────────────────────────────────

function isAggregatorUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return AGGREGATOR_DOMAINS.has(host) ||
      [...AGGREGATOR_DOMAINS].some(d => host.endsWith("." + d));
  } catch { return false; }
}

function extractUrls(text) {
  const urlRe = /https?:\/\/[^\s\)"'<>\]]+/gi;
  return [...new Set((text.match(urlRe) || []).map(u => u.replace(/[.,;:!?]+$/, "")))];
}

// Strip trailing batch years, "off campus", and other noise the title patterns
// accidentally capture as part of the company name.
//   "Accenture 2026"      → "Accenture"
//   "Wipro 2026 2025"     → "Wipro"
//   "Concentrix Direct Test" → "Concentrix"
// Phrases that are never real company names — if the cleaned result is one of
// these (or starts with one), reject it.
const NON_COMPANY_PHRASES = [
  "direct test", "the easiest way", "reality of", "how to", "best way",
  "top companies", "is the job", "remote job", "off campus", "mass hiring"
];

function cleanExtractedCompanyName(raw) {
  let name = raw.trim();
  // Remove trailing 4-digit years (one or more, space-separated)
  name = name.replace(/(?:\s+20\d{2}){1,}\s*$/g, "");
  // Remove trailing filler/noise words (repeatedly, to strip "Finally Hiring" etc.)
  const FILLER = "batch|freshers?|off\\s*campus|mass|direct\\s+test|hiring|drive|finally|announced|update|now|apply|interns?|apprentice|biggest|latest|new|multiple|opportunities|challenge";
  const fillerRe = new RegExp(`\\s+(?:${FILLER})\\s*$`, "gi");
  // Strip repeatedly to handle "Kyndryl Biggest Hiring" → "Kyndryl"
  let prev;
  do { prev = name; name = name.replace(fillerRe, "").trim(); } while (name !== prev);
  return name.trim();
}

function isValidCompanyName(name) {
  if (!name || name.length < 2) return false;
  const lower = name.toLowerCase();
  // Reject if it matches or starts with a known non-company phrase
  if (NON_COMPANY_PHRASES.some(p => lower === p || lower.startsWith(p))) return false;
  // Reject titles that are clearly sentences (too many words)
  if (name.split(/\s+/).length > 4) return false;
  return true;
}

function extractCompanyNamesFromTitle(title) {
  // Patterns like "X is hiring", "X hiring freshers", "apply at X", "X careers"
  const patterns = [
    /^([A-Z][A-Za-z0-9\s&.]{1,40}?)\s+(?:is\s+)?hiring/i,
    /^([A-Z][A-Za-z0-9\s&.]{1,40}?)\s+(?:off\s*campus|recruitment|careers?|jobs?)\b/i,
    /apply\s+(?:at|for|to)\s+([A-Z][A-Za-z0-9\s&.]{1,40}?)[\s|,]/i,
  ];
  const names = [];
  for (const re of patterns) {
    const m = title.match(re);
    if (m?.[1]) {
      const name = cleanExtractedCompanyName(m[1]);
      if (isValidCompanyName(name) && !isGarbageCompanyName(name)) names.push(name);
    }
  }
  return names;
}

function classifyUrl(url) {
  if (isAggregatorUrl(url)) return { type: "aggregator" };

  for (const { re, provider, base } of ATS_PATTERNS) {
    const m = url.match(re);
    if (m) {
      const slug = m[1].toLowerCase();
      const boardUrl = provider === "workday"
        ? `https://${m[0].split("/")[0]}`
        : `${base}/${slug}`;
      return { type: "ats", provider, slug, boardUrl };
    }
  }

  // Generic careers page — still worth noting the company
  if (/\/careers?|\/jobs?|\/join-us|\/work-with-us/i.test(url)) {
    return { type: "careers", url };
  }

  return { type: "unknown" };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function registerDiscoveredATS({ slug, provider, boardUrl, companyName }) {
  const normalized = normalizeCompanyName(companyName || slug);
  if (!normalized) return false;

  let company = await Company.findOne({ name: normalized });
  if (!company) {
    const coords = await getCoords("India");
    company = await Company.create({
      name: normalized,
      logo: null,
      careersUrl: boardUrl,
      careersProvider: provider,
      discoverySources: ["youtube"],
      intelligenceStatus: "direct-source-linked",
      source: "youtube",
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      lastIntelligenceAt: new Date()
    });
    console.log(`[YOUTUBE] New company registered: ${normalized} (${provider})`);
  }

  const existing = await CareerSource.findOne({ company: company._id, provider, boardUrl });
  if (!existing) {
    await CareerSource.create({
      company: company._id,
      companyName: normalized,
      provider,
      boardUrl,
      discoveryMethod: "youtube-hiring-video",
      status: "active"
    });
    return true;
  }
  return false;
}

// ─── Create a fresher job directly from a video's apply link ─────────────────

async function createFresherJob({ companyName, applyLink, title, isFresher }) {
  const normalized = normalizeCompanyName(companyName);
  if (!normalized || isGarbageCompanyName(companyName)) return false;

  let company = await Company.findOne({ name: normalized });
  if (!company) {
    const coords = await getCoords("India");
    company = await Company.create({
      name: normalized,
      logo: null,
      careersUrl: applyLink,
      discoverySources: ["youtube"],
      intelligenceStatus: "pending",
      source: "youtube",
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      lastIntelligenceAt: new Date()
    });
    console.log(`[YOUTUBE] New fresher company: ${normalized}`);
  }

  const job = await upsertIngestedJob({
    title,
    company: company._id,
    location: "India",
    applyLink,
    description: null,
    source: "youtube",
    postedDate: new Date(),
    isRemote: false,
    // Stamp fresher level so it lands in the Fresher tab
    ...(isFresher ? { yearsMin: 0, yearsMax: 1 } : {})
  });

  // upsertIngestedJob may not persist experienceLevel from years alone — set it
  // explicitly so the Fresher tab filter matches without relying on display-time logic.
  if (isFresher && job?._id) {
    const Job = require("../models/Job");
    await Job.findByIdAndUpdate(job._id, { $set: { experienceLevel: "fresher" } }).catch(() => {});
  }

  return true;
}

// ─── Process a single video ───────────────────────────────────────────────────

async function processVideo({ title, description, publishedAt, videoId }) {
  const signals = { atsFound: 0, fresherJobs: 0, companiesNoted: [] };

  const allText = `${title}\n${description}`;
  const urls = extractUrls(allText);
  const companyNames = extractCompanyNamesFromTitle(title);
  const fresher = isFresherDrive(title, description);

  for (const url of urls) {
    const classified = classifyUrl(url);

    if (classified.type === "ats") {
      const registered = await registerDiscoveredATS({
        slug:        classified.slug,
        provider:    classified.provider,
        boardUrl:    classified.boardUrl,
        companyName: companyNames[0] || classified.slug
      });
      if (registered) signals.atsFound++;
    }

    // For fresher drives, also create a direct job from the careers/apply link
    // so it surfaces immediately in the Fresher tab (not just registered for
    // later ingestion).
    if (fresher && (classified.type === "ats" || classified.type === "careers") && companyNames.length) {
      try {
        const created = await createFresherJob({
          companyName: companyNames[0],
          applyLink:   url,
          title:       `${companyNames[0]} — Freshers Hiring`,
          isFresher:   true
        });
        if (created) signals.fresherJobs++;
      } catch (e) {
        console.log(`[YOUTUBE] Fresher job create failed: ${e.message}`);
      }
    }
  }

  if (companyNames.length) signals.companiesNoted.push(...companyNames);

  return signals;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function runYoutubeHiringDiscovery() {
  if (!process.env.YOUTUBE_API_KEY) {
    console.log("[YOUTUBE] Skipped — YOUTUBE_API_KEY not set");
    return { channelsScanned: 0, videosScanned: 0, newSources: 0 };
  }

  console.log(`[YOUTUBE] Starting hiring discovery across ${WATCHED_CHANNELS.length} channel(s)`);

  let totalVideos = 0;
  let totalNewSources = 0;
  let totalFresherJobs = 0;

  for (const channel of WATCHED_CHANNELS) {
    console.log(`[YOUTUBE] Processing channel: ${channel.label} (@${channel.handle})`);

    const resolved = await resolveChannelId(channel.handle);
    if (!resolved?.id) {
      console.log(`[YOUTUBE] Could not resolve channel: ${channel.handle}`);
      continue;
    }

    console.log(`[YOUTUBE] Resolved: "${resolved.title}" (${resolved.id})`);

    const videos = await fetchRecentVideoIds(resolved.id, MAX_VIDEOS_PER_CHANNEL);
    if (!videos.length) {
      console.log(`[YOUTUBE] No videos found for ${channel.label}`);
      continue;
    }

    // Fetch descriptions in batches of 50 (YouTube API limit)
    const BATCH = 50;
    const detailed = [];
    for (let i = 0; i < videos.length; i += BATCH) {
      const batch = videos.slice(i, i + BATCH);
      const details = await fetchVideoDescriptions(batch.map(v => v.videoId));
      detailed.push(...details);
    }

    console.log(`[YOUTUBE] Scanning ${detailed.length} videos from ${channel.label}`);

    for (const video of detailed) {
      try {
        const signals = await processVideo(video);
        totalNewSources += signals.atsFound;
        totalFresherJobs += signals.fresherJobs;
        if (signals.atsFound > 0 || signals.fresherJobs > 0 || signals.companiesNoted.length > 0) {
          console.log(
            `[YOUTUBE] "${video.title.slice(0, 60)}" ` +
            `→ ${signals.atsFound} ATS | ${signals.fresherJobs} fresher jobs | companies: ${signals.companiesNoted.join(", ") || "none"}`
          );
        }
      } catch (e) {
        console.log(`[YOUTUBE] Failed processing video ${video.videoId}: ${e.message}`);
      }
    }

    totalVideos += detailed.length;
  }

  console.log(`[YOUTUBE] Done | videos scanned: ${totalVideos} | new ATS sources: ${totalNewSources} | fresher jobs: ${totalFresherJobs}`);
  return { channelsScanned: WATCHED_CHANNELS.length, videosScanned: totalVideos, newSources: totalNewSources, fresherJobs: totalFresherJobs };
}

module.exports = { runYoutubeHiringDiscovery };
