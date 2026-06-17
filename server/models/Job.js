const mongoose = require("mongoose");
const { buildJobIdentity } = require("../utils/jobIdentity");

const DIRECT_SOURCES = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workday"]);

function defaultSourceType() {
  return DIRECT_SOURCES.has(this.source) ? "ats" : "aggregator";
}

function defaultSourceQuality() {
  return DIRECT_SOURCES.has(this.source) ? 90 : 60;
}

const jobSchema = new mongoose.Schema({
  title:               { type: String },
  company:             { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
  location:            { type: String },
  applyLink:           { type: String },
  canonicalApplyLink:  { type: String, default: null },
  description:         { type: String },
  source:              { type: String },
  normalizedTitle:     { type: String, default: null },
  normalizedLocation:  { type: String, default: null },
  sourceType:          { type: String, default: defaultSourceType },
  sourceQuality:       { type: Number, default: defaultSourceQuality },
  postedDate:          { type: Date },
  isActive:            { type: Boolean, default: true },
  firstSeenAt:         { type: Date, default: Date.now },
  lastSeenAt:          { type: Date, default: Date.now },
  fetchedAt:           { type: Date, default: Date.now },
  isRemote:            { type: Boolean, default: false },
  experienceLevel:     { type: String, enum: ['fresher', 'mid', 'senior'], default: null },
  yearsMin:            { type: Number, default: null },
  yearsMax:            { type: Number, default: null },
  experienceText:      { type: String, default: null },
  requiredSkills:      { type: [String], default: [] },
  qualifications:      { type: [String], default: [] },
  responsibilityBullets: { type: [String], default: [] },
  extractionConfidence: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  parsedDescriptionAt: { type: Date, default: null },
  lastSearchedAt:      { type: Date, default: null },
  searchHitCount:      { type: Number, default: 0 },
  applyClickCount:     { type: Number, default: 0 },
  // Semantic search: local bge-base-en-v1.5 embedding of buildEmbedText(job)
  // (768 floats). Similarity is computed in-process via cosine (see
  // services/skillBasedJobSearchService.js + docs/semantic-search.md), not by an
  // Atlas Vector Search index. embedHash lets ingestion skip re-embedding a job
  // whose searchable content hasn't changed.
  embedding:           { type: [Number], default: null, select: false },
  embedHash:           { type: String, default: null },
  embeddedAt:          { type: Date, default: null }
});

jobSchema.pre("validate", function setJobIdentity() {
  const identity = buildJobIdentity({
    title:    this.title,
    location: this.location,
    applyLink: this.applyLink
  });
  this.normalizedTitle    = identity.normalizedTitle || null;
  this.normalizedLocation = identity.normalizedLocation || "india";
  this.canonicalApplyLink = identity.canonicalApplyLink;
});

// Deduplication — unique job per company by canonical URL
jobSchema.index(
  { company: 1, canonicalApplyLink: 1 },
  { unique: true, partialFilterExpression: { canonicalApplyLink: { $type: "string" } } }
);

// Deduplication — unique job per company by title + location
jobSchema.index(
  { company: 1, normalizedTitle: 1, normalizedLocation: 1 },
  { unique: true }
);

// Used by job alert digest: filter active jobs seen since a given date
jobSchema.index({ isActive: 1, firstSeenAt: -1 });

// Individual field indexes kept for partial lookups
jobSchema.index({ canonicalApplyLink: 1 });
jobSchema.index({ normalizedTitle: 1 });
jobSchema.index({ normalizedLocation: 1 });

module.exports = mongoose.model("Job", jobSchema);
