require('dotenv').config();
// Enable aggressive inclusion for this run
process.env.INCLUDE_ALL_JOBS = 'true';

const connectDB = require('../config/db');
const { searchJobsBySkills } = require('../services/skillBasedJobSearchService');

async function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

(async () => {
  await connectDB();

  const profiles = [
    { primarySkills: ['javascript','react'], roles: ['developer'] },
    { primarySkills: ['node','express'], roles: ['backend','developer'] },
    { primarySkills: ['python','django'], roles: ['developer'] },
    { primarySkills: ['java','spring'], roles: ['developer'] },
    { primarySkills: ['aws','devops'], roles: ['devops','site reliability'] },
    { primarySkills: ['android'], roles: ['android developer'] },
    { primarySkills: ['ios','swift'], roles: ['ios developer'] },
    { primarySkills: ['data science','machine learning'], roles: ['data scientist'] },
    { primarySkills: ['react','node'], roles: ['fullstack'] },
    { primarySkills: ['php','laravel'], roles: ['developer'] }
  ];

  console.log(`[BATCH HARVEST] Running ${profiles.length} profiles`);
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    try {
      console.log(`[BATCH HARVEST] Profile ${i+1}/${profiles.length}: ${p.primarySkills.join(', ')} | roles: ${p.roles.join(', ')}`);
      const { companies, fromCache } = await searchJobsBySkills({ primarySkills: p.primarySkills, roles: p.roles, domain: 'other' });
      console.log(`[BATCH HARVEST] -> companies: ${companies.length} (fromCache=${fromCache})`);
    } catch (err) {
      console.error('[BATCH HARVEST] Profile failed:', err && err.message ? err.message : err);
    }
    // small delay to be gentle on external APIs
    await delay(800);
  }

  console.log('[BATCH HARVEST] Completed');
  process.exit(0);
})().catch(err => { console.error('Batch harvest failed:', err && err.message ? err.message : err); process.exit(1); });
