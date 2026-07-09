// Dry-run ATS discovery: mines company slugs via GitHub search and verifies which
// have live India jobs — then PRINTS the company names and job counts WITHOUT
// writing anything to the DB. Safe to run when the DB is full / writes are blocked.
//
// Usage:
//   node scripts/probeAtsDiscovery.js greenhouse        # one provider
//   node scripts/probeAtsDiscovery.js greenhouse lever   # several
//   node scripts/probeAtsDiscovery.js                    # all (gh + lever + ashby)
//
// This uses the exact same mining + India-verification code path as the real
// discovery (atsSitemapDiscoveryService), so what it prints is what a real run
// would register once writes are unblocked.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const CareerSource = require('../models/CareerSource');
const {
  mineSlugsByGitHub,
  checkGreenhouseForIndia, checkLeverForIndia, checkAshbyForIndia,
  GREENHOUSE_QUERIES, LEVER_QUERIES, ASHBY_QUERIES,
  runConcurrent, CONCURRENCY
} = require('../services/atsSitemapDiscoveryService');

const PROVIDERS = {
  greenhouse: { host: 'boards.greenhouse.io', queries: GREENHOUSE_QUERIES, check: checkGreenhouseForIndia },
  lever:      { host: 'jobs.lever.co',        queries: LEVER_QUERIES,      check: checkLeverForIndia },
  ashby:      { host: 'jobs.ashbyhq.com',     queries: ASHBY_QUERIES,      check: checkAshbyForIndia },
};

async function existingSlugsFor(provider) {
  const existing = await CareerSource.find({ provider }).select('boardUrl').lean();
  return new Set(existing.map(s => {
    try { return new URL(s.boardUrl).pathname.split('/').filter(Boolean)[0]; } catch { return ''; }
  }));
}

async function probeProvider(name) {
  const { host, queries, check } = PROVIDERS[name];
  console.log(`\n===== ${name.toUpperCase()} (dry-run, no writes) =====`);

  const existingSlugs = await existingSlugsFor(name);
  console.log(`Mining ${host} via GitHub search (${existingSlugs.size} already registered will be skipped)...`);

  const slugs = await mineSlugsByGitHub(host, queries, existingSlugs);
  console.log(`Found ${slugs.length} unique NEW slugs. Verifying which have India jobs...`);

  const tasks = slugs.map(slug => () => check(slug));
  const results = await runConcurrent(tasks, CONCURRENCY);
  const found = results.filter(Boolean).sort((a, b) => b.indiaJobCount - a.indiaJobCount);

  console.log(`\n${found.length} companies WITH India jobs (would be registered):\n`);
  found.forEach((c, i) =>
    console.log(`  ${String(i + 1).padStart(3)}. ${String(c.companyName).padEnd(36)} ${c.indiaJobCount} India jobs   [${c.slug}]`)
  );
  const totalJobs = found.reduce((s, c) => s + c.indiaJobCount, 0);
  console.log(`\n[${name}] ${found.length} companies, ${totalJobs} India jobs total (nothing written).`);
  return found;
}

async function run() {
  const targets = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const list = targets.length ? targets : ['greenhouse', 'lever', 'ashby'];

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB (read-only probe)');

  for (const name of list) {
    if (!PROVIDERS[name]) { console.log(`Skipping unknown provider: ${name}`); continue; }
    await probeProvider(name);
  }

  await mongoose.disconnect();
  console.log('\nDone. Re-run real discovery (npm run discover:greenhouse) after freeing DB space to register these.');
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
