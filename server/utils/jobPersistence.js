const Job = require("../models/Job");
const { buildJobIdentity } = require("./jobIdentity");
const { classifyExperienceLevel, extractYearsRange } = require("./experienceLevelClassifier");
const { parseJobDescription } = require("./jobDescriptionParser");
const { embed } = require("./embeddingClient");
const { buildEmbedText, embedTextHash } = require("./jobEmbedText");

/**
 * Generate and persist the semantic-search embedding for a job. Embeds every
 * job (no time window) whose searchable content changed (embedHash differs).
 * Failures are swallowed — a missing embedding must never break ingestion; the
 * backfill script can fill gaps later.
 */
async function embedJobIfChanged(job) {
  try {
    // No time window — every ingested job gets embedded (local model, no quota),
    // so the whole corpus is semantically searchable and relevance, not age,
    // decides what surfaces.
    const text = buildEmbedText(job);
    if (!text) return;
    const hash = embedTextHash(text);
    if (job.embedHash === hash && job.embeddedAt) return;

    const vector = await embed(text, { inputType: "document" });
    if (!Array.isArray(vector)) return;

    await Job.updateOne(
      { _id: job._id },
      { $set: { embedding: vector, embedHash: hash, embeddedAt: new Date() } }
    );
  } catch (err) {
    console.warn(`[EMBED] Skipped job ${job?._id}:`, err?.response?.status || err?.message);
  }
}

async function touchExistingJob(job, updates = {}) {
  let changed = false;

  job.isActive = true;
  job.lastSeenAt = new Date();
  job.fetchedAt = new Date();
  changed = true;

  if (!job.applyLink && updates.applyLink) {
    job.applyLink = updates.applyLink;
  }

  if (!job.description && updates.description) {
    job.description = updates.description;
  }

  if (job.description || updates.description) {
    const parsed = parseJobDescription({ title: job.title, description: job.description });
    if (parsed.experienceLevel) job.experienceLevel = parsed.experienceLevel;
    if (job.yearsMin == null && parsed.yearsMin != null) job.yearsMin = parsed.yearsMin;
    if (job.yearsMax == null && parsed.yearsMax != null) job.yearsMax = parsed.yearsMax;
    if (parsed.experienceText) job.experienceText = parsed.experienceText;
    if (parsed.requiredSkills.length) job.requiredSkills = parsed.requiredSkills;
    if (parsed.qualifications.length) job.qualifications = parsed.qualifications;
    if (parsed.responsibilityBullets.length) job.responsibilityBullets = parsed.responsibilityBullets;
    job.extractionConfidence = parsed.extractionConfidence;
    job.parsedDescriptionAt = new Date();
  }

  if (!job.postedDate && updates.postedDate) {
    job.postedDate = updates.postedDate;
  }

  if (!job.location && updates.location) {
    job.location = updates.location;
  }

  if (updates.isRemote === true && job.isRemote !== true) {
    job.isRemote = true;
  }

  if (changed) {
    await job.save();
  }

  // Re-embed if content (e.g. a newly-filled description) changed it.
  await embedJobIfChanged(job);

  return job;
}

async function upsertIngestedJob(payload) {
  const {
    title,
    company,
    location,
    applyLink,
    description,
    source,
    postedDate,
    isRemote,
    yearsMin: payloadYearsMin,
    yearsMax: payloadYearsMax
  } = payload;

  const identity = buildJobIdentity({
    title,
    location,
    applyLink
  });

  const query = {
    company
  };

  if (identity.canonicalApplyLink) {
    query.$or = [
      {
        canonicalApplyLink: identity.canonicalApplyLink
      },
      {
        normalizedTitle: identity.normalizedTitle,
        normalizedLocation: identity.normalizedLocation
      }
    ];
  } else {
    query.normalizedTitle = identity.normalizedTitle;
    query.normalizedLocation = identity.normalizedLocation;
  }

  const now = new Date();
  const parsedDescription = parseJobDescription({ title, description });
  const computedLevel = parsedDescription.experienceLevel || classifyExperienceLevel(title, description);

  // Use explicit years if provided; otherwise try to extract from description/title
  let yearsMin = payloadYearsMin ?? null;
  let yearsMax = payloadYearsMax ?? null;
  if (yearsMin === null) {
    const extracted = parsedDescription.yearsMin != null
      ? { min: parsedDescription.yearsMin, max: parsedDescription.yearsMax }
      : extractYearsRange(description || title);
    if (extracted) { yearsMin = extracted.min; yearsMax = extracted.max; }
  }

  const update = {
    $set: {
      title,
      company,
      location,
      applyLink: applyLink || null,
      description: description || null,
      source,
      postedDate: postedDate || null,
      isRemote: isRemote === true,
      isActive: true,
      lastSeenAt: now,
      fetchedAt: now,
      normalizedTitle: identity.normalizedTitle,
      normalizedLocation: identity.normalizedLocation,
      canonicalApplyLink: identity.canonicalApplyLink,
      ...(computedLevel && { experienceLevel: computedLevel }),
      ...(yearsMin !== null && { yearsMin }),
      ...(yearsMax !== null && { yearsMax }),
      ...(parsedDescription.experienceText && { experienceText: parsedDescription.experienceText }),
      requiredSkills: parsedDescription.requiredSkills,
      qualifications: parsedDescription.qualifications,
      responsibilityBullets: parsedDescription.responsibilityBullets,
      extractionConfidence: parsedDescription.extractionConfidence,
      parsedDescriptionAt: now
    },
    $setOnInsert: {
      firstSeenAt: now
    }
  };

  const updatedJob = await Job.findOneAndUpdate(query, update, {
    upsert: true,
    returnDocument: "after",
    setDefaultsOnInsert: true,
    runValidators: true
  });

  // Refresh the semantic-search vector when the job's content changed.
  // Awaited so a job is never returned as searchable before it can be matched;
  // embedJobIfChanged swallows its own errors so this can't break ingestion.
  await embedJobIfChanged(updatedJob);

  return updatedJob;
}

module.exports = {
  touchExistingJob,
  upsertIngestedJob
};
