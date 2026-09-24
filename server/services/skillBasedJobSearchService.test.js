jest.mock('axios');
jest.mock('./searchCacheService');
jest.mock('../utils/embeddingClient');
jest.mock('../models/Job');
jest.mock('../models/Company');
jest.mock('../utils/jobPersistence');

const axios = require('axios');
const { getCachedResults, setCachedResults } = require('./searchCacheService');
const { embed } = require('../utils/embeddingClient');
const Job = require('../models/Job');
const Company = require('../models/Company');
const { searchJobsBySkills } = require('./skillBasedJobSearchService');
const { upsertIngestedJob } = require('../utils/jobPersistence');

// Mongoose query mock supporting both `await find().select().populate().lean()`
// and streaming via `find().select().lean().cursor()`.
function mockJobQuery(docs) {
  const leanResult = {
    then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject),
    cursor: () => (async function* () { yield* docs; })(),
  };
  return {
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn(() => leanResult),
  };
}

describe('skillBasedJobSearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCachedResults.mockResolvedValue(null);
    embed.mockResolvedValue(Array(768).fill(0.1)); // Mock embedding vector
    axios.get.mockResolvedValue({ data: { data: [] } }); // Mock JSearch/ATS calls
    Job.find.mockImplementation(() => mockJobQuery([]));
    Job.findByIdAndUpdate.mockResolvedValue({});
    Company.find.mockResolvedValue([]);
    Company.create.mockImplementation(c => Promise.resolve({ ...c, _id: 'mock-id' }));
    Company.bulkWrite.mockResolvedValue({});
    upsertIngestedJob.mockResolvedValue({ _id: 'mock-job-id' });
  });

  describe('searchJobsBySkills', () => {
    it('should return from cache if available', async () => {
      const cachedResults = [{ employer_name: 'Cached Corp', roles: [{ title: 'Cached Dev' }] }];
      getCachedResults.mockResolvedValue(cachedResults);

      const result = await searchJobsBySkills({ primarySkills: ['react'] });

      expect(result.fromCache).toBe(true);
      expect(result.companies).toEqual(cachedResults);
      expect(Job.find).not.toHaveBeenCalled();
    });

    it('should skip live APIs if enough jobs are found in the DB (DB-sufficiency gate)', async () => {
      // Mock searchDBJobs to return more than DB_FIRST_MIN_JOBS (default 50)
      const mockDbJobs = Array.from({ length: 55 }, (_, i) => ({
        _id: `job_${i}`,
        title: 'DB Dev',
        applyLink: `link${i}`,
        source: 'db',
        embedding: Array(768).fill(0.1),
        company: { _id: `company_${i}`, name: `DB Corp ${i}` }
      }));

      Job.find.mockImplementation(() => mockJobQuery(mockDbJobs));

      const result = await searchJobsBySkills({ primarySkills: ['react'] });

      // Check that live API calls were NOT made
      expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('jsearch.p.rapidapi.com'), expect.any(Object));
      expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('boards-api.greenhouse.io'), expect.any(Object));
      expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('api.lever.co'), expect.any(Object));

      // Check that results are based on DB jobs
      expect(result.companies.length).toBeGreaterThan(0);
      expect(result.companies[0].employer_name).toContain('DB Corp');
      expect(setCachedResults).toHaveBeenCalled();
    });

    it('should call live APIs if not enough jobs are found in the DB', async () => {
      // Mock searchDBJobs to return fewer than DB_FIRST_MIN_JOBS
      const mockDbJobs = Array.from({ length: 10 }, (_, i) => ({
        _id: `job_${i}`,
        title: 'DB Dev',
        applyLink: `link${i}`,
        source: 'db',
        embedding: Array(768).fill(0.1),
        company: { _id: `company_${i}`, name: `DB Corp ${i}` }
      }));
      Job.find.mockImplementation(() => mockJobQuery(mockDbJobs));

      // Mock live APIs to return some data
      axios.get.mockImplementation(url => {
        if (url.includes('jsearch')) {
          return Promise.resolve({
            data: {
              data: [{
                employer_name: 'JSearch Corp',
                job_title: 'Live Dev',
                job_apply_link: 'live_link_1'
              }]
            }
          });
        }
        return Promise.resolve({ data: { jobs: [] } });
      });

      await searchJobsBySkills({ primarySkills: ['react'] });

      // Check that live API calls WERE made
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('jsearch.p.rapidapi.com'), expect.any(Object));
    });

    it('should throw an error if no skills or roles are provided', async () => {
        await expect(searchJobsBySkills({ primarySkills: [], roles: [] })).rejects.toThrow('No skills or roles provided');
    });
  });
});