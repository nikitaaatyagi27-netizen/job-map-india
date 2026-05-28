const SourceHealth = require("../models/SourceHealth");

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function rollingAverage(previous, next, sampleCount) {
  if (sampleCount <= 1) {
    return next;
  }

  return ((previous * (sampleCount - 1)) + next) / sampleCount;
}

function calculateScore(health) {
  const totalRuns = health.successCount + health.failureCount;
  const successRate = totalRuns > 0 ? health.successCount / totalRuns : 0.5;
  const freshnessSignal = Math.min(health.avgNewJobs + (health.avgRefreshedJobs * 0.4), 40);
  const failurePenalty = Math.min(health.consecutiveFailures * 12, 45);
  const rawScore = (successRate * 65) + freshnessSignal - failurePenalty;

  return Math.round(clamp(rawScore, 5, 100));
}

function computeBackoffUntil(consecutiveFailures) {
  if (consecutiveFailures < 3) {
    return null;
  }

  const exponent = Math.min(consecutiveFailures - 3, 4);
  const backoffHours = Math.min(6 * (2 ** exponent), 48);

  return new Date(Date.now() + (backoffHours * 60 * 60 * 1000));
}

async function getSourceHealthMap() {
  const rows = await SourceHealth.find({});
  const result = new Map();

  for (const row of rows) {
    result.set(row.sourceKey, row);
  }

  return result;
}

async function getSourceHealthForApi(limit = 50) {
  return SourceHealth.find({})
    .sort({ score: -1, updatedAt: -1 })
    .limit(limit)
    .select("sourceKey score successCount failureCount consecutiveFailures backoffUntil lastRunAt lastSuccessAt lastFailureAt lastError avgNewJobs avgRefreshedJobs avgDurationMs");
}

async function registerSourceSuccess(sourceKey, metrics = {}) {
  const now = new Date();
  const key = String(sourceKey || "").toLowerCase().trim();

  if (!key) {
    return null;
  }

  let health = await SourceHealth.findOne({ sourceKey: key });

  if (!health) {
    health = new SourceHealth({ sourceKey: key });
  }

  health.successCount += 1;
  health.consecutiveFailures = 0;
  health.lastRunAt = now;
  health.lastSuccessAt = now;
  health.backoffUntil = null;
  health.lastError = null;

  const totalRuns = health.successCount + health.failureCount;
  health.avgDurationMs = rollingAverage(health.avgDurationMs, Number(metrics.durationMs || 0), totalRuns);
  health.avgNewJobs = rollingAverage(health.avgNewJobs, Number(metrics.newJobs || 0), totalRuns);
  health.avgRefreshedJobs = rollingAverage(health.avgRefreshedJobs, Number(metrics.refreshedJobs || 0), totalRuns);
  health.score = calculateScore(health);
  health.updatedAt = now;

  await health.save();
  return health;
}

async function registerSourceFailure(sourceKey, error, metrics = {}) {
  const now = new Date();
  const key = String(sourceKey || "").toLowerCase().trim();

  if (!key) {
    return null;
  }

  let health = await SourceHealth.findOne({ sourceKey: key });

  if (!health) {
    health = new SourceHealth({ sourceKey: key });
  }

  health.failureCount += 1;
  health.consecutiveFailures += 1;
  health.lastRunAt = now;
  health.lastFailureAt = now;
  health.lastError = error?.message || String(error || "Unknown ingestion failure");
  health.backoffUntil = computeBackoffUntil(health.consecutiveFailures);

  const totalRuns = health.successCount + health.failureCount;
  health.avgDurationMs = rollingAverage(health.avgDurationMs, Number(metrics.durationMs || 0), totalRuns);
  health.score = calculateScore(health);
  health.updatedAt = now;

  await health.save();
  return health;
}

async function clearSourceBackoff(sourceKey) {
  const key = String(sourceKey || "").toLowerCase().trim();

  if (!key) {
    return null;
  }

  const health = await SourceHealth.findOne({ sourceKey: key });

  if (!health) {
    return null;
  }

  health.backoffUntil = null;
  health.consecutiveFailures = 0;
  health.updatedAt = new Date();

  await health.save();
  return health;
}

function isSourceBackedOff(health) {
  return Boolean(health?.backoffUntil && health.backoffUntil.getTime() > Date.now());
}

module.exports = {
  getSourceHealthMap,
  getSourceHealthForApi,
  registerSourceSuccess,
  registerSourceFailure,
  clearSourceBackoff,
  isSourceBackedOff
};
