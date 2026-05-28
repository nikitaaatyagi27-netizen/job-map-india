require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const JOB_BOARD_DOMAINS = [
  'linkedin.com','in.linkedin.com','naukri.com','indeed.com',
  'glassdoor.com','glassdoor.co.in','monster.com','shine.com',
  'foundit.in','timesjobs.com','iimjobs.com','hirist.com',
  'instahyre.com','cutshort.io','builtin.com','wellfound.com',
  'angel.co','apna.co','freshersworld.com','placement.freshers.com',
  'simplyhired.com','ziprecruiter.com','careerjet.com','indiajobs.target.com'
];

const GARBAGE_NAME_PATTERNS = [
  /^\d/,
  /^(software|engineer|developer|designer|consultant|manager|analyst|architect|intern|fresher|programmer|administrator|specialist|executive|associate|fullstack|frontend|backend|devops|data |qa |tester|recruiter|hr |human resource)/i,
  /\b(product based companies|service based companies|mnc companies|top companies|best companies|hiring companies|dream companies)\b/i,
  /^(best |top |latest |new |hiring |jobs in |vacancy|walk.in|work from home|remote jobs)/i,
  /^(software company|tech company|it company|saas company|startup jobs|it jobs|india jobs)/i,
  /^(search |find |browse |explore |discover |view )/i,
  /\b(job opportunities|career opportunities|open positions|current openings|job openings|job listings|job vacancies)\b/i,
  /^[a-z\s]+(pune|mumbai|delhi|bangalore|hyderabad|chennai|noida|gurgaon|gurugram|kolkata)(\s+india)?$/i,
];

const isGarbage = (name) => {
  if (!name) return true;
  if (name.length < 3) return true;
  return GARBAGE_NAME_PATTERNS.some(re => re.test(name.trim()));
};

const isJobBoard = (domain) => {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, '');
  return JOB_BOARD_DOMAINS.some(bd => d === bd || d.endsWith('.' + bd));
};

async function cleanup() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB');

  const Company = require('../models/Company');
  const Job = require('../models/Job');
  const CareerSource = require('../models/CareerSource');

  const total = await Company.countDocuments();
  console.log(`Total companies: ${total}`);

  // Only delete by name/domain pattern — never by source alone
  const allCompanies = await Company.find({}, { _id: 1, name: 1, domain: 1, source: 1 }).lean();
  const toDelete = allCompanies.filter(c => isGarbage(c.name) || isJobBoard(c.domain));

  console.log(`  - Garbage by name/domain pattern: ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    await mongoose.disconnect();
    return;
  }

  console.log('\nSample entries being deleted:');
  toDelete.slice(0, 25).forEach(c => console.log(`  - "${c.name}" [domain: ${c.domain}, source: ${c.source}]`));

  const ids = toDelete.map(c => c._id);

  const jobDel = await Job.deleteMany({ company: { $in: ids } });
  console.log(`\nDeleted ${jobDel.deletedCount} linked jobs`);

  const srcDel = await CareerSource.deleteMany({ company: { $in: ids } });
  console.log(`Deleted ${srcDel.deletedCount} linked career sources`);

  const compDel = await Company.deleteMany({ _id: { $in: ids } });
  console.log(`Deleted ${compDel.deletedCount} garbage companies`);

  const remaining = await Company.countDocuments();
  console.log(`\nRemaining companies: ${remaining}`);

  await mongoose.disconnect();
  console.log('Done.');
}

cleanup().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
