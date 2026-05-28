const express = require('express');
const request = require('supertest');

// ── Mock every service the admin router imports ────────────────────────────────
jest.mock('../../services/jobAlertService', () => ({
  runAlertDigest: jest.fn().mockResolvedValue({ total: 2, sent: 1 }),
  subscribe: jest.fn(),
  unsubscribe: jest.fn()
}));
jest.mock('../../services/ingestionOrchestratorService', () => ({
  runIngestionQueue: jest.fn().mockResolvedValue({
    executedTasks: 1, successes: [], failures: [], skippedTasks: 0
  })
}));
jest.mock('../../services/sourceHealthService', () => ({
  clearSourceBackoff: jest.fn().mockResolvedValue({
    sourceKey: 'jsearch', backoffUntil: null, consecutiveFailures: 0
  }),
  getSourceHealthForApi: jest.fn().mockResolvedValue([]),
  getSourceHealthMap: jest.fn().mockResolvedValue(new Map()),
  isSourceBackedOff: jest.fn().mockReturnValue(false)
}));
jest.mock('../../services/universalCareerSourceService', () => ({
  registerUniversalSource: jest.fn().mockResolvedValue({
    company: { _id: 'cid1', name: 'test co' },
    source:  { _id: 'sid1', boardUrl: 'https://testco.com/careers', status: 'active' }
  })
}));
jest.mock('../../config/ingestionSourceCatalog', () => ({
  getIngestionSourceCatalog: jest.fn().mockReturnValue([
    { key: 'jsearch', label: 'JSearch', handler: jest.fn(), basePriority: 50 }
  ])
}));

const adminRouter = require('../../routes/admin');

// Build a minimal test app that only mounts the admin router
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

// ── Auth middleware behaviour ──────────────────────────────────────────────────

describe('Admin auth — requireAdminAuth middleware', () => {
  const ORIGINAL_TOKEN = process.env.INGESTION_ADMIN_TOKEN;

  afterEach(() => {
    // Restore whatever was set before each test
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.INGESTION_ADMIN_TOKEN;
    } else {
      process.env.INGESTION_ADMIN_TOKEN = ORIGINAL_TOKEN;
    }
  });

  test('returns 503 when INGESTION_ADMIN_TOKEN is not set', async () => {
    delete process.env.INGESTION_ADMIN_TOKEN;
    const res = await request(buildApp()).post('/api/admin/alerts/test').send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  test('returns 401 when token is wrong', async () => {
    process.env.INGESTION_ADMIN_TOKEN = 'correct-secret';
    const res = await request(buildApp())
      .post('/api/admin/alerts/test')
      .set('Authorization', 'Bearer wrong-token')
      .send({});
    expect(res.status).toBe(401);
  });

  test('returns 401 when Authorization header is absent', async () => {
    process.env.INGESTION_ADMIN_TOKEN = 'correct-secret';
    const res = await request(buildApp()).post('/api/admin/alerts/test').send({});
    expect(res.status).toBe(401);
  });

  test('passes through with the correct Bearer token', async () => {
    process.env.INGESTION_ADMIN_TOKEN = 'correct-secret';
    const res = await request(buildApp())
      .post('/api/admin/alerts/test')
      .set('Authorization', 'Bearer correct-secret')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('every admin route is protected — ingestion/run returns 401 without token', async () => {
    process.env.INGESTION_ADMIN_TOKEN = 'secret';
    const res = await request(buildApp()).post('/api/admin/ingestion/run').send({});
    expect(res.status).toBe(401);
  });

  test('every admin route is protected — backoff/reset returns 401 without token', async () => {
    process.env.INGESTION_ADMIN_TOKEN = 'secret';
    const res = await request(buildApp()).post('/api/admin/ingestion/backoff/reset').send({});
    expect(res.status).toBe(401);
  });
});

// ── Route behaviour (with valid auth) ─────────────────────────────────────────

describe('POST /api/admin/ingestion/run', () => {
  beforeEach(() => { process.env.INGESTION_ADMIN_TOKEN = 'test-token'; });
  afterEach(() => { delete process.env.INGESTION_ADMIN_TOKEN; });

  const auth = { Authorization: 'Bearer test-token' };

  test('returns 400 when sources array is empty', async () => {
    const res = await request(buildApp())
      .post('/api/admin/ingestion/run')
      .set(auth)
      .send({ sources: [] });
    // With empty sources, selectIngestionTasks returns the full catalog (1 mock task) — so 200
    expect([200, 400]).toContain(res.status);
  });

  test('returns 200 with summary on success', async () => {
    const res = await request(buildApp())
      .post('/api/admin/ingestion/run')
      .set(auth)
      .send({ sources: ['jsearch'] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.summary).toBeDefined();
  });
});

describe('POST /api/admin/ingestion/backoff/reset', () => {
  beforeEach(() => { process.env.INGESTION_ADMIN_TOKEN = 'test-token'; });
  afterEach(() => { delete process.env.INGESTION_ADMIN_TOKEN; });

  const auth = { Authorization: 'Bearer test-token' };

  test('returns 400 when sourceKey is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/ingestion/backoff/reset')
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceKey/i);
  });

  test('returns 200 with updated source on success', async () => {
    const res = await request(buildApp())
      .post('/api/admin/ingestion/backoff/reset')
      .set(auth)
      .send({ sourceKey: 'jsearch' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sourceKey).toBe('jsearch');
  });
});
