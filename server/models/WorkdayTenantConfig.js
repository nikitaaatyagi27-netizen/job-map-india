const mongoose = require("mongoose");

// Caches per-tenant Workday CXS API metadata. Lets us hit a tenant's /jobs
// endpoint with the India country facet UUID applied directly, avoiding a
// fresh facets-discovery round-trip on every ingestion run.
const WorkdayTenantConfigSchema = new mongoose.Schema({
  tenant: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },

  host: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },

  site: {
    type: String,
    required: true,
    trim: true
  },

  locale: {
    type: String,
    default: "en-US"
  },

  // Workday's WID for India in this tenant's country facet. May be the global
  // standard "bc33aa3152ec42d4995f4791a106ed09" or a tenant-specific UUID.
  // null = no India entry found in the tenant's facets (no India hiring).
  indiaCountryUuid: {
    type: String,
    default: null
  },

  // Which facet parameter the tenant uses for country (locationCountry,
  // Location_Country, country, etc.) — different Workday versions vary.
  countryFacetKey: {
    type: String,
    default: null
  },

  // Total job count when last checked (sanity signal — if this drops to 0
  // for many runs, the tenant likely closed its India hiring).
  lastIndiaJobCount: {
    type: Number,
    default: 0
  },

  lastSyncedAt: {
    type: Date,
    default: null
  },

  lastError: {
    type: String,
    default: null
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

WorkdayTenantConfigSchema.index(
  { host: 1, site: 1 },
  { unique: true }
);

module.exports = mongoose.model("WorkdayTenantConfig", WorkdayTenantConfigSchema);
