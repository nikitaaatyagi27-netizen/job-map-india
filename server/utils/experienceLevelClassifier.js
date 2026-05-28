// Returns 'fresher' | 'mid' | 'senior' | null
// null means "not enough signal to classify" — callers decide how to handle unknowns.

// ── Range patterns: "X-Y years" / "X to Y years" ────────────────────────────
// Forward:  "2-3 years experience", "1 to 2 years of exp"
const RANGE_FWD_RE = /\b(\d+)\s*(?:[-–]|to)\s*(\d+)\s*(?:year|yr)/i;
// Reversed: "experience of 2-3 years"
const RANGE_REV_RE = /(?:experience|exp)\s+of\s+(\d+)\s*(?:[-–]|to)\s*(\d+)\s*(?:year|yr)/i;
// Between:  "between 2 and 5 years"
const RANGE_BTW_RE = /between\s+(\d+)\s+and\s+(\d+)\s*(?:year|yr)/i;

// ── Minimum patterns: "X+ years [of] experience" ────────────────────────────
// Covers "minimum X years", "at least X years", "X+ years experience",
// "X years of relevant/work/professional experience", plain "X years experience"
const MIN_FWD_RE = /(?:(?:minimum|at\s+least|min)\s+(?:of\s+)?)?(\d+)\+?\s*(?:year|yr)s?\s*(?:of\s+)?(?:relevant\s+|work\s+|industry\s+|professional\s+|hands[- ]on\s+)?(?:experience|exp)/i;
// Reversed: "experience of 3+ years"
const MIN_REV_RE = /(?:experience|exp)\s+of\s+(\d+)\+?\s*(?:year|yr)/i;

// ── Zero / fresher ───────────────────────────────────────────────────────────
const ZERO_RE = /0\s*(?:year|yr)s?\s*(?:of\s+)?(?:experience|exp)|no\s+(?:prior\s+)?experience\s+required|freshers?\s+(?:can\s+)?apply|open\s+to\s+freshers?/i;

// ── Title signals (only strong, unambiguous) ─────────────────────────────────
const TITLE_SENIOR_RE  = /\bsenior\b|\bsr[\.\s]|\blead\b|\bstaff\b|\bprincipal\b|\barchitect\b|\bhead\s+of\b|\bmanager\b|\bdirector\b|\bvp\b|vice\s*president/i;
const TITLE_FRESHER_RE = /\bfresher\b|\btrainee\b|\bintern(?:ship)?\b|\bentry[\s-]?level\b|\bgraduate\b|0[-–][12]\s*(?:year|yr)/i;

// "1-5 years": min=1, max=5 → mid (high max overrides low min)
// "5-8 years": min=5 → senior
// "0-2 years": fresher (explicitly open to zero-experience candidates)
function levelFromRange(min, max) {
  if (min === 0 && max <= 2) return 'fresher';
  if (max <= 1)              return 'fresher';
  if (min >= 5 || max >= 8)  return 'senior';
  if (min >= 2 || max >= 4)  return 'mid';
  return null; // "1-2 yrs", "1-3 yrs" — too ambiguous to exclude freshers
}

function levelFromMin(min) {
  if (min === 0) return 'fresher';
  if (min >= 5)  return 'senior';
  if (min >= 2)  return 'mid';
  return null; // "1 year experience" — ambiguous
}

function classifyFromDescription(description) {
  if (!description) return null;
  if (ZERO_RE.test(description)) return 'fresher';

  let m;
  if ((m = description.match(RANGE_FWD_RE))) return levelFromRange(+m[1], +m[2]);
  if ((m = description.match(RANGE_REV_RE))) return levelFromRange(+m[1], +m[2]);
  if ((m = description.match(RANGE_BTW_RE))) return levelFromRange(+m[1], +m[2]);
  if ((m = description.match(MIN_FWD_RE)))   return levelFromMin(+m[1]);
  if ((m = description.match(MIN_REV_RE)))   return levelFromMin(+m[1]);

  return null;
}

function classifyExperienceLevel(title, description) {
  const fromDesc = classifyFromDescription(description);
  if (fromDesc) return fromDesc;

  if (!title) return null;
  if (TITLE_SENIOR_RE.test(title))  return 'senior';
  if (TITLE_FRESHER_RE.test(title)) return 'fresher';

  return null; // "Jr.", "Junior" alone → unknown, not assumed fresher
}

// Returns raw { min, max } years from a description/title string, or null.
// max is null when only a minimum is stated (e.g. "3+ years").
// Used to display "2-3 yrs" on job cards without re-running the full classifier.
function extractYearsRange(text) {
  if (!text) return null;
  let m;
  if ((m = text.match(RANGE_FWD_RE))) return { min: +m[1], max: +m[2] };
  if ((m = text.match(RANGE_REV_RE))) return { min: +m[1], max: +m[2] };
  if ((m = text.match(RANGE_BTW_RE))) return { min: +m[1], max: +m[2] };
  if ((m = text.match(MIN_FWD_RE)))   return { min: +m[1], max: null };
  if ((m = text.match(MIN_REV_RE)))   return { min: +m[1], max: null };
  return null;
}

module.exports = { classifyExperienceLevel, extractYearsRange };
