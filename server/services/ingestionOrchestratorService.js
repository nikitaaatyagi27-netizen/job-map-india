const { runIngestionSource } = require("../utils/ingestionRunner");
const {
  getSourceHealthMap,
  registerSourceSuccess,
  registerSourceFailure,
  isSourceBackedOff
} = require("./sourceHealthService");
const { logIngestionRun } = require("./ingestionRunLogService");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPriority(task, health) {
  const basePriority = Number(task.basePriority || 50);
  const healthScore = Number(health?.score || 50);

  return (basePriority * 0.45) + (healthScore * 0.55);
}

function sortTasksByPriority(tasks, healthMap) {
  return [...tasks]
    .map((task) => {
      const health = healthMap.get(task.key);

      return {
        ...task,
        __priority: buildPriority(task, health),
        __health: health || null
      };
    })
    .sort((left, right) => right.__priority - left.__priority);
}

async function runTaskWithRetry(task, retries) {
  let attempts = 0;

  while (attempts <= retries) {
    attempts += 1;
    const startedAtMs = Date.now();

    try {
      const metrics = await runIngestionSource(task.key, task.label, task.handler);
      const durationMs = Date.now() - startedAtMs;

      await registerSourceSuccess(task.key, {
        durationMs,
        newJobs: metrics?.newJobs || 0,
        refreshedJobs: metrics?.refreshedJobs || 0
      });

      return {
        status: "success",
        attempts,
        metrics: {
          ...(metrics || {}),
          durationMs
        }
      };
    } catch (error) {
      const durationMs = Date.now() - startedAtMs;

      await registerSourceFailure(task.key, error, {
        durationMs
      });

      if (attempts > retries) {
        return {
          status: "failed",
          attempts,
          error
        };
      }

      await sleep(500 * attempts);
    }
  }

  return {
    status: "failed",
    attempts,
    error: new Error("Unknown orchestrator failure")
  };
}

async function runIngestionQueue(tasks = [], options = {}) {
  const concurrency = Math.max(Number(options.concurrency || 2), 1);
  const retries = Math.max(Number(options.retries || 1), 0);
  const trigger = options.trigger || "unknown";
  const forcedSources = new Set(
    Array.isArray(options.forceRunSources)
      ? options.forceRunSources.map((value) => String(value || "").toLowerCase().trim())
      : []
  );

  const healthMap = await getSourceHealthMap();
  const prioritized = sortTasksByPriority(tasks, healthMap);

  const queue = [];
  const skipped = [];

  for (const task of prioritized) {
    const shouldForceRun = forcedSources.has(task.key);

    if (!shouldForceRun && isSourceBackedOff(task.__health)) {
      skipped.push({
        key: task.key,
        label: task.label,
        priority: task.__priority,
        reason: "backoff",
        backoffUntil: task.__health.backoffUntil
      });
      continue;
    }

    queue.push({
      ...task,
      __forced: shouldForceRun
    });
  }

  const summary = {
    trigger,
    startedAt: new Date(),
    totalTasks: prioritized.length,
    executedTasks: 0,
    skippedTasks: skipped.length,
    successes: [],
    failures: [],
    skipped
  };

  let cursor = 0;

  async function workerLoop() {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;

      const task = queue[index];
      const result = await runTaskWithRetry(task, retries);
      summary.executedTasks += 1;

      if (result.status === "success") {
        summary.successes.push({
          key: task.key,
          label: task.label,
          priority: task.__priority,
          attempts: result.attempts,
          metrics: result.metrics
        });
      } else {
        summary.failures.push({
          key: task.key,
          label: task.label,
          priority: task.__priority,
          attempts: result.attempts,
          error: result.error?.message || "Unknown task failure"
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => workerLoop());
  await Promise.all(workers);

  summary.finishedAt = new Date();
  await logIngestionRun(summary).catch(() => null);

  return summary;
}

module.exports = {
  runIngestionQueue
};
