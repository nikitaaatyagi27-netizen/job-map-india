const express = require('express');
const request = require('supertest');

// ── Mock service / model imports that the jobs router pulls in ─────────────────
jest.mock('../../services/brandingEnrichmentService', () => ({
  ensureCompanyBranding: jest.fn()
}));
jest.mock('../../services/skillBasedJobSearchService', () => ({
  searchJobsBySkills: jest.fn().mockResolvedValue({ companies: [], fromCache: false })
}));
jest.mock('../../services/skillGapService', () => ({
  analyseSkillGap: jest.fn()
}));
jest.mock('../../services/sessionService', () => ({
  getOrCreateSession: jest.fn(),
  getSession: jest.fn(),
  saveJob: jest.fn(),
  unsaveJob: jest.fn(),
  trackApply: jest.fn(),
  updateLastSearch: jest.fn()
}));
jest.mock('../../models/Company', () => ({
  find:           jest.fn().mockReturnValue({ skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) }),
  countDocuments: jest.fn().mockResolvedValue(0)
}));
jest.mock('../../models/Job', () => ({
  find:            jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
  findById:        jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }),
  findByIdAndUpdate:  jest.fn().mockResolvedValue(null),
  findOneAndUpdate:   jest.fn().mockResolvedValue({ _id: 'jid1' })
}));
jest.mock('../../utils/logoResolver',    () => jest.fn().mockReturnValue(null));
jest.mock('../../utils/cleanCompanyName', () => ({
  cleanCompanyNameOrUnknown: jest.fn().mockReturnValue('Test Company')
}));

const { analyseSkillGap } = require('../../services/skillGapService');
const Job = require('../../models/Job');
const jobsRouter = require('../../routes/jobs');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobsRouter);
  return app;
}

// ── POST /api/jobs/skill-gap ───────────────────────────────────────────────────

describe('POST /api/jobs/skill-gap', () => {
  test('returns 400 when no skills provided', async () => {
    const res = await request(buildApp())
      .post('/api/jobs/skill-gap')
      .send({ jobTitle: 'React Dev' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/primarySkills or secondarySkills required/i);
  });

  test('returns analysis from analyseSkillGap on valid input', async () => {
    analyseSkillGap.mockReturnValue({
      matched: ['React'], missing: ['Docker'], matchScore: 50, hasAnalysis: true
    });

    const res = await request(buildApp())
      .post('/api/jobs/skill-gap')
      .send({ primarySkills: ['React'], secondarySkills: [], jobTitle: 'React + Docker Dev' });

    expect(res.status).toBe(200);
    expect(res.body.matched).toContain('React');
    expect(res.body.missing).toContain('Docker');
    expect(res.body.matchScore).toBe(50);
  });

  test('fetches description from DB when jobId is provided', async () => {
    Job.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ description: 'Requires React and Docker', title: 'Dev' })
      })
    });
    analyseSkillGap.mockReturnValue({
      matched: [], missing: [], matchScore: null, hasAnalysis: false
    });

    const res = await request(buildApp())
      .post('/api/jobs/skill-gap')
      .send({ primarySkills: ['React'], jobTitle: 'Dev', jobId: '507f1f77bcf86cd799439011' });

    expect(res.status).toBe(200);
    expect(Job.findById).toHaveBeenCalled();
  });
});

// ── POST /api/jobs/report-closed ──────────────────────────────────────────────

describe('POST /api/jobs/report-closed', () => {
  test('returns 404 when neither jobId nor applyLink match', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    Job.findByIdAndUpdate.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/jobs/report-closed')
      .send({ applyLink: 'https://example.com/jobs/999' });

    expect(res.status).toBe(404);
  });

  test('returns 200 when job is found and marked inactive', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ _id: 'jid1', isActive: false });

    const res = await request(buildApp())
      .post('/api/jobs/report-closed')
      .send({ applyLink: 'https://example.com/jobs/1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /api/jobs/click ──────────────────────────────────────────────────────

describe('POST /api/jobs/click', () => {
  test('always returns 200 regardless of payload', async () => {
    const res = await request(buildApp())
      .post('/api/jobs/click')
      .send({ applyLink: 'https://example.com/apply' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns 200 even with empty body', async () => {
    const res = await request(buildApp()).post('/api/jobs/click').send({});
    expect(res.status).toBe(200);
  });
});
