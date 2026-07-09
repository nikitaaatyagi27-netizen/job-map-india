require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { callLLM } = require('../utils/groqClient');

const BATCH_SIZE = 15; // names per LLM call

async function classifyBatch(names) {
  const prompt = `You are validating company names from an Indian job site. Be CONSERVATIVE:
when in doubt, mark "real". Many real companies are small, obscure, single-word, or
oddly-spelled — that is NORMAL and they should be kept as "real".

Mark "garbage" ONLY when the entry is CLEARLY not a company, i.e. it is obviously:
- a job title or role ("Software Engineer", "Backend Developer", "Data Analyst")
- a search query or generic phrase ("Top IT Companies in Pune", "MNC jobs", "Work From Home", "Hiring Now")
- an individual person's full name used as the employer (a recruiter), e.g. "Pinky Kapoor", "Rahul Sharma"
  — but DO NOT flag a company merely because it contains a surname (e.g. "Tata", "Mahindra", "Larsen Toubro" are REAL)
- a placeholder ("Confidential", "Undisclosed", "Client of ...", "A Leading MNC")
- a pure job-board/aggregator name ("Naukri", "Indeed", "LinkedIn")

If the name is just an unfamiliar, small, single-word, or strange-sounding business
name, mark it "real". Do NOT mark something garbage just because you don't recognize it.

Reply ONLY with a JSON array in this exact format (same order as input):
[{"name":"...", "verdict":"real"}, {"name":"...", "verdict":"garbage"}, ...]

Company list:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;

  // Uses the shared LLM client: Groq (free/fast) → Gemini → OpenRouter fallback.
  const raw = await callLLM([{ role: 'user', content: prompt }], { temperature: 0, max_tokens: 2000 });

  // Strip code fences if present
  const stripped = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const match = stripped.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in LLM response: ' + raw.slice(0, 200));

  return JSON.parse(match[0]);
}

const DRY_RUN = process.argv.includes('--dry-run');
// --source=naukri restricts validation to companies discovered from that source.
const SOURCE_ARG = (process.argv.find(a => a.startsWith('--source=')) || '').split('=')[1] || null;

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB\n');

  const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false }), 'companies');
  const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false }), 'jobs');
  const CareerSource = mongoose.model('CareerSource', new mongoose.Schema({}, { strict: false }), 'careersources');

  // Filter by source when requested (e.g. only Naukri-discovered companies).
  const filter = SOURCE_ARG ? { source: SOURCE_ARG } : {};
  const all = await Company.find(filter, { _id: 1, name: 1, domain: 1 }).lean();
  console.log(`Total companies to validate${SOURCE_ARG ? ` (source=${SOURCE_ARG})` : ''}: ${all.length}`);

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

    const batchGarbage = [];
    for (const result of results) {
      if (result.verdict === 'garbage') {
        const company = batch.find(c => c.name === result.name);
        if (company) {
          garbageIds.push(company._id);
          garbageNames.push(company.name);
          batchGarbage.push(company.name);
        }
      }
    }

    // Print the flagged names inline so you can see them live (and Ctrl+C early).
    if (batchGarbage.length) {
      console.log(`found ${batchGarbage.length} garbage: ${batchGarbage.map(n => `"${n}"`).join(', ')}`);
    } else {
      console.log('found 0 garbage');
    }

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
