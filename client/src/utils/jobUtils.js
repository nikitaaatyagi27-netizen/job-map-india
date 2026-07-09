export const SOURCE_LABELS = {
  greenhouse:      'Greenhouse',
  lever:           'Lever',
  ashby:           'Ashby',
  smartrecruiters: 'SmartRecruiters',
  jsearch:         'JSearch',
  naukri:          'Naukri',
  adzuna:          'Adzuna',
  workday:         'Workday',
  taleo:           'Taleo',
  successfactors:  'SuccessFactors',
  universal:       'Company site',
  youtube:         'YouTube',
  db:              'Database',
};

// Per-source chip colors so each source is visually distinct at a glance.
// { bg, color, border }
export const SOURCE_CHIP_COLORS = {
  naukri:          { bg: '#422006', color: '#fbbf24', border: '#a16207' },
  jsearch:         { bg: '#0c1a2e', color: '#60a5fa', border: '#1e40af' },
  adzuna:          { bg: '#1a0e2e', color: '#c084fc', border: '#7c3aed' },
  workday:         { bg: '#0c2a1e', color: '#34d399', border: '#047857' },
  greenhouse:      { bg: '#052e16', color: '#4ade80', border: '#15803d' },
  lever:           { bg: '#172554', color: '#93c5fd', border: '#2563eb' },
  ashby:           { bg: '#1e1b4b', color: '#a5b4fc', border: '#4f46e5' },
  smartrecruiters: { bg: '#2e1065', color: '#c4b5fd', border: '#6d28d9' },
  universal:       { bg: '#2a1a0c', color: '#fdba74', border: '#c2410c' },
  youtube:         { bg: '#450a0a', color: '#fca5a5', border: '#b91c1c' },
  db:              { bg: '#0f172a', color: '#94a3b8', border: '#334155' },
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
const TITLE_SENIOR_RE  = /\bsenior\b|\bsr[.\s]|\blead\b|\bstaff\b|\bprincipal\b|\barchitect\b|\bhead\s+of\b|\bmanager\b|\bdirector\b|\bvp\b|vice\s*president/i;
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
  if (!role) return 'mid';

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
    || 'mid'; // default fallback — always show in at least one category
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
