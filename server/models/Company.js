const mongoose = require("mongoose");
const {
  extractIndianCityCoords,
  spreadCoordsForCompany
} = require("../utils/indiaLocation");

const CompanySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true,
    unique: true
  },

  logo: { type: String },

  domain: { type: String, default: null },

  website: { type: String, default: null },

  careersUrl: { type: String, default: null },

  careersProvider: { type: String, default: null },

  discoverySources: { type: [String], default: [] },

  intelligenceStatus: { type: String, default: "pending" },

  lastIntelligenceAt: { type: Date, default: null },

  city: { type: String },

  location: { type: String },

  lat: { type: Number },

  lng: { type: Number },

  source: { type: String },

  brandingSource: { type: String, default: "none" },

  brandingConfidence: { type: String, default: "low" },

  brandingReasoning: { type: String, default: null },

  isRemote: { type: Boolean, default: false },

  atsProvider: { type: String, default: null },

  hiringVelocity: {
    last7Days:  { type: Number, default: 0 },
    last30Days: { type: Number, default: 0 },
    trend:      { type: String, default: "stable" }  // "accelerating" | "stable" | "slowing"
  },

  createdAt:  { type: Date, default: Date.now },

  updatedAt:  { type: Date, default: Date.now }
});

// Enforce non-null coords at the model level — every company that hits the DB
// is guaranteed to have valid lat/lng so it can render on the map.
// Resolution order (synchronous only — the backfill service handles async upgrades later):
//   1. Static Indian-city lookup on company.location
//   2. Static Indian-city lookup on company.city
//   3. Deterministic metro spread by company name (always returns coords)
CompanySchema.pre("save", function ensureCoords() {                              /// it is to make sure we always have lat and lng , so we will have valid lat and lng then only we will enter in the db . pre("save") runs before touching the db.
  if (Number.isFinite(this.lat) && Number.isFinite(this.lng)) return;

  const fromLocation = extractIndianCityCoords(this.location);
  if (fromLocation) {
    this.lat = fromLocation.lat;
    this.lng = fromLocation.lng;
    return;
  }

  const fromCity = extractIndianCityCoords(this.city);
  if (fromCity) {
    this.lat = fromCity.lat;
    this.lng = fromCity.lng;
    return;
  }

  const spread = spreadCoordsForCompany(this.name);
  this.lat = spread.lat;
  this.lng = spread.lng;
});

module.exports = mongoose.model("Company", CompanySchema);
