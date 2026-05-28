const IngestionRun = require("../models/IngestionRun");

function toTaskRows(summary) {
  const successRows = (summary.successes || []).map((item) => ({
    key: item.key,
    label: item.label,
    status: "success",
    attempts: item.attempts,
    priority: Number(item.priority || 0),
    durationMs: Number(item.metrics?.durationMs || 0),
    newCompanies: Number(item.metrics?.newCompanies || 0),
    newJobs: Number(item.metrics?.newJobs || 0),
    refreshedJobs: Number(item.metrics?.refreshedJobs || 0)
  }));

  const failureRows = (summary.failures || []).map((item) => ({
    key: item.key,
    label: item.label,
    status: "failed",
    attempts: item.attempts,
    priority: Number(item.priority || 0),
    error: item.error || null
  }));

  const skippedRows = (summary.skipped || []).map((item) => ({
    key: item.key,
    label: item.label,
    status: "skipped",
    attempts: 0,
    priority: Number(item.priority || 0),
    skippedReason: item.reason || "unknown",
    backoffUntil: item.backoffUntil || null
  }));

  return [...successRows, ...failureRows, ...skippedRows];
}

async function logIngestionRun(summary) {
  const tasks = toTaskRows(summary);

  await IngestionRun.create({
    trigger: summary.trigger || "unknown",
    totalTasks: Number(summary.totalTasks || 0),
    executedTasks: Number(summary.executedTasks || 0),
    skippedTasks: Number(summary.skippedTasks || 0),
    successCount: (summary.successes || []).length,
    failureCount: (summary.failures || []).length,
    tasks,
    startedAt: summary.startedAt || new Date(),
    finishedAt: summary.finishedAt || new Date()
  });
}

async function getRecentIngestionRuns(limit = 20) {
  return IngestionRun.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("trigger totalTasks executedTasks skippedTasks successCount failureCount startedAt finishedAt createdAt tasks");
}

module.exports = {
  logIngestionRun,
  getRecentIngestionRuns
};
