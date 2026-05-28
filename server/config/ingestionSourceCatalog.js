const { fetchJSearchJobs } = require("../services/jsearchService");
const fetchGreenhouseJobs = require("../services/greenhouseService");
const fetchLeverJobs = require("../services/leverService");
const fetchAshbyJobs = require("../services/ashbyService");
const fetchSmartRecruitersJobs = require("../services/smartRecruitersService");
const fetchArbeitnowJobs = require("../services/arbeitnowService");
const fetchAdzunaJobs = require("../services/adzunaService");
const fetchRemotiveJobs = require("../services/remotiveService");
const fetchNaukriJobs = require("../services/naukriService");
const { fetchWorkdayJobs } = require("../services/workdayService");
const { fetchSuccessFactorsJobs } = require("../services/successFactorsService");
const { fetchTaleoJobs } = require("../services/taleoService");
const { fetchUniversalJobs } = require("../services/universalCareerSourceService");

const INGESTION_SOURCE_CATALOG = [
  {
    key: "workday",
    label: "Workday",
    handler: fetchWorkdayJobs,
    basePriority: 95,
    category: "direct-career-board"
  },
  {
    key: "successfactors",
    label: "SAP SuccessFactors",
    handler: fetchSuccessFactorsJobs,
    basePriority: 93,
    category: "direct-career-board"
  },
  {
    key: "taleo",
    label: "Oracle Taleo",
    handler: fetchTaleoJobs,
    basePriority: 91,
    category: "direct-career-board"
  },
  {
    key: "greenhouse",
    label: "Greenhouse",
    handler: fetchGreenhouseJobs,
    basePriority: 92,
    category: "direct-career-board"
  },
  {
    key: "lever",
    label: "Lever",
    handler: fetchLeverJobs,
    basePriority: 90,
    category: "direct-career-board"
  },
  {
    key: "ashby",
    label: "Ashby",
    handler: fetchAshbyJobs,
    basePriority: 90,
    category: "direct-career-board"
  },
  {
    key: "smartrecruiters",
    label: "SmartRecruiters",
    handler: fetchSmartRecruitersJobs,
    basePriority: 88,
    category: "direct-career-board"
  },
  {
    key: "naukri",
    label: "Naukri",
    handler: fetchNaukriJobs,
    basePriority: 63,
    category: "aggregator"
  },
  {
    key: "jsearch",
    label: "JSearch",
    handler: fetchJSearchJobs,
    basePriority: 70,
    category: "aggregator"
  },
  {
    key: "adzuna",
    label: "Adzuna",
    handler: fetchAdzunaJobs,
    basePriority: 68,
    category: "aggregator"
  },
  {
    key: "arbeitnow",
    label: "Arbeitnow",
    handler: fetchArbeitnowJobs,
    basePriority: 66,
    category: "aggregator"
  },
  {
    key: "remotive",
    label: "Remotive",
    handler: fetchRemotiveJobs,
    basePriority: 64,
    category: "aggregator"
  },
  {
    key: "universal",
    label: "Universal LLM Scraper",
    handler: fetchUniversalJobs,
    basePriority: 85,
    category: "direct-career-board"
  }
];

function getIngestionSourceCatalog() {
  return INGESTION_SOURCE_CATALOG.map((source) => ({ ...source }));
}

function getIngestionSourceKeys() {
  return INGESTION_SOURCE_CATALOG.map((source) => source.key);
}

function getSourceByKey(key) {
  return INGESTION_SOURCE_CATALOG.find(
    (source) => source.key === String(key || "").toLowerCase().trim()
  ) || null;
}

module.exports = {
  getIngestionSourceCatalog,
  getIngestionSourceKeys,
  getSourceByKey
};
