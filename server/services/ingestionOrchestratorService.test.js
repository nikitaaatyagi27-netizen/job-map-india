// Mock dependencies
jest.mock('../utils/ingestionRunner');
jest.mock('./sourceHealthService');
jest.mock('./ingestionRunLogService', () => ({
  logIngestionRun: jest.fn().mockResolvedValue(),
}), { virtual: true }); // It's conditionally required

const { runIngestionSource } = require('../utils/ingestionRunner');
const {
  getSourceHealthMap,
  registerSourceSuccess,
  registerSourceFailure,
  isSourceBackedOff,
} = require('./sourceHealthService');
const { runIngestionQueue } = require('./ingestionOrchestratorService');

describe('ingestionOrchestratorService', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    getSourceHealthMap.mockResolvedValue(new Map());
    isSourceBackedOff.mockReturnValue(false);
    runIngestionSource.mockImplementation(async (key, label, handler) => {
      return await handler();
    });
    registerSourceSuccess.mockResolvedValue({});
    registerSourceFailure.mockResolvedValue({});
  });

  it('should run a single successful task', async () => {
    const tasks = [{
      key: 'test-source',
      label: 'Test Source',
      handler: jest.fn().mockResolvedValue({ newJobs: 5 }),
    }];

    const summary = await runIngestionQueue(tasks);

    expect(summary.totalTasks).toBe(1);
    expect(summary.executedTasks).toBe(1);
    expect(summary.successes.length).toBe(1);
    expect(summary.failures.length).toBe(0);
    expect(tasks[0].handler).toHaveBeenCalledTimes(1);
    expect(registerSourceSuccess).toHaveBeenCalledWith('test-source', expect.any(Object));
    expect(registerSourceFailure).not.toHaveBeenCalled();
  });

  it('should handle a failing task and retry', async () => {
    const failingHandler = jest.fn()
      .mockRejectedValueOnce(new Error('First fail'))
      .mockResolvedValue({ newJobs: 3 });

    const tasks = [{
      key: 'failing-source',
      label: 'Failing Source',
      handler: failingHandler,
    }];

    const summary = await runIngestionQueue(tasks, { retries: 1 });

    expect(summary.executedTasks).toBe(1);
    expect(summary.successes.length).toBe(1);
    expect(summary.failures.length).toBe(0);
    expect(failingHandler).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    expect(registerSourceFailure).toHaveBeenCalledTimes(1);
    expect(registerSourceSuccess).toHaveBeenCalledTimes(1);
  });

  it('should handle a task that fails permanently', async () => {
    const failingHandler = jest.fn().mockRejectedValue(new Error('Permanent failure'));
    const tasks = [{
      key: 'permanent-fail',
      label: 'Permanent Fail',
      handler: failingHandler,
    }];

    const summary = await runIngestionQueue(tasks, { retries: 2 });

    expect(summary.executedTasks).toBe(1);
    expect(summary.successes.length).toBe(0);
    expect(summary.failures.length).toBe(1);
    expect(failingHandler).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(registerSourceFailure).toHaveBeenCalledTimes(3);
    expect(registerSourceSuccess).not.toHaveBeenCalled();
    expect(summary.failures[0].error).toBe('Permanent failure');
  });

  it('should respect concurrency limits', async () => {
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;

    const slowTaskHandler = jest.fn().mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await new Promise(r => setTimeout(r, 50));
      concurrentCalls--;
      return { newJobs: 1 };
    });

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      key: `task-${i}`,
      label: `Task ${i}`,
      handler: slowTaskHandler,
    }));

    await runIngestionQueue(tasks, { concurrency: 2 });

    expect(maxConcurrentCalls).toBe(2);
    expect(slowTaskHandler).toHaveBeenCalledTimes(5);
  });

  it('should skip tasks that are in backoff state', async () => {
    getSourceHealthMap.mockResolvedValue(new Map([
      ['backed-off-source', { score: 10, backoffUntil: new Date(Date.now() + 100000) }]
    ]));
    isSourceBackedOff.mockImplementation(health => health && health.backoffUntil > new Date());

    const tasks = [
      { key: 'backed-off-source', label: 'Backed Off', handler: jest.fn() },
      { key: 'normal-source', label: 'Normal', handler: jest.fn().mockResolvedValue({}) },
    ];

    const summary = await runIngestionQueue(tasks);

    expect(summary.totalTasks).toBe(2);
    expect(summary.executedTasks).toBe(1);
    expect(summary.skippedTasks).toBe(1);
    expect(summary.skipped[0].key).toBe('backed-off-source');
    expect(tasks[0].handler).not.toHaveBeenCalled();
    expect(tasks[1].handler).toHaveBeenCalled();
  });
});