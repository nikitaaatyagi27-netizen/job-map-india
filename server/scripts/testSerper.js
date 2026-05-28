require('dotenv').config();
const axios = require('axios');

async function run() {
  const key = process.env.SERPER_API_KEY;
  console.log('SERPER_API_KEY loaded:', key ? `${key.slice(0, 8)}...` : 'MISSING');

  if (!key) {
    console.error('Key not found in .env');
    process.exit(1);
  }

  try {
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q: 'ServiceNow myworkdayjobs.com careers', num: 5 },
      {
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );
    console.log('\nHTTP status:', res.status);
    console.log('Credits used:', res.headers['x-ratelimit-credits-used'] || 'N/A');
    console.log('Credits remaining:', res.headers['x-ratelimit-credits-remaining'] || 'N/A');
    console.log('Organic results:', res.data?.organic?.length ?? 0);

    if (res.data?.organic?.length > 0) {
      console.log('\nFirst result:', res.data.organic[0].link);
    } else {
      console.log('\nFull response:', JSON.stringify(res.data, null, 2));
    }
  } catch (err) {
    console.error('\nRequest failed:', err.response?.status, err.response?.data || err.message);
  }
}

run();
