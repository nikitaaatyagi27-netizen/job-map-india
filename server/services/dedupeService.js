const Company = require("../models/Company");
const Job = require("../models/Job");
const CareerSource = require("../models/CareerSource");
const normalizeCompanyName = require("../utils/normalizeCompanyName");
const { cleanCompanyNameOrUnknown } = require("../utils/cleanCompanyName");

const TRAILING_SUFFIXES = new Set([
  "pvt", "ltd", "limited", "private", "inc", "corp", "corporation", "llc", "llp",
  "india",
  "solutions", "technologies", "technology", "services", "tech", "group",
  "consulting", "infotech", "systems", "software", "digital", "enterprises",
  "global", "international", "ventures", "labs", "innovations",
]);

function buildFuzzyKey(normalizedName) {
  const tokens = normalizedName.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && TRAILING_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

async function moveCareerSourcesToCanonical(duplicateId, canonicalId, canonicalName) {
  const dupSources = await CareerSource.find({ company: duplicateId });
  let moved = 0;
  for (const src of dupSources) {
    const conflict = await CareerSource.findOne({
      company: canonicalId, provider: src.provider, boardUrl: src.boardUrl,
    });
    if (conflict) {
      await CareerSource.deleteOne({ _id: src._id });
    } else {
      await CareerSource.updateOne(
        { _id: src._id },
        { $set: { company: canonicalId, companyName: canonicalName, updatedAt: new Date() } }
      );
      moved++;
    }
  }
  return { moved };
}

async function moveJobsToCanonical(duplicateId, canonicalId) {
  const dupJobs = await Job.find({ company: duplicateId });
  let moved = 0;
  let dropped = 0;
  for (const job of dupJobs) {
    const conditions = [];
    if (job.canonicalApplyLink) conditions.push({ canonicalApplyLink: job.canonicalApplyLink });
    if (job.normalizedTitle && job.normalizedLocation) {
      conditions.push({ normalizedTitle: job.normalizedTitle, normalizedLocation: job.normalizedLocation });
    }
    const conflict = conditions.length > 0
      ? await Job.findOne({ company: canonicalId, $or: conditions })
      : null;
    if (conflict) {
      await Job.deleteOne({ _id: job._id });
      dropped++;
    } else {
      await Job.updateOne({ _id: job._id }, { $set: { company: canonicalId } });
      moved++;
    }
  }
  return { moved, dropped };
}

function pickCanonicalCompany(companies, jobCountMap) {
  return companies.slice().sort((a, b) => {
    const aCount = jobCountMap.get(String(a._id)) || 0;
    const bCount = jobCountMap.get(String(b._id)) || 0;
    if (aCount !== bCount) return bCount - aCount;
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  })[0];
}

async function mergeDuplicateCompanies() {
  const [companies, jobCounts] = await Promise.all([
    // Select only the fields used by the merge logic — reduces per-document memory
    // footprint significantly when the collection is large. Full Mongoose documents
    // are still returned (not lean) so .save() works on canonical/solo companies.
    Company.find({}).select("name domain website careersUrl logo city location lat lng createdAt"),
    Job.aggregate([{ $group: { _id: "$company", count: { $sum: 1 } } }]),
  ]);

  const jobCountMap = new Map(jobCounts.map((row) => [String(row._id), row.count]));
  const groups = new Map();

  for (const company of companies) {
    const canonicalDisplay = cleanCompanyNameOrUnknown(
      company.name,
      [company.domain, company.website, company.careersUrl].filter(Boolean).join(" ")
    );
    const key = buildFuzzyKey(normalizeCompanyName(canonicalDisplay));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(company);
  }

  const multiGroups = [...groups.values()].filter(g => g.length > 1);
  if (multiGroups.length > 0) {
    console.log(`[DEDUPE] Found ${multiGroups.length} fuzzy company groups to merge:`);
    for (const group of multiGroups) {
      console.log(`  [${group.length}] ${group.map(c => c.name).join("  |  ")}`);
    }
  }

  let mergedCompanies = 0, movedJobs = 0, movedCareerSources = 0;

  for (const [key, companiesInGroup] of groups.entries()) {
    if (companiesInGroup.length < 2) {
      const solo = companiesInGroup[0];
      if (solo.name !== key) {
        solo.name = key;
        solo.updatedAt = new Date();
        try { await solo.save(); } catch {}
      }
      continue;
    }

    const canonical = pickCanonicalCompany(companiesInGroup, jobCountMap);
    const duplicates = companiesInGroup.filter(c => String(c._id) !== String(canonical._id));

    for (const duplicate of duplicates) {
      const [jobResult, srcResult] = await Promise.all([
        moveJobsToCanonical(duplicate._id, canonical._id),
        moveCareerSourcesToCanonical(duplicate._id, canonical._id, key),
      ]);
      movedJobs += jobResult.moved || 0;
      movedCareerSources += srcResult.moved || 0;

      if (!canonical.domain && duplicate.domain) canonical.domain = duplicate.domain;
      if (!canonical.website && duplicate.website) canonical.website = duplicate.website;
      if (!canonical.careersUrl && duplicate.careersUrl) canonical.careersUrl = duplicate.careersUrl;
      if (!canonical.logo && duplicate.logo) canonical.logo = duplicate.logo;
      if (!canonical.city && duplicate.city) canonical.city = duplicate.city;
      if (!canonical.location && duplicate.location) canonical.location = duplicate.location;
      if (!canonical.lat && duplicate.lat) canonical.lat = duplicate.lat;
      if (!canonical.lng && duplicate.lng) canonical.lng = duplicate.lng;

      await Company.deleteOne({ _id: duplicate._id });
      mergedCompanies++;
    }

    canonical.name = key;
    canonical.updatedAt = new Date();
    await canonical.save();
  }

  return { mergedCompanies, movedJobs, movedCareerSources };
}

async function dedupeJobs() {
  const dupGroups = await Job.aggregate([
    { $match: { canonicalApplyLink: { $type: "string" } } },
    { $group: { _id: { company: "$company", canonicalApplyLink: "$canonicalApplyLink" }, ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ], { allowDiskUse: true });

  let removedDuplicates = 0, updatedKeepers = 0;

  for (const group of dupGroups) {
    const jobs = await Job.find({ _id: { $in: group.ids } })
      .sort({ lastSeenAt: -1, fetchedAt: -1, createdAt: -1 });
    if (jobs.length < 2) continue;

    const [keeper, ...dupes] = jobs;
    let changed = false;
    for (const dupe of dupes) {
      if (!keeper.applyLink && dupe.applyLink) { keeper.applyLink = dupe.applyLink; changed = true; }
      if (!keeper.description && dupe.description) { keeper.description = dupe.description; changed = true; }
      if (!keeper.postedDate && dupe.postedDate) { keeper.postedDate = dupe.postedDate; changed = true; }
      if (dupe.isRemote && !keeper.isRemote) { keeper.isRemote = true; changed = true; }
    }
    if (changed) { await keeper.save(); updatedKeepers++; }
    await Job.deleteMany({ _id: { $in: dupes.map(d => d._id) } });
    removedDuplicates += dupes.length;
  }

  return { removedDuplicates, updatedKeepers };
}

async function dedupeJobsByTitleLocation() {
  const duplicateGroups = await Job.aggregate([
    { $group: { _id: { company: "$company", normalizedTitle: "$normalizedTitle", normalizedLocation: "$normalizedLocation" }, ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { "_id.company": { $ne: null }, "_id.normalizedTitle": { $ne: null }, "_id.normalizedLocation": { $ne: null }, count: { $gt: 1 } } },
  ]);

  let removedDuplicates = 0;

  for (const group of duplicateGroups) {
    const jobs = await Job.find({ _id: { $in: group.ids } })
      .sort({ lastSeenAt: -1, fetchedAt: -1, createdAt: -1 });
    if (jobs.length < 2) continue;

    const [keeper, ...dupes] = jobs;
    let changed = false;
    for (const dupe of dupes) {
      if (!keeper.applyLink && dupe.applyLink) { keeper.applyLink = dupe.applyLink; changed = true; }
      if (!keeper.canonicalApplyLink && dupe.canonicalApplyLink) { keeper.canonicalApplyLink = dupe.canonicalApplyLink; changed = true; }
      if (!keeper.description && dupe.description) { keeper.description = dupe.description; changed = true; }
      if (!keeper.postedDate && dupe.postedDate) { keeper.postedDate = dupe.postedDate; changed = true; }
      if (dupe.isRemote && !keeper.isRemote) { keeper.isRemote = true; changed = true; }
    }
    if (changed) { keeper.updatedAt = new Date(); await keeper.save(); }
    await Job.deleteMany({ _id: { $in: dupes.map(d => d._id) } });
    removedDuplicates += dupes.length;
  }

  return { removedDuplicates };
}

async function runDedup() {
  console.log("[DEDUPE] Starting company merge");
  const companyStats = await mergeDuplicateCompanies();
  console.log(`[DEDUPE] Company merge done | merged ${companyStats.mergedCompanies} | jobs moved ${companyStats.movedJobs}`);

  const jobStats = await dedupeJobs();
  const titleStats = await dedupeJobsByTitleLocation();

  const totalJobsRemoved = jobStats.removedDuplicates + titleStats.removedDuplicates;
  console.log(`[DEDUPE] Done | companies merged ${companyStats.mergedCompanies} | jobs removed ${totalJobsRemoved}`);

  return { companyStats, jobStats, titleStats };
}

module.exports = { runDedup };
