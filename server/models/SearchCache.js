const mongoose = require("mongoose");

// Write-through cache for skill-based search results.
// Keyed by a deterministic hash of (domain + primarySkills + secondarySkills + roles).
// TTL index expires documents automatically after 2 hours.
const searchCacheSchema = new mongoose.Schema({
  cacheKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Serialized snapshot of search results (array of company objects)
  results: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },

  // Original query params so we can log/debug what produced this cache entry
  queryMeta: {
    domain: String,
    primarySkills: [String],
    secondarySkills: [String],
    roles: [String]
  },

  hitCount: {
    type: Number,
    default: 0
  },

  createdAt: {
    type: Date,
    default: Date.now,
    expires: 7200   // 2-hour TTL — MongoDB drops the document automatically
  }
});

module.exports = mongoose.model("SearchCache", searchCacheSchema);
