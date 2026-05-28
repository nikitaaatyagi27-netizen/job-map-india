require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { discoverGreenhouse, discoverLever, discoverAshby, discoverSmartRecruiters } = require('../services/atsSitemapDiscoveryService');

const TARGETS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const RUN_ALL = TARGETS.length === 0;

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB');

  let total = 0;

  if (RUN_ALL || TARGETS.includes('greenhouse')) {
    total += await discoverGreenhouse();
  }
  if (RUN_ALL || TARGETS.includes('lever')) {
    total += await discoverLever();
  }
  if (RUN_ALL || TARGETS.includes('ashby')) {
    total += await discoverAshby();
  }
  if (RUN_ALL || TARGETS.includes('smartrecruiters')) {
    total += await discoverSmartRecruiters();
  }

  console.log(`\nTotal new companies registered: ${total}`);
  console.log('Run the ingestion pipeline now to fetch their jobs.');
  await mongoose.disconnect();
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
