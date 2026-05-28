// Drops ghost collections that have no model and accumulate stale data.
// Currently: companyandidates (478 docs, leftover from an old discovery flow)
//
// Run: node server/scripts/cleanupGhostCollections.js
// Safe to re-run — only drops collections explicitly listed here.

require('dotenv').config();
const connectDB = require('../config/db');
const mongoose = require('mongoose');

const GHOST_COLLECTIONS = [
  'companyandidates',
];

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  const existing = (await db.listCollections().toArray()).map(c => c.name);

  for (const name of GHOST_COLLECTIONS) {
    if (!existing.includes(name)) {
      console.log(`[CLEANUP] ${name} — not found, skipping`);
      continue;
    }
    const count = await db.collection(name).countDocuments();
    await db.collection(name).drop();
    console.log(`[CLEANUP] Dropped ${name} (${count} docs)`);
  }

  console.log('[CLEANUP] Done');
  process.exit(0);
}

run().catch(err => {
  console.error('[CLEANUP] Fatal:', err.message);
  process.exit(1);
});
