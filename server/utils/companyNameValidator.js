const JOB_BOARD_DOMAINS = [
  'linkedin.com','in.linkedin.com','naukri.com','indeed.com',
  'glassdoor.com','glassdoor.co.in','monster.com','shine.com',
  'foundit.in','timesjobs.com','iimjobs.com','hirist.com',
  'instahyre.com','cutshort.io','builtin.com','wellfound.com',
  'angel.co','apna.co','freshersworld.com','internshala.com',
  'simplyhired.com','ziprecruiter.com','careerjet.com'
];

// These match strings that are obviously job-search queries rather than company names.
// Care is taken NOT to reject real names like "Software AG", "Data Patterns India",
// "Engineer Holdings", etc. — so generic words are only rejected when they appear
// as a complete name or are followed by another job-title word.
const JOB_TITLE_WORD = "engineer|engineers|developer|developers|designer|designers|consultant|consultants|manager|managers|analyst|analysts|architect|architects|intern|interns|fresher|freshers|programmer|programmers|administrator|administrators|specialist|specialists|executive|executives|associate|associates|tester|testers|recruiter|recruiters|professional|professionals";

const GARBAGE_PATTERNS = [
  /^\d/,
  // "Software Engineer", "Backend Developer", "Data Analyst" — full job titles as the company name
  new RegExp(`^(software|fullstack|frontend|backend|devops|data|qa|hr|human resource)\\s+(${JOB_TITLE_WORD})\\b`, "i"),
  // Plain "Engineer" / "Developer" alone (no qualifier). Length check protects against false positives.
  new RegExp(`^(${JOB_TITLE_WORD})$`, "i"),
  /\b(product based companies|service based companies|mnc companies|top companies|best companies|hiring companies|dream companies)\b/i,
  /^(best |top |latest |new |hiring |jobs in |vacancy|walk.in|work from home|remote jobs)/i,
  /^(software company|tech company|it company|saas company|startup jobs|it jobs|india jobs)/i,
  // Full string is just "<some words> <city>" — likely a search query, not a real name
  /^[a-z\s]+(pune|mumbai|delhi|bangalore|hyderabad|chennai|noida|gurgaon|gurugram|kolkata)(\s+india)?$/i,
  // Recruiter / staffing / placement middlemen — not the actual hiring company.
  // "Tata Consultancy Services" survives because "services" follows "consultancy"
  // (real IT firm), whereas "Sharda Consultancy" / "ABC Placement" are recruiters.
  /\bplacement(s)?\b/i,
  /\bstaffing\b/i,
  /\bmanpower\b/i,
  /\bhr\s+(services|solutions|consult)/i,
  /\bconsultancy\b(?!\s+services)/i,           // "X Consultancy" but not "X Consultancy Services"
  /\bconsultant(s)?\b(?!\s+(services|pvt|ltd|inc|llp))/i,
  /\brecruit(ment|ers?)\b/i,
  /\bhiring\s+partner\b/i,
  /\b(job\s+consultant|career\s+consultant|talent\s+solutions)\b/i,
  // Placeholder / anonymous employer names
  /^(a\s+|an\s+|the\s+)?(leading|reputed|well[\s-]known|top|mnc|client|confidential|undisclosed)\b/i,
];

/**
 * Returns true if the company name looks like a job title, search query, or aggregator garbage.
 */
function isGarbageCompanyName(name) {
  if (!name || typeof name !== 'string') return true;
  const trimmed = name.trim();
  if (trimmed.length < 3) return true;
  return GARBAGE_PATTERNS.some(re => re.test(trimmed));
}

/**
 * Returns true if the domain belongs to a job board aggregator.
 */
function isJobBoardDomain(domain) {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, '');
  return JOB_BOARD_DOMAINS.some(bd => d === bd || d.endsWith('.' + bd));
}

module.exports = { isGarbageCompanyName, isJobBoardDomain };
