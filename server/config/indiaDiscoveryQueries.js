const INDIA_DISCOVERY_LOCATIONS = [
  "India",
  "Delhi NCR",
  "New Delhi",
  "Noida",
  "Gurugram",
  "Mumbai",
  "Pune",
  "Bengaluru",
  "Bangalore",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Ahmedabad",
  "Jaipur",
  "Chandigarh",
  "Lucknow",
  "Nagpur",
  "Indore",
  "Bhopal",
  "Bhubaneswar",
  "Kochi",
  "Thiruvananthapuram",
  "Coimbatore",
  "Mysuru",
  "Visakhapatnam"
];

const WEB_COMPANY_QUERY_TEMPLATES = [
  "software companies in {location} careers",
  "tech companies in {location} careers",
  "product companies in {location} careers",
  "startup companies in {location} careers",
  "engineering companies in {location} careers",
  "it services companies in {location} careers",
  "consulting companies in {location} careers",
  "enterprise software companies in {location} careers"
];

const WEB_ATS_QUERY_TEMPLATES = [
  "site:boards.greenhouse.io {location}",
  "site:jobs.lever.co {location}",
  "site:jobs.ashbyhq.com {location}",
  "site:jobs.smartrecruiters.com {location}",
  "site:myworkdayjobs.com/en-US {location}",
  "site:apply.workable.com {location}",
  "site:jobs.jobvite.com {location}",
  "site:recruitee.com {location}"
];

const WORKDAY_QUERY_TEMPLATES = [
  "site:myworkdayjobs.com/en-US {location}",
  "site:myworkdayjobs.com/en-US {location} India",
  "site:myworkdayjobs.com/en-US {location} careers"
];

function buildQueriesFromTemplates(kind, templates, locations, source) {
  const queries = [];
  const seen = new Set();

  for (const location of locations) {
    for (const template of templates) {
      const query = template.replace(/\{location\}/g, location).trim();

      if (!query || seen.has(query.toLowerCase())) {
        continue;
      }

      seen.add(query.toLowerCase());
      queries.push({
        kind,
        query,
        enabled: true,
        source,
        order: queries.length + 1
      });
    }
  }

  return queries;
}

function buildIndiaWideDiscoveryQueries(kind) {
  const normalizedKind = String(kind || "").toLowerCase().trim();

  if (normalizedKind === "web-company") {
    const coreQueries = [
      { kind: normalizedKind, query: "indian tech companies careers", enabled: true, source: "india-wide-bootstrap", order: 1 },
      { kind: normalizedKind, query: "india software companies careers", enabled: true, source: "india-wide-bootstrap", order: 2 },
      { kind: normalizedKind, query: "india product companies careers", enabled: true, source: "india-wide-bootstrap", order: 3 },
      { kind: normalizedKind, query: "india startup companies careers", enabled: true, source: "india-wide-bootstrap", order: 4 },
      { kind: normalizedKind, query: "india enterprise software companies careers", enabled: true, source: "india-wide-bootstrap", order: 5 },
      { kind: normalizedKind, query: "india it services companies careers", enabled: true, source: "india-wide-bootstrap", order: 6 },
      { kind: normalizedKind, query: "india consulting companies careers", enabled: true, source: "india-wide-bootstrap", order: 7 },
      { kind: normalizedKind, query: "india engineering jobs companies careers", enabled: true, source: "india-wide-bootstrap", order: 8 }
    ];

    const geoQueries = buildQueriesFromTemplates(
      normalizedKind,
      WEB_COMPANY_QUERY_TEMPLATES,
      INDIA_DISCOVERY_LOCATIONS,
      "india-wide-bootstrap"
    );

    const atsQueries = buildQueriesFromTemplates(
      normalizedKind,
      WEB_ATS_QUERY_TEMPLATES,
      INDIA_DISCOVERY_LOCATIONS,
      "india-wide-bootstrap"
    );

    return [...coreQueries, ...geoQueries, ...atsQueries];
  }

  if (normalizedKind === "workday-board") {
    const coreQueries = [
      { kind: normalizedKind, query: "site:myworkdayjobs.com/en-US India", enabled: true, source: "india-wide-bootstrap", order: 1 },
      { kind: normalizedKind, query: "site:myworkdayjobs.com/en-US careers India", enabled: true, source: "india-wide-bootstrap", order: 2 },
      { kind: normalizedKind, query: "site:myworkdayjobs.com/en-US jobs India", enabled: true, source: "india-wide-bootstrap", order: 3 }
    ];

    const geoQueries = buildQueriesFromTemplates(
      normalizedKind,
      WORKDAY_QUERY_TEMPLATES,
      INDIA_DISCOVERY_LOCATIONS,
      "india-wide-bootstrap"
    );

    return [...coreQueries, ...geoQueries];
  }

  return [];
}

module.exports = {
  INDIA_DISCOVERY_LOCATIONS,
  buildIndiaWideDiscoveryQueries
};
