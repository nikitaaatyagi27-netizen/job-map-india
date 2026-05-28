require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const axios = require('axios');

const BATCH_SIZE = 15; // names per LLM call
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.SCRAPER_LLM_MODEL || 'google/gemini-flash-1.5';

async function classifyBatch(names) {
  const prompt = `You are a company validator. Given the list below, classify each entry as either:
- "real" — it is a genuine company (tech, software, startup, MNC, etc.)
- "garbage" — it is a job title, search query, generic phrase, aggregator name, or clearly not a company name

Reply ONLY with a JSON array in this exact format (same order as input):
[{"name":"...", "verdict":"real"}, {"name":"...", "verdict":"garbage"}, ...]

Company list:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;

  const res = await axios.post(
    OPENROUTER_API_URL,
    {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 2000
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const raw = res.data.choices?.[0]?.message?.content || '';

  // Strip code fences if present
  const stripped = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const match = stripped.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in LLM response: ' + raw.slice(0, 200));

  return JSON.parse(match[0]);
}

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB\n');

  const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false }), 'companies');
  const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false }), 'jobs');
  const CareerSource = mongoose.model('CareerSource', new mongoose.Schema({}, { strict: false }), 'careersources');

  const all = await Company.find({}, { _id: 1, name: 1, domain: 1 }).lean();
  console.log(`Total companies to validate: ${all.length}`);

  const garbageIds = [];
  const garbageNames = [];

  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE);
    const names = batch.map(c => c.name);

    process.stdout.write(`Validating batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(all.length / BATCH_SIZE)} (${i + 1}-${Math.min(i + BATCH_SIZE, all.length)})... `);

    let results;
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        results = await classifyBatch(names);
        success = true;
        break;
      } catch (e) {
        console.log(`\n  Attempt ${attempt} failed: ${e.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
      }
    }
    if (!success) { console.log('  Skipping batch after 3 attempts.'); continue; }

    let garbageInBatch = 0;
    for (const result of results) {
      if (result.verdict === 'garbage') {
        const company = batch.find(c => c.name === result.name);
        if (company) {
          garbageIds.push(company._id);
          garbageNames.push(company.name);
          garbageInBatch++;
        }
      }
    }

    console.log(`found ${garbageInBatch} garbage`);

    // Delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 2500));
  }

  console.log(`\nTotal garbage identified by LLM: ${garbageIds.length}`);

  if (garbageIds.length === 0) {
    console.log('Nothing to delete.');
    await mongoose.disconnect();
    return;
  }

  console.log('\nGarbage companies identified:');
  garbageNames.forEach(n => console.log(`  - "${n}"`));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Nothing deleted. Run without --dry-run to actually delete.');
    await mongoose.disconnect();
    return;
  }

  const jobDel = await Job.deleteMany({ company: { $in: garbageIds } });
  console.log(`\nDeleted ${jobDel.deletedCount} linked jobs`);

  const srcDel = await CareerSource.deleteMany({ company: { $in: garbageIds } });
  console.log(`Deleted ${srcDel.deletedCount} linked career sources`);

  const compDel = await Company.deleteMany({ _id: { $in: garbageIds } });
  console.log(`Deleted ${compDel.deletedCount} garbage companies`);

  const remaining = await Company.countDocuments();
  console.log(`\nRemaining companies: ${remaining}`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
