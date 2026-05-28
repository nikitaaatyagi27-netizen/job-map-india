const axios = require("axios");
const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const getCoords = require("../utils/geocode");
const { isGarbageCompanyName } = require("../utils/companyNameValidator");

// ─── Channel config ───────────────────────────────────────────────────────────
// Add more channels here over time. handle = YouTube @handle or channel ID.
const WATCHED_CHANNELS = [
  { handle: "LokeshBagora", label: "Lokesh Bagora" }
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
      const name = m[1].trim();
      if (name.length >= 2 && !isGarbageCompanyName(name)) names.push(name);
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

// ─── Process a single video ───────────────────────────────────────────────────

async function processVideo({ title, description, publishedAt, videoId }) {
  const signals = { atsFound: 0, companiesNoted: [] };

  const allText = `${title}\n${description}`;
  const urls = extractUrls(allText);
  const companyNames = extractCompanyNamesFromTitle(title);

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
        if (signals.atsFound > 0 || signals.companiesNoted.length > 0) {
          console.log(
            `[YOUTUBE] "${video.title.slice(0, 60)}" ` +
            `→ ${signals.atsFound} new ATS sources | companies: ${signals.companiesNoted.join(", ") || "none"}`
          );
        }
      } catch (e) {
        console.log(`[YOUTUBE] Failed processing video ${video.videoId}: ${e.message}`);
      }
    }

    totalVideos += detailed.length;
  }

  console.log(`[YOUTUBE] Done | videos scanned: ${totalVideos} | new ATS sources: ${totalNewSources}`);
  return { channelsScanned: WATCHED_CHANNELS.length, videosScanned: totalVideos, newSources: totalNewSources };
}

module.exports = { runYoutubeHiringDiscovery };
