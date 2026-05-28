const Company = require("../models/Company");
const Job = require("../models/Job");
const getCoords = require("../utils/geocode");
const {
  extractIndianCityCoords,
  spreadCoordsForCompany,
  isIndiaCenter
} = require("../utils/indiaLocation");

// Resolve coords for a single company using the India-aware chain:
//   1. Static Indian-city lookup on company.location / company.city
//   2. Static lookup on each of the company's known job locations
//   3. Google geocode on company.location (skipped if null)
//   4. Google geocode on first job location
//   5. Deterministic metro spread by company name (guaranteed non-null)
async function resolveCompanyCoords(company) {
  // 1. Static city lookup on company-level fields
  for (const candidate of [company.location, company.city]) {
    const c = extractIndianCityCoords(candidate);
    if (c) return { coords: c, source: "static-company" };
  }

  // 2. Static city lookup on attached job locations
  const jobs = await Job.find({ company: company._id })
    .select("location")
    .limit(20)
    .lean();

  for (const job of jobs) {
    const c = extractIndianCityCoords(job.location);
    if (c) return { coords: c, source: "static-job" };
  }

  // 3. Google geocode on company.location (only if it exists)
  if (company.location) {
    const c = await getCoords(company.location);
    if (c && !isIndiaCenter(c)) return { coords: c, source: "geocode-company" };
  }

  // 4. Google geocode on first job location
  for (const job of jobs) {
    if (!job.location) continue;
    const c = await getCoords(job.location);
    if (c && !isIndiaCenter(c)) return { coords: c, source: "geocode-job" };
  }

  // 5. Deterministic metro spread — keeps the company on the map
  return { coords: spreadCoordsForCompany(company.name), source: "metro-spread" };
}

async function backfillCompanyCoords(options = {}) {
  const logger = options.logger || console;
  const limit = Number(options.limit || process.env.COORDS_BACKFILL_LIMIT || 1000);

  const companies = await Company.find({
    $or: [
      { lat: null },
      { lng: null },
      { lat: { $exists: false } },
      { lng: { $exists: false } }
    ]
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  let updatedCount = 0;
  const sourceBreakdown = {};

  for (const company of companies) {
    try {
      const { coords, source } = await resolveCompanyCoords(company);
      company.lat = coords.lat;
      company.lng = coords.lng;
      company.updatedAt = new Date();
      await company.save();

      updatedCount += 1;
      sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
    } catch (error) {
      logger.log(`[COORDS] Failed for ${company.name}: ${error.message}`);
    }
  }

  logger.log(
    `[COORDS] Backfilled ${updatedCount}/${companies.length} companies | ` +
    Object.entries(sourceBreakdown).map(([s, n]) => `${s}: ${n}`).join(" | ")
  );

  return updatedCount;
}

module.exports = {
  backfillCompanyCoords,
  resolveCompanyCoords
};
