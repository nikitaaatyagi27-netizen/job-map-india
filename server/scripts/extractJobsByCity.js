// scripts/extractJobsByCity.js
//
// Extract all jobs for a specific Indian city, matching on:
//   - Job.location / Job.normalizedLocation
//   - Company.city / Company.location
// Uses the repo's own INDIAN_CITY_COORDS/CITY_ALIASES table so "bangalore"
// and "bengaluru" (or any known alias) both resolve to the same city.
//
// Usage:
//   node scripts/extractJobsByCity.js "bangalore"
//   node scripts/extractJobsByCity.js "pune" --json out.json
//   node scripts/extractJobsByCity.js "delhi" --active-only
//
require("dotenv").config();

const connectDB = require("../config/db");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const Job = require("../models/Job");
const Company = require("../models/Company");
const { CITY_ALIASES } = require("../utils/indiaLocation");

function parseArgs() {
  const args = process.argv.slice(2);
  if (!args.length || args[0].startsWith("--")) {
    console.error('Usage: node scripts/extractJobsByCity.js "<city>" [--json out.json] [--active-only]');
    process.exit(1);
  }
  const city = args[0].toLowerCase().trim();
  const jsonFlagIndex = args.indexOf("--json");
  const jsonOut = jsonFlagIndex !== -1 ? args[jsonFlagIndex + 1] : null;
  const activeOnly = args.includes("--active-only");
  return { city, jsonOut, activeOnly };
}

// Build the set of search terms for a city: the city itself, plus any
// alias that maps to it, plus any alias the city itself is an alias of.
function buildCityTerms(city) {
  const terms = new Set([city.replace(/\s+/g, "")]);

  for (const [alias, canonical] of Object.entries(CITY_ALIASES || {})) {
    if (canonical === city || alias === city) {
      terms.add(alias);
      terms.add(canonical);
    }
  }
  return [...terms];
}

async function run() {
  const { city, jsonOut, activeOnly } = parseArgs();
  await connectDB();

  const terms = buildCityTerms(city);
  const pattern = new RegExp(terms.join("|"), "i");
  console.log(`Searching for city "${city}" using terms: ${terms.join(", ")}`);

  // 1. Companies located in this city
  const companies = await Company.find({
    $or: [{ city: pattern }, { location: pattern }]
  }).select("_id name city location lat lng").lean();

  const companyIds = companies.map((c) => c._id);
  const companyById = new Map(companies.map((c) => [String(c._id), c]));

  // 2. Jobs whose OWN location/normalizedLocation matches the city
  //    (covers jobs at companies HQ'd elsewhere but hiring for this city)
  const jobFilter = {
    $or: [
      { location: pattern },
      { normalizedLocation: pattern },
      { company: { $in: companyIds } }
    ]
  };
  if (activeOnly) jobFilter.isActive = true;

  const jobs = await Job.find(jobFilter)
    .populate("company", "name city location lat lng domain")
    .sort({ postedDate: -1 })
    .lean();

  console.log(`\nFound ${jobs.length} job(s) for "${city}" (${companies.length} matching companies)\n`);

  const rows = jobs.map((j) => ({
    title: j.title,
    company: j.company?.name || companyById.get(String(j.company))?.name || "unknown",
    location: j.location,
    isActive: j.isActive,
    postedDate: j.postedDate,
    applyLink: j.applyLink,
    source: j.source
  }));

  rows.forEach((r, i) => {
    console.log(`${i + 1}. [${r.company}] ${r.title} — ${r.location} ${r.isActive ? "" : "(inactive)"}`);
  });

  if (jsonOut) {
    const outPath = path.resolve(jsonOut);
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
    console.log(`\nSaved ${rows.length} jobs to ${outPath}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("extractJobsByCity failed:", error.message);
  process.exit(1);
});