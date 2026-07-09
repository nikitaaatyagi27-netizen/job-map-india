const axios = require("axios");
const CareerSource = require("../models/CareerSource");
const { isIndianLocation } = require("../utils/indiaLocation");

// Removes dead/duplicate ATS CareerSource registrations:
//   1. DEDUPE — multiple registrations pointing at the same board slug.
//   2. DEAD BOARDS — boards that return jobs but ZERO India jobs (US-only
//      companies whose discovery registered them globally).
//
// Only deletes CareerSource registrations — never the already-ingested Jobs.
// A board that errors / can't be reached is LEFT ALONE (we only remove boards we
// can CONFIRM have 0 India jobs), so a transient outage never deletes a good board.

const PROVIDERS = ["greenhouse", "lever", "ashby", "smartrecruiters"];
const REQUEST_TIMEOUT = 10000;

const slugOf = (url) => (url || "").split("/").filter(Boolean).pop();

async function indiaCount(provider, slug) {
  try {
    if (provider === "greenhouse") {
      const r = await axios.get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, { timeout: REQUEST_TIMEOUT, validateStatus: () => true });
      if (r.status !== 200) return null;
      const jobs = (r.data?.jobs || []).map(j => j.location?.name || "");
      return jobs.filter(l => isIndianLocation(l)).length;
    }
    if (provider === "lever") {
      const r = await axios.get(`https://api.lever.co/v0/postings/${slug}?mode=json`, { timeout: REQUEST_TIMEOUT, validateStatus: () => true });
      if (r.status !== 200) return null;
      const jobs = (Array.isArray(r.data) ? r.data : []).map(j => j.categories?.location || "");
      return jobs.filter(l => isIndianLocation(l)).length;
    }
    if (provider === "ashby") {
      const r = await axios.get(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, { timeout: REQUEST_TIMEOUT, validateStatus: () => true });
      if (r.status !== 200) return null;
      const jobs = (r.data?.jobs || []).map(j => j.location || "");
      return jobs.filter(l => isIndianLocation(l)).length;
    }
    if (provider === "smartrecruiters") {
      const r = await axios.get(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`, { timeout: 12000, validateStatus: () => true });
      if (r.status !== 200) return null;
      const jobs = r.data?.content || [];
      return jobs.filter(j => isIndianLocation(j.location?.city || j.location?.region || j.location?.country || "")).length;
    }
  } catch { return null; }
  return null;
}

/**
 * @param {Object} options
 * @param {boolean} options.dryRun     - if true, report only, delete nothing
 * @param {string[]} options.providers - which providers to clean (default: all)
 * @param {Object}  options.logger     - logger (default console)
 * @returns {{ removed: number, perProvider: Object }}
 */
async function cleanupDeadAtsBoards(options = {}) {
  const dryRun = options.dryRun || false;
  const providers = options.providers || PROVIDERS;
  const logger = options.logger || console;

  let grandRemove = 0;
  const perProvider = {};

  for (const provider of providers) {
    const all = await CareerSource.find({ provider }).select("companyName boardUrl status").lean();
    if (!all.length) continue;

    // 1. Dedupe by slug
    const seen = new Map();
    const dupIds = [];
    for (const s of all) {
      const k = slugOf(s.boardUrl).toLowerCase();
      if (seen.has(k)) dupIds.push(String(s._id));
      else seen.set(k, { id: String(s._id), slug: slugOf(s.boardUrl) });
    }

    // 2. Dead 0-India among unique boards
    const deadIds = [];
    let checked = 0;
    for (const { id, slug } of seen.values()) {
      const india = await indiaCount(provider, slug);
      checked++;
      if (india === 0) deadIds.push(id);
      if (checked % 40 === 0) logger.log(`  [ATS CLEANUP] ${provider}: checked ${checked}/${seen.size}...`);
    }

    const removeIds = [...new Set([...dupIds, ...deadIds])];
    perProvider[provider] = { total: all.length, unique: seen.size, dup: dupIds.length, dead: deadIds.length, remove: removeIds.length };
    grandRemove += removeIds.length;

    logger.log(`[ATS CLEANUP] ${provider}: ${all.length} regs | ${seen.size} unique | ${dupIds.length} dup | ${deadIds.length} dead → ${dryRun ? "would remove" : "removing"} ${removeIds.length}`);

    if (!dryRun && removeIds.length) {
      const res = await CareerSource.deleteMany({ _id: { $in: removeIds } });
      logger.log(`  [ATS CLEANUP] ${provider}: deleted ${res.deletedCount}`);
    }
  }

  logger.log(`[ATS CLEANUP] Total ${dryRun ? "that would be removed" : "removed"}: ${grandRemove}`);
  return { removed: grandRemove, perProvider };
}

module.exports = { cleanupDeadAtsBoards };
