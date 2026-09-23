require('dotenv').config();
const axios = require('axios');

async function run() {
  const testNames = ['amazon', 'microsoft', 'micron technology', 'micron semiconductor', 'delta infosoft', 'secure meters'];

  for (const name of testNames) {
    try {
      const res = await axios.get('https://api.clearout.io/public/companies/autocomplete', {
        params: { query: name },
        timeout: 15000,
      });
      console.log(`\n=== "${name}" ===`);
      console.log('HTTP status:', res.status);
      console.log(JSON.stringify(res.data, null, 2));
    } catch (err) {
      console.error(`\n=== "${name}" FAILED ===`);
      console.error(err.response?.status, err.response?.data || err.message);
    }
  }
}

run();