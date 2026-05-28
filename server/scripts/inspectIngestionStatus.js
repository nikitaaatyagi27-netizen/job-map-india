// Quick health/coverage report for the current DB state.
// Run with: node scripts/inspectIngestionStatus.js
//
// Prints, per source:
//   - companies seeded
//   - jobs ingested (active vs total)
//   - geocoding coverage
//   - latest activity
//   - top company examples
// Plus an overall summary, CareerSource registry counts, and a
// "missing-on-map" section showing companies that won't render.

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const Company = require("../models/Company");
const Job = require("../models/Job");
const CareerSource = require("../models/CareerSource");

function pad(value, width) {
  const str = String(value ?? "");
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function printSection(title) {
  console.log("");
  console.log("=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

function fmtDate(d) {
  if (!d) return "never";
  try {
    return new Date(d).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return String(d);
  }
}

async function perSourceCompanyBreakdown() {
  const rows = await Company.aggregate([
    { $group: {
        _id: "$source",
        count: { $sum: 1 },
        geocoded: { $sum: { $cond: [{ $and: [{ $ne: ["$lat", null] }, { $ne: ["$lng", null] }] }, 1, 0] } },
        withDomain: { $sum: { $cond: [{ $ne: ["$domain", null] }, 1, 0] } },
        withLogo: { $sum: { $cond: [{ $ne: ["$logo", null] }, 1, 0] } },
        latest: { $max: "$updatedAt" }
    } },
    { $sort: { count: -1 } }
  ]);

  printSection("COMPANIES per source");
  console.log(
    pad("source", 20) + pad("count", 10) + pad("geocoded", 10) +
    pad("w/domain", 10) + pad("w/logo", 10) + "latest update"
  );
  console.log("-".repeat(72));
  for (const row of rows) {
    console.log(
      pad(row._id || "(none)", 20) +
      pad(row.count, 10) +
      pad(row.geocoded, 10) +
      pad(row.withDomain, 10) +
      pad(row.withLogo, 10) +
      fmtDate(row.latest)
    );
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.count += r.count;
      acc.geocoded += r.geocoded;
      return acc;
    },
    { count: 0, geocoded: 0 }
  );
  console.log("-".repeat(72));
  console.log(`TOTAL companies: ${totals.count} | geocoded: ${totals.geocoded} (${((totals.geocoded / Math.max(totals.count, 1)) * 100).toFixed(1)}%)`);
}

async function perSourceJobBreakdown() {
  const rows = await Job.aggregate([
    { $group: {
        _id: "$source",
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $ne: ["$isActive", false] }, 1, 0] } },
        latest: { $max: "$lastSeenAt" }
    } },
    { $sort: { total: -1 } }
  ]);

  printSection("JOBS per source");
  console.log(
    pad("source", 20) + pad("total", 10) + pad("active", 10) + "last seen"
  );
  console.log("-".repeat(72));
  for (const row of rows) {
    console.log(
      pad(row._id || "(none)", 20) +
      pad(row.total, 10) +
      pad(row.active, 10) +
      fmtDate(row.latest)
    );
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.active += r.active;
      return acc;
    },
    { total: 0, active: 0 }
  );
  console.log("-".repeat(72));
  console.log(`TOTAL jobs: ${totals.total} | active: ${totals.active}`);
}

async function careerSourceRegistryBreakdown() {
  const rows = await CareerSource.aggregate([
    { $group: {
        _id: { provider: "$provider", status: "$status" },
        count: { $sum: 1 }
    } },
    { $sort: { "_id.provider": 1, "_id.status": 1 } }
  ]);

  printSection("CareerSource registry (provider × status)");
  console.log(pad("provider", 20) + pad("status", 16) + "count");
  console.log("-".repeat(72));
  for (const row of rows) {
    console.log(
      pad(row._id.provider || "(none)", 20) +
      pad(row._id.status || "(none)", 16) +
      row.count
    );
  }
}

async function topCompaniesPerSource(limit = 5) {
  const sources = await Company.distinct("source");

  printSection(`TOP ${limit} companies per source (most jobs)`);
  for (const source of sources) {
    if (!source) continue;
    const top = await Job.aggregate([
      { $lookup: { from: "companies", localField: "company", foreignField: "_id", as: "co" } },
      { $unwind: "$co" },
      { $match: { "co.source": source, $or: [{ isActive: true }, { isActive: { $exists: false } }] } },
      { $group: { _id: "$co.name", jobs: { $sum: 1 } } },
      { $sort: { jobs: -1 } },
      { $limit: limit }
    ]);
    console.log(`\n[${source}]`);
    if (top.length === 0) {
      console.log("  (no active jobs)");
      continue;
    }
    for (const t of top) {
      console.log(`  ${pad(t._id, 40)} ${t.jobs} jobs`);
    }
  }
}

async function mapVisibilityCheck() {
  printSection("MAP VISIBILITY — companies that may be invisible on the map");

  const noCoords = await Company.countDocuments({
    $or: [{ lat: null }, { lng: null }, { lat: { $exists: false } }, { lng: { $exists: false } }]
  });

  // India centroid (the geocode fallback we used to use)
  const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };
  const stuckAtCenter = await Company.countDocuments({
    lat: { $gte: INDIA_CENTER.lat - 0.05, $lte: INDIA_CENTER.lat + 0.05 },
    lng: { $gte: INDIA_CENTER.lng - 0.05, $lte: INDIA_CENTER.lng + 0.05 }
  });

  console.log(`Companies missing coords:        ${noCoords}`);
  console.log(`Companies pinned at India center: ${stuckAtCenter}`);

  const totalCompanies = await Company.countDocuments({});
  const visible = totalCompanies - noCoords;
  console.log(`Total companies:                  ${totalCompanies}`);
  console.log(`Visible-on-map (have coords):     ${visible} (${((visible / Math.max(totalCompanies, 1)) * 100).toFixed(1)}%)`);

  const noActiveJobs = await Company.aggregate([
    { $lookup: {
        from: "jobs",
        let: { cid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$company", "$$cid"] }, $or: [{ isActive: true }, { isActive: { $exists: false } }] } },
          { $limit: 1 }
        ],
        as: "activeJob"
    } },
    { $match: { activeJob: { $size: 0 } } },
    { $count: "n" }
  ]);
  const noJobsCount = noActiveJobs[0]?.n || 0;
  console.log(`Companies with NO active jobs:    ${noJobsCount}`);
}

async function recentActivity() {
  printSection("RECENT activity (last 24h)");

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const newCompanies = await Company.countDocuments({ createdAt: { $gte: since } });
  const newJobs = await Job.countDocuments({ firstSeenAt: { $gte: since } });
  const refreshedJobs = await Job.countDocuments({ lastSeenAt: { $gte: since } });

  console.log(`New companies in 24h:  ${newCompanies}`);
  console.log(`New jobs in 24h:       ${newJobs}`);
  console.log(`Jobs refreshed in 24h: ${refreshedJobs}`);
}

async function locationCoverage() {
  printSection("LOCATION coverage (top 15 cities by company count)");

  const rows = await Company.aggregate([
    { $match: { city: { $ne: null, $ne: "" } } },
    { $group: { _id: "$city", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 15 }
  ]);
  for (const row of rows) {
    console.log(`  ${pad(row._id, 30)} ${row.count}`);
  }
}

async function main() {
  await connectDB();

  try {
    await perSourceCompanyBreakdown();
    await perSourceJobBreakdown();
    await careerSourceRegistryBreakdown();
    await locationCoverage();
    await topCompaniesPerSource(5);
    await mapVisibilityCheck();
    await recentActivity();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Inspection failed:", err);
  process.exit(1);
});
