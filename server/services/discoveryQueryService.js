const DiscoveryQuery = require("../models/DiscoveryQuery");

async function getDiscoveryQueries(kind, fallbackQueries = []) {
  const normalizedKind = String(kind || "").toLowerCase().trim();

  if (!normalizedKind) {
    return [];
  }

  const queries = await DiscoveryQuery.find({
    kind: normalizedKind,
    enabled: true
  })
    .sort({ order: 1, createdAt: 1 })
    .select("query kind order source");

  if (queries.length > 0) {
    return queries;
  }

  return fallbackQueries
    .map((query, index) => ({
      query: String(query || "").trim(),
      kind: normalizedKind,
      order: index + 1,
      source: "fallback"
    }))
    .filter((entry) => entry.query);
}

async function upsertDiscoveryQuery({ kind, query, enabled = true, source = "bootstrap", order = 0 }) {
  const normalizedKind = String(kind || "").toLowerCase().trim();
  const normalizedQuery = String(query || "").trim();

  if (!normalizedKind || !normalizedQuery) {
    return null;
  }

  const now = new Date();

  return DiscoveryQuery.findOneAndUpdate(
    {
      kind: normalizedKind,
      query: normalizedQuery
    },
    {
      $set: {
        enabled,
        source,
        order,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    {
      upsert: true,
      returnDocument: "after"
    }
  );
}

module.exports = {
  getDiscoveryQueries,
  upsertDiscoveryQuery
};
