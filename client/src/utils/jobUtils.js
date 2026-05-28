export const SOURCE_LABELS = {
  greenhouse:      'Greenhouse',
  lever:           'Lever',
  ashby:           'Ashby',
  smartrecruiters: 'SmartRecruiters',
  jsearch:         'JSearch',
  naukri:          'Naukri',
  db:              'Database',
};

export const ATS_COLORS = {
  greenhouse:      { bg: '#e8f5e9', color: '#1b5e20' },
  lever:           { bg: '#e3f2fd', color: '#0d47a1' },
  ashby:           { bg: '#f3e5f5', color: '#4a148c' },
  smartrecruiters: { bg: '#fff3e0', color: '#e65100' },
  workday:         { bg: '#fce4ec', color: '#880e4f' },
  taleo:           { bg: '#f1f8e9', color: '#33691e' },
  successfactors:  { bg: '#e8eaf6', color: '#1a237e' },
};

export const TREND_ICON = {
  accelerating: '🔥',
  stable:       '📊',
  slowing:      '📉',
};

// Only strong, unambiguous title signals — "Jr." / "Junior" deliberately excluded
const TITLE_SENIOR_RE  = /\bsenior\b|\bsr[\.\s]|\blead\b|\bstaff\b|\bprincipal\b|\barchitect\b|\bhead\s+of\b|\bmanager\b|\bdirector\b|\bvp\b|vice\s*president/i;
const TITLE_FRESHER_RE = /\bfresher\b|\btrainee\b|\bintern(?:ship)?\b|\bentry[\s-]?level\b|\bgraduate\b|0[-–][12]\s*(?:year|yr)/i;

const RANGE_RE = /\b(\d+)\s*(?:[-–]|to)\s*(\d+)\s*(?:year|yr)/i;
const MIN_RE = /\b(\d+)\+?\s*(?:year|yr)s?\s*(?:of\s+)?(?:relevant\s+|work\s+|industry\s+|professional\s+|hands[- ]on\s+)?(?:experience|exp)/i;
const ZERO_RE = /0\s*(?:year|yr)s?\s*(?:of\s+)?(?:experience|exp)|no\s+(?:prior\s+)?experience\s+required|freshers?\s+(?:can\s+)?apply|open\s+to\s+freshers?/i;

function levelFromYears(min, max = null) {
  if (min === 0 && max != null && max <= 2) return 'fresher';
  if (max != null && max <= 1) return 'fresher';
  if (min >= 5 || (max != null && max >= 8)) return 'senior';
  if (min >= 2 || (max != null && max >= 4)) return 'mid';
  return null;
}

function detectExperienceFromText(text) {
  if (!text) return null;
  if (ZERO_RE.test(text)) return 'fresher';

  let match = text.match(RANGE_RE);
  if (match) return levelFromYears(Number(match[1]), Number(match[2]));

  match = text.match(MIN_RE);
  if (match) return levelFromYears(Number(match[1]));

  return null;
}

// detectExperience is the client-side fallback used only when the server
// hasn't stored an experienceLevel on the role yet.
export function detectExperience(title) {
  if (!title) return null;
  if (TITLE_SENIOR_RE.test(title))  return 'senior';
  if (TITLE_FRESHER_RE.test(title)) return 'fresher';
  return null; // unknown — callers decide
}

// Returns the effective experience level for a role object.
// Uses server-stored value first; falls back to title heuristic.
export function getRoleLevel(role) {
  if (!role) return null;

  if (role.yearsMin != null) {
    const fromYears = levelFromYears(
      Number(role.yearsMin),
      role.yearsMax == null ? null : Number(role.yearsMax)
    );
    if (fromYears) return fromYears;
  }

  return detectExperienceFromText(role.description)
    || role.experienceLevel
    || detectExperience(role.title)
    || null;
}

export function daysAgo(dateStr) {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function jobAgeDays(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}
