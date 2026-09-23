require('dotenv').config();
const fs = require('fs');
const path = require('path');
const connectDB = require('../config/db');
const Company = require('../models/Company');
const Job = require('../models/Job');

(async function run() {
  await connectDB();

  const outDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `extracted_jobs_by_company.ndjson`);
  const ws = fs.createWriteStream(outFile, { flags: 'w' });

  console.log('Starting extraction to', outFile);

  const totalCompanies = await Company.countDocuments({});
  console.log(`Found ${totalCompanies} companies — streaming jobs per company`);

  const batchSize = 200;
  let processed = 0;

  const cursor = Company.find({}).cursor();
  for await (const company of cursor) {
    const jobs = await Job.find({ company: company._id }).lean();

    const record = {
      company: {
        _id: company._id,
        name: company.name,
        domain: company.domain || null,
        website: company.website || null,
        careersUrl: company.careersUrl || null,
        lat: Number.isFinite(company.lat) ? company.lat : null,
        lng: Number.isFinite(company.lng) ? company.lng : null,
        atsProvider: company.atsProvider || null
      },
      jobs: jobs.map(j => ({
        _id: j._id,
        title: j.title || null,
        location: j.location || null,
        isActive: Boolean(j.isActive),
        applyLink: j.applyLink || null,
        source: j.source || null,
        postedDate: j.postedDate || null,
        embedding: Array.isArray(j.embedding) ? j.embedding.length : (j.embedding ? 'present' : null)
      }))
    };

    ws.write(JSON.stringify(record) + '\n');

    processed += 1;
    if (processed % batchSize === 0) console.log(`Processed ${processed}/${totalCompanies} companies`);
  }

  ws.end();
  console.log(`Done — processed ${processed} companies. Output: ${outFile}`);
  process.exit(0);
})().catch(err => {
  console.error('Extraction failed:', err && err.message ? err.message : err);
  process.exit(1);
});
