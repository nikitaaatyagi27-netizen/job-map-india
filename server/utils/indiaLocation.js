// =============================================================================
// India location intelligence — single source of truth for "is this an India
// job?" classification, used by every ingestion service and the live skill
// search. Replaces ten different ad-hoc keyword arrays scattered across
// services that each missed different cities and silently dropped real jobs.
// =============================================================================

// ---------------------------------------------------------------------------
// 1. Cities — comprehensive coords table
//    Tier-1 metros + tier-2 hubs + tier-3 growing cities + key NCR/MMR
// ---------------------------------------------------------------------------
const INDIAN_CITY_COORDS = {
  // Tier-1 metros + NCR
  bangalore: { lat: 12.9716, lng: 77.5946 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  pune: { lat: 18.5204, lng: 73.8567 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  navimumbai: { lat: 19.033, lng: 73.0297 },
  thane: { lat: 19.2183, lng: 72.9781 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  delhi: { lat: 28.6139, lng: 77.209 },
  newdelhi: { lat: 28.6139, lng: 77.209 },
  noida: { lat: 28.5355, lng: 77.391 },
  greaternoida: { lat: 28.4744, lng: 77.504 },
  gurugram: { lat: 28.4595, lng: 77.0266 },
  gurgaon: { lat: 28.4595, lng: 77.0266 },
  faridabad: { lat: 28.4089, lng: 77.3178 },
  ghaziabad: { lat: 28.6692, lng: 77.4538 },
  kolkata: { lat: 22.5726, lng: 88.3639 },

  // Tier-2 hubs (very common in tech postings)
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  gandhinagar: { lat: 23.2156, lng: 72.6369 },
  surat: { lat: 21.1702, lng: 72.8311 },
  vadodara: { lat: 22.3072, lng: 73.1812 },
  rajkot: { lat: 22.3039, lng: 70.8022 },
  nashik: { lat: 19.9975, lng: 73.7898 },
  aurangabad: { lat: 19.8762, lng: 75.3433 },
  kolhapur: { lat: 16.705, lng: 74.2433 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  jodhpur: { lat: 26.2389, lng: 73.0243 },
  udaipur: { lat: 24.5854, lng: 73.7125 },
  kota: { lat: 25.2138, lng: 75.8648 },
  ajmer: { lat: 26.4499, lng: 74.6399 },
  lucknow: { lat: 26.8467, lng: 80.9462 },
  kanpur: { lat: 26.4499, lng: 80.3319 },
  varanasi: { lat: 25.3176, lng: 82.9739 },
  prayagraj: { lat: 25.4358, lng: 81.8463 },
  agra: { lat: 27.1767, lng: 78.0081 },
  meerut: { lat: 28.9845, lng: 77.7064 },
  bareilly: { lat: 28.367, lng: 79.4304 },
  aligarh: { lat: 27.8974, lng: 78.088 },
  gorakhpur: { lat: 26.7606, lng: 83.3732 },
  nagpur: { lat: 21.1458, lng: 79.0882 },
  indore: { lat: 22.7196, lng: 75.8577 },
  bhopal: { lat: 23.2599, lng: 77.4126 },
  jabalpur: { lat: 23.1815, lng: 79.9864 },
  gwalior: { lat: 26.2183, lng: 78.1828 },
  bhubaneswar: { lat: 20.2961, lng: 85.8245 },
  cuttack: { lat: 20.4625, lng: 85.8828 },
  patna: { lat: 25.5941, lng: 85.1376 },
  ranchi: { lat: 23.3441, lng: 85.3096 },
  jamshedpur: { lat: 22.8046, lng: 86.2029 },
  raipur: { lat: 21.2514, lng: 81.6296 },
  bhilai: { lat: 21.1938, lng: 81.3509 },
  guwahati: { lat: 26.1445, lng: 91.7362 },
  shillong: { lat: 25.5788, lng: 91.8933 },
  imphal: { lat: 24.817, lng: 93.9368 },
  aizawl: { lat: 23.7271, lng: 92.7176 },
  itanagar: { lat: 27.0844, lng: 93.6053 },
  agartala: { lat: 23.8315, lng: 91.2868 },
  kohima: { lat: 25.6747, lng: 94.1077 },
  gangtok: { lat: 27.3389, lng: 88.6065 },
  silchar: { lat: 24.8333, lng: 92.7789 },
  dibrugarh: { lat: 27.4728, lng: 94.912 },

  // North + Punjab + Himalayas
  chandigarh: { lat: 30.7333, lng: 76.7794 },
  mohali: { lat: 30.7046, lng: 76.7179 },
  panchkula: { lat: 30.6942, lng: 76.8606 },
  ludhiana: { lat: 30.901, lng: 75.8573 },
  amritsar: { lat: 31.634, lng: 74.8723 },
  jalandhar: { lat: 31.326, lng: 75.5762 },
  patiala: { lat: 30.3398, lng: 76.3869 },
  dehradun: { lat: 30.3165, lng: 78.0322 },
  haridwar: { lat: 29.9457, lng: 78.1642 },
  roorkee: { lat: 29.8543, lng: 77.8881 },
  shimla: { lat: 31.1048, lng: 77.1734 },
  srinagar: { lat: 34.0837, lng: 74.7973 },
  jammu: { lat: 32.7266, lng: 74.857 },
  hisar: { lat: 29.1492, lng: 75.7217 },
  karnal: { lat: 29.6857, lng: 76.9905 },
  rohtak: { lat: 28.8955, lng: 76.6066 },
  sonipat: { lat: 28.9931, lng: 77.0151 },
  panipat: { lat: 29.3909, lng: 76.9635 },

  // South — Kerala, Karnataka, TN, AP, Telangana
  kochi: { lat: 9.9312, lng: 76.2673 },
  ernakulam: { lat: 9.9816, lng: 76.2999 },
  thiruvananthapuram: { lat: 8.5241, lng: 76.9366 },
  trivandrum: { lat: 8.5241, lng: 76.9366 },
  kozhikode: { lat: 11.2588, lng: 75.7804 },
  calicut: { lat: 11.2588, lng: 75.7804 },
  thrissur: { lat: 10.5276, lng: 76.2144 },
  kollam: { lat: 8.8932, lng: 76.6141 },
  coimbatore: { lat: 11.0168, lng: 76.9558 },
  madurai: { lat: 9.9252, lng: 78.1198 },
  tiruchirappalli: { lat: 10.7905, lng: 78.7047 },
  trichy: { lat: 10.7905, lng: 78.7047 },
  tirunelveli: { lat: 8.7139, lng: 77.7567 },
  salem: { lat: 11.6643, lng: 78.146 },
  erode: { lat: 11.341, lng: 77.7172 },
  tirupur: { lat: 11.1085, lng: 77.3411 },
  vellore: { lat: 12.9165, lng: 79.1325 },
  pondicherry: { lat: 11.9416, lng: 79.8083 },
  puducherry: { lat: 11.9416, lng: 79.8083 },
  mysuru: { lat: 12.2958, lng: 76.6394 },
  mysore: { lat: 12.2958, lng: 76.6394 },
  mangaluru: { lat: 12.9141, lng: 74.856 },
  mangalore: { lat: 12.9141, lng: 74.856 },
  hubli: { lat: 15.3647, lng: 75.124 },
  hubballi: { lat: 15.3647, lng: 75.124 },
  belgaum: { lat: 15.8497, lng: 74.4977 },
  belagavi: { lat: 15.8497, lng: 74.4977 },
  davanagere: { lat: 14.4644, lng: 75.9216 },
  visakhapatnam: { lat: 17.6868, lng: 83.2185 },
  vizag: { lat: 17.6868, lng: 83.2185 },
  vijayawada: { lat: 16.5062, lng: 80.648 },
  guntur: { lat: 16.3067, lng: 80.4365 },
  nellore: { lat: 14.4426, lng: 79.9865 },
  tirupati: { lat: 13.6288, lng: 79.4192 },
  kakinada: { lat: 16.9891, lng: 82.2475 },
  warangal: { lat: 17.9784, lng: 79.6 },

  // East / WB
  asansol: { lat: 23.6739, lng: 86.9524 },
  durgapur: { lat: 23.5204, lng: 87.3119 },
  siliguri: { lat: 26.7271, lng: 88.3953 },
  kharagpur: { lat: 22.346, lng: 87.232 },
  howrah: { lat: 22.5958, lng: 88.2636 },

  // Goa
  goa: { lat: 15.4909, lng: 73.8278 },
  panaji: { lat: 15.4909, lng: 73.8278 },
  panjim: { lat: 15.4909, lng: 73.8278 },
  margao: { lat: 15.2832, lng: 73.9862 },
  vasco: { lat: 15.3961, lng: 73.8157 }
};

// ---------------------------------------------------------------------------
// 2. City aliases — historical names, airport codes, tech-park nicknames
//    All keys MUST be 4+ characters to avoid false positives like "del" in
//    "Delaware" or "blr" in "Blair Rd". (Airport codes are useful but risky;
//    we accept the tradeoff of missing some informal postings.)
// ---------------------------------------------------------------------------
const CITY_ALIASES = {
  // Historical / colonial names
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  cawnpore: "kanpur",
  poona: "pune",
  baroda: "vadodara",
  allahabad: "prayagraj",

  // Tech parks / micro-locations within Bangalore
  whitefield: "bangalore",
  electroniccity: "bangalore",
  electronic: "bangalore", // careful — but used in "Electronic City" almost exclusively
  koramangala: "bangalore",
  indiranagar: "bangalore",
  marathahalli: "bangalore",
  sarjapur: "bangalore",
  bellandur: "bangalore",
  hebbal: "bangalore",
  manyata: "bangalore",
  hsrlayout: "bangalore",
  outerringroad: "bangalore",

  // Hyderabad tech parks
  hitec: "hyderabad",
  hitech: "hyderabad",
  gachibowli: "hyderabad",
  madhapur: "hyderabad",
  kondapur: "hyderabad",
  nanakramguda: "hyderabad",

  // Pune tech parks
  hinjewadi: "pune",
  hinjawadi: "pune",
  pimprichinchwad: "pune",
  pimpri: "pune",
  chinchwad: "pune",
  kharadi: "pune",
  magarpatta: "pune",
  vimannagar: "pune",

  // Mumbai tech parks
  bandrakurla: "mumbai",
  powai: "mumbai",
  andheri: "mumbai",
  goregaon: "mumbai",

  // Chennai tech parks
  sholinganallur: "chennai",
  tidelpark: "chennai",
  tambaram: "chennai",
  adyar: "chennai",

  // Gurugram tech parks
  cybercity: "gurugram",
  cyberhub: "gurugram",
  udyogvihar: "gurugram",
  golfcourseroad: "gurugram"
};

// ---------------------------------------------------------------------------
// 3. Indian states & UTs — names + safe aliases
//    Aliases here MUST be unambiguous — we deliberately exclude two-letter
//    state codes (UP, MP, TN, AP, KA, etc.) because they collide with English
//    words ("up"), HR/business jargon, US states, and ISO codes.
// ---------------------------------------------------------------------------
const INDIAN_STATES = {
  "andhra pradesh": { capital: "vijayawada" },
  "arunachal pradesh": { capital: "itanagar" },
  assam: { capital: "guwahati" },
  bihar: { capital: "patna" },
  chhattisgarh: { capital: "raipur", aliases: ["chattisgarh"] },
  goa: { capital: "panaji" },
  gujarat: { capital: "ahmedabad" },
  haryana: { capital: "gurugram" },
  "himachal pradesh": { capital: "shimla" },
  jharkhand: { capital: "ranchi" },
  karnataka: { capital: "bangalore" },
  kerala: { capital: "kochi" },
  "madhya pradesh": { capital: "indore" },
  maharashtra: { capital: "mumbai" },
  manipur: { capital: "imphal" },
  meghalaya: { capital: "shillong" },
  mizoram: { capital: "aizawl" },
  nagaland: { capital: "kohima" },
  odisha: { capital: "bhubaneswar", aliases: ["orissa"] },
  punjab: { capital: "chandigarh" },
  rajasthan: { capital: "jaipur" },
  sikkim: { capital: "gangtok" },
  "tamil nadu": { capital: "chennai", aliases: ["tamilnadu"] },
  telangana: { capital: "hyderabad" },
  tripura: { capital: "agartala" },
  "uttar pradesh": { capital: "lucknow" },
  uttarakhand: { capital: "dehradun", aliases: ["uttaranchal"] },
  "west bengal": { capital: "kolkata" },
  // UTs
  chandigarh: { capital: "chandigarh" },
  "jammu and kashmir": { capital: "srinagar", aliases: ["jammu & kashmir", "j&k"] },
  ladakh: { capital: "leh" },
  puducherry: { capital: "puducherry", aliases: ["pondicherry"] }
};

// ---------------------------------------------------------------------------
// 4. Region aggregates — NCR, MMR, etc.
// ---------------------------------------------------------------------------
const REGION_ALIASES = {
  ncr: "delhi",
  "delhi ncr": "delhi",
  "national capital region": "delhi",
  "delhi-ncr": "delhi",
  mmr: "mumbai",
  "mumbai metropolitan region": "mumbai",
  "south india": "bangalore",
  "north india": "delhi",
  "west india": "mumbai",
  "east india": "kolkata"
};

// ---------------------------------------------------------------------------
// 5. Ambiguous keywords — only count as India if companyMeta says so
// ---------------------------------------------------------------------------
const AMBIGUOUS_KEYWORDS = [
  "remote",
  "work from home",
  "wfh",
  "anywhere",
  "multiple locations",
  "various locations",
  "distributed",
  "fully remote",
  "global",
  "worldwide"
];

// ---------------------------------------------------------------------------
// 6. Spread metros + India bbox
// ---------------------------------------------------------------------------
const SPREAD_METROS = [
  "bangalore", "hyderabad", "pune", "mumbai", "chennai",
  "delhi", "noida", "gurugram", "kolkata", "ahmedabad"
];

const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

const INDIA_BBOX = {
  latMin: 6,
  latMax: 37,
  lngMin: 68,
  lngMax: 97
};

// ===========================================================================
// Internal helpers
// ===========================================================================

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function lowerTrim(value) {
  return String(value || "").toLowerCase().trim();
}

// Word-boundary regex match (Latin word chars only — fine for our keyword set)
function containsWord(haystack, needle) {
  if (!haystack || !needle) return false;
  const pattern = new RegExp(`\\b${escapeRegex(needle)}\\b`, "i");
  return pattern.test(haystack);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Resolve a city/alias key to its canonical key in INDIAN_CITY_COORDS
function resolveCanonicalCity(key) {
  if (!key) return null;
  if (INDIAN_CITY_COORDS[key]) return key;
  const aliased = CITY_ALIASES[key];
  if (aliased && INDIAN_CITY_COORDS[aliased]) return aliased;
  return null;
}

// ===========================================================================
// Public API
// ===========================================================================

function lookupCityCoords(name) {
  const key = normalizeKey(name);
  if (!key) return null;
  const canonical = resolveCanonicalCity(key);
  if (canonical) return INDIAN_CITY_COORDS[canonical];

  // Try state name match (returns capital city's coords)
  const lower = lowerTrim(name);
  if (INDIAN_STATES[lower]) {
    const cap = INDIAN_STATES[lower].capital;
    return INDIAN_CITY_COORDS[cap] || null;
  }

  // Region (NCR, MMR, etc.)
  if (REGION_ALIASES[lower]) {
    const target = REGION_ALIASES[lower];
    return INDIAN_CITY_COORDS[target] || null;
  }

  return null;
}

// Try to find an Indian-city / state / region match anywhere in a free-form
// location string. Returns the canonical city's coords on hit.
function extractIndianCityCoords(text) {
  if (!text) return null;
  const original = String(text);
  const lower = original.toLowerCase();

  // 1. Token-level lookup (fast path) — split on common separators
  const tokens = lower
    .split(/[,/|\\\-()]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const direct = lookupCityCoords(token);
    if (direct) return direct;
  }

  // 2. Multi-word region / state match (NCR, "Delhi NCR", "Tamil Nadu")
  for (const region of Object.keys(REGION_ALIASES)) {
    if (lower.includes(region)) {
      return lookupCityCoords(region);
    }
  }

  for (const state of Object.keys(INDIAN_STATES)) {
    if (containsWord(lower, state)) {
      return lookupCityCoords(state);
    }
    const aliases = INDIAN_STATES[state].aliases || [];
    for (const alias of aliases) {
      if (containsWord(lower, alias)) {
        return lookupCityCoords(state);
      }
    }
  }

  // 3. Substring sweep for cities — handles "Office park, Bangalore - 560001"
  //    Sort by length descending so "navi mumbai" wins over "mumbai".
  const cityKeys = Object.keys(INDIAN_CITY_COORDS).concat(Object.keys(CITY_ALIASES));
  cityKeys.sort((a, b) => b.length - a.length);

  for (const cityKey of cityKeys) {
    if (cityKey.length < 4) continue; // skip risky short keys
    if (lower.includes(cityKey)) {
      const canonical = resolveCanonicalCity(cityKey);
      if (canonical) return INDIAN_CITY_COORDS[canonical];
    }
  }

  return null;
}

// =============================================================================
// THE classifier — replaces every per-service India-keyword array.
//
// Decision flow:
//   1. Word-boundary "india" anywhere → true
//   2. Indian state name (or unambiguous alias) → true
//   3. Indian region (NCR, MMR, "South India") → true
//   4. Indian city or city-alias → true
//   5. Ambiguous keyword (Remote, WFH, etc.) AND options.hasIndianPresence → true
//   6. Otherwise → false
//
// Note we do NOT hard-reject on non-India keywords. A multi-location string
// like "San Francisco / Bangalore" should match because the India variant is
// real. The presence of an India signal wins; absence means "no India variant".
// =============================================================================
function isIndianLocation(locationString, options = {}) {
  if (!locationString || typeof locationString !== "string") {
    // Empty/missing location can be ambiguous remote
    return Boolean(options.hasIndianPresence) && !options.requireExplicit;
  }

  const lower = locationString.toLowerCase().trim();
  if (!lower) {
    return Boolean(options.hasIndianPresence) && !options.requireExplicit;
  }

  // 1. Word-boundary "india"
  if (/\bindia\b/.test(lower)) return true;

  // 2. State names + safe aliases
  for (const state of Object.keys(INDIAN_STATES)) {
    if (containsWord(lower, state)) return true;
    const aliases = INDIAN_STATES[state].aliases || [];
    for (const alias of aliases) {
      if (containsWord(lower, alias)) return true;
    }
  }

  // 3. Regions
  for (const region of Object.keys(REGION_ALIASES)) {
    if (lower.includes(region)) return true;
  }

  // 4. Cities + city aliases — substring is fine since all keys are 4+ chars
  for (const cityKey of Object.keys(INDIAN_CITY_COORDS)) {
    if (cityKey.length < 4) continue;
    if (lower.includes(cityKey)) return true;
  }
  for (const aliasKey of Object.keys(CITY_ALIASES)) {
    if (aliasKey.length < 4) continue;
    if (lower.includes(aliasKey)) return true;
  }

  // 5. Ambiguous + company has India presence
  if (options.hasIndianPresence) {
    for (const ambig of AMBIGUOUS_KEYWORDS) {
      if (lower.includes(ambig)) return true;
    }
  }

  return false;
}

// Legacy helper — kept for callers that need the strict India-center detection
function isIndiaCenter(coords) {
  if (!coords) return false;
  const { lat, lng } = coords;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat - INDIA_CENTER.lat) < 0.05 &&
    Math.abs(lng - INDIA_CENTER.lng) < 0.05
  );
}

// Deterministic city pick for India-only companies — keeps them stable across reloads
function spreadCoordsForCompany(name) {
  const key = String(name || "unknown");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % SPREAD_METROS.length;
  return INDIAN_CITY_COORDS[SPREAD_METROS[index]];
}

// Bbox check — used by callers who geocode and want to verify India
function isWithinIndiaBBox(coords) {
  if (!coords) return false;
  const { lat, lng } = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= INDIA_BBOX.latMin && lat <= INDIA_BBOX.latMax &&
    lng >= INDIA_BBOX.lngMin && lng <= INDIA_BBOX.lngMax
  );
}

module.exports = {
  // Constants
  INDIAN_CITY_COORDS,
  CITY_ALIASES,
  INDIAN_STATES,
  REGION_ALIASES,
  AMBIGUOUS_KEYWORDS,
  SPREAD_METROS,
  INDIA_CENTER,
  INDIA_BBOX,

  // The new classifier — use this for all India filtering
  isIndianLocation,

  // Coord lookups
  lookupCityCoords,
  extractIndianCityCoords,
  spreadCoordsForCompany,

  // Coord validators
  isIndiaCenter,
  isWithinIndiaBBox
};
