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
// --start=100 skips ahead to batch 100 (1-indexed), so you don't re-spend
// quota re-checking batches you already confirmed clean in a prior run.
const START_BATCH = Number((process.argv.find(a => a.startsWith('--start=')) || '').split('=')[1] || 1);
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

  const totalBatches = Math.ceil(all.length / BATCH_SIZE);
  const startIndex = (START_BATCH - 1) * BATCH_SIZE;
  if (START_BATCH > 1) {
    console.log(`Skipping ahead to batch ${START_BATCH}/${totalBatches} (companies 1-${startIndex} not re-checked this run)`);
  }

  let totalGarbageCount = 0;
  const allGarbageNames = [];

  for (let i = startIndex; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE);
    const names = batch.map(c => c.name);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    process.stdout.write(`Validating batch ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH_SIZE, all.length)})... `);

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
    if (!success) {
      console.log(`  Skipping batch after 3 attempts. Resume later with --start=${batchNum}`);
      continue;
    }

    const batchGarbageIds = [];
    const batchGarbageNames = [];
    for (const result of results) {
      if (result.verdict === 'garbage') {
        const company = batch.find(c => c.name === result.name);
        if (company) {
          batchGarbageIds.push(company._id);
          batchGarbageNames.push(company.name);
        }
      }
    }

    if (batchGarbageNames.length === 0) {
      console.log('found 0 garbage');
    } else if (DRY_RUN) {
      console.log(`found ${batchGarbageNames.length} garbage (not deleted — dry run): ${batchGarbageNames.map(n => `"${n}"`).join(', ')}`);
      totalGarbageCount += batchGarbageNames.length;
      allGarbageNames.push(...batchGarbageNames);
    } else {
      // Delete THIS batch's garbage immediately, right after classifying it —
      // not accumulated for a single delete at the end. If quota runs out on
      // a later batch, everything found garbage so far is already gone from
      // the DB, not lost.
      const jobDel = await Job.deleteMany({ company: { $in: batchGarbageIds } });
      const srcDel = await CareerSource.deleteMany({ company: { $in: batchGarbageIds } });
      const compDel = await Company.deleteMany({ _id: { $in: batchGarbageIds } });
      console.log(
        `found ${batchGarbageNames.length} garbage, deleted (${compDel.deletedCount} companies, ` +
        `${jobDel.deletedCount} jobs, ${srcDel.deletedCount} career sources): ` +
        batchGarbageNames.map(n => `"${n}"`).join(', ')
      );
      totalGarbageCount += batchGarbageNames.length;
      allGarbageNames.push(...batchGarbageNames);
    }

    // Delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 2500));
  }

  console.log(`\nTotal garbage identified by LLM: ${totalGarbageCount}`);

  if (totalGarbageCount === 0) {
    console.log('Nothing found.');
    await mongoose.disconnect();
    return;
  }

  console.log('\nAll garbage companies identified this run:');
  allGarbageNames.forEach(n => console.log(`  - "${n}"`));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Nothing was deleted. Run without --dry-run to actually delete.');
  } else {
    console.log('\nAll of the above were deleted immediately after their batch was classified.');
  }

  const remaining = await Company.countDocuments();
  console.log(`\nRemaining companies: ${remaining}`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});