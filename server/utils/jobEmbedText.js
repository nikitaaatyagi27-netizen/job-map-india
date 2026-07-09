const crypto = require("crypto");

/**
 * Build the canonical text that represents a job for semantic search.
 *
 * Uses the structured fields parsed at ingestion (requiredSkills, qualifications)
 * plus a description snippet — i.e. the signal the old title-only keyword matcher
 * threw away. Both the ingestion hook and the backfill script call this so the
 * embedded text never drifts between them.
 *
 * @param {Object} job - a Job document or plain object
 * @returns {string}
 */
function buildEmbedText(job = {}) {
  const parts = [];
  if (job.title) parts.push(job.title);
  if (Array.isArray(job.requiredSkills) && job.requiredSkills.length) {
    parts.push(`Skills: ${job.requiredSkills.join(", ")}`);
  }
  if (Array.isArray(job.qualifications) && job.qualifications.length) {
    parts.push(`Qualifications: ${job.qualifications.join(", ")}`);
  }
  if (job.experienceText) parts.push(job.experienceText);
  if (job.description) parts.push(job.description.slice(0, 1500));
  return parts.join("\n").trim();
}

/**
 * Stable hash of the embed text — stored as embedHash so ingestion can detect
 * when a job's searchable content is unchanged and skip a redundant Voyage call.
 */
function embedTextHash(text) {
  return crypto.createHash("sha1").update(text || "").digest("hex");
}

/**
 * Build the query-side text from a resume/skill profile.
 *
 * Phrased to MIRROR the job document (buildEmbedText): the roles lead like a
 * job-title line, and skills follow under the same "Skills:" label the documents
 * use. The job side has no "Roles:"/"Also:"/"Domain:" labels, so we drop them —
 * matching the document format measurably sharpens the top results (A/B-tested:
 * higher max + top-50 avg similarity vs. the old labelled phrasing).
 */
function buildProfileEmbedText({ primarySkills = [], secondarySkills = [], roles = [], domain }) {
  const parts = [];
  if (roles.length) parts.push(roles.join(" / "));
  const skills = [...primarySkills, ...secondarySkills];
  if (skills.length) parts.push(`Skills: ${skills.join(", ")}`);
  return parts.join("\n").trim();
}


module.exports = { buildEmbedText, embedTextHash, buildProfileEmbedText };
