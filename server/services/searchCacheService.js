const crypto = require("crypto");
const SearchCache = require("../models/SearchCache");

function buildCacheKey({ domain, primarySkills, secondarySkills, roles }) {
  const normalized = {
    domain: (domain || "other").toLowerCase(),
    primarySkills: [...(primarySkills || [])].map(s => s.toLowerCase()).sort(),
    secondarySkills: [...(secondarySkills || [])].map(s => s.toLowerCase()).sort(),
    roles: [...(roles || [])].map(r => r.toLowerCase()).sort()
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 32);
}

async function getCachedResults({ domain, primarySkills, secondarySkills, roles }) {
  const key = buildCacheKey({ domain, primarySkills, secondarySkills, roles });
  const entry = await SearchCache.findOneAndUpdate(
    { cacheKey: key },
    { $inc: { hitCount: 1 } },
    { returnDocument: "after" }
  );
  if (!entry) return null;
  console.log(`[SEARCH CACHE] HIT key=${key} hits=${entry.hitCount}`);
  return entry.results;
}

async function setCachedResults({ domain, primarySkills, secondarySkills, roles }, results) {
  const key = buildCacheKey({ domain, primarySkills, secondarySkills, roles });
  try {
    await SearchCache.findOneAndUpdate(
      { cacheKey: key },
      {
        $set: {
          results,
          queryMeta: { domain, primarySkills, secondarySkills, roles },
          createdAt: new Date()   // reset TTL on every write
        },
        $setOnInsert: { hitCount: 0 }
      },
      { upsert: true }
    );
    console.log(`[SEARCH CACHE] WRITE key=${key} companies=${results.length}`);
  } catch (err) {
    // Cache write failure must never break the search response
    console.warn("[SEARCH CACHE] Write failed:", err.message);
  }
}

module.exports = { getCachedResults, setCachedResults, buildCacheKey };
