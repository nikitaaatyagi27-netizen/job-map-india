const express = require("express");
const rateLimit = require("express-rate-limit");
const Company = require("../models/Company");
const Job = require("../models/Job");
const { ensureCompanyBranding } = require("../services/brandingEnrichmentService");
const { searchJobsBySkills } = require("../services/skillBasedJobSearchService");
const { analyseSkillGap } = require("../services/skillGapService");
const { updateLastSearch } = require("../services/sessionService");
const resolveLogo = require("../utils/logoResolver");
const { cleanCompanyNameOrUnknown } = require("../utils/cleanCompanyName");

const router = express.Router();

const LIVE_BRANDING_WINDOW_MS = 24 * 60 * 60 * 1000;

const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many searches. Please slow down." }
});

function shouldRunLiveBranding(company) {
  const createdAt = company.createdAt ? new Date(company.createdAt).getTime() : 0;
  const isRecentlyCreated = createdAt > 0 && Date.now() - createdAt <= LIVE_BRANDING_WINDOW_MS;
  const hasWeakBranding =
    !company.brandingSource ||
    company.brandingSource === "none" ||
    company.brandingConfidence === "low";
  return isRecentlyCreated && hasWeakBranding;
}

// GET /api/jobs — map data, paginated by company
router.get("/", async (req, res) => {
  try {
    const includeInactive              = req.query.includeInactive === "true";
    const includeCompaniesWithoutJobs  = req.query.includeCompaniesWithoutJobs !== "false";
    const includeCompaniesWithoutCoords = req.query.includeCompaniesWithoutCoords !== "false";

    const page  = Math.max(Number(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const skip  = (page - 1) * limit;

    const fallbackCoords = { lat: 20.5937, lng: 78.9629 };
    const companyFilter  = includeCompaniesWithoutCoords
      ? {}
      : { lat: { $ne: null }, lng: { $ne: null } };

    const [totalCompanies, companiesWithoutCoords] = await Promise.all([
      Company.countDocuments(companyFilter),
      Company.countDocuments({ $or: [{ lat: null }, { lng: null }] })
    ]);

    const companies = await Company.find(companyFilter).skip(skip).limit(limit);
    const companyIds = companies.map(c => c._id);

    const jobMatchFilter = includeInactive
      ? { company: { $in: companyIds } }
      : { company: { $in: companyIds }, isActive: true };

    const allJobs = await Job.find(jobMatchFilter)
      .sort({ postedDate: -1, lastSeenAt: -1, createdAt: -1 })
      .lean();

    const jobsByCompany = new Map();
    for (const job of allJobs) {
      const key = String(job.company);
      if (!jobsByCompany.has(key)) jobsByCompany.set(key, []);
      jobsByCompany.get(key).push(job);
    }

    const result = [];
    let companiesSkipped = 0;
    let companiesWithFallbackCoords = 0;

    for (const company of companies) {
      const jobs = jobsByCompany.get(String(company._id)) || [];

      if (!includeInactive && jobs.length === 0 && !includeCompaniesWithoutJobs) {
        companiesSkipped++;
        continue;
      }

      const hasValidCoords = Number.isFinite(company.lat) && Number.isFinite(company.lng);
      if (!hasValidCoords && !includeCompaniesWithoutCoords) {
        companiesSkipped++;
        continue;
      }

      const coords = hasValidCoords ? { lat: company.lat, lng: company.lng } : fallbackCoords;
      if (!hasValidCoords) companiesWithFallbackCoords++;

      const branding = shouldRunLiveBranding(company)
        ? await ensureCompanyBranding(company, jobs)
        : {
            domain:             company.domain,
            logo:               company.logo || resolveLogo(company),
            brandingSource:     company.brandingSource,
            brandingConfidence: company.brandingConfidence
          };

      result.push({
        employer_name:       cleanCompanyNameOrUnknown(company.name, company.domain || company.website || company.careersUrl),
        employer_logo:       branding.logo || resolveLogo(company),
        domain:              branding.domain || company.domain,
        branding_source:     branding.brandingSource,
        branding_confidence: branding.brandingConfidence,
        coords,
        roles: jobs
      });
    }

    const totalPages = Math.ceil(totalCompanies / limit);
    console.log(`[MAP API] page=${page}/${totalPages} | returned=${result.length} | skipped=${companiesSkipped} | fallback_coords=${companiesWithFallbackCoords} | missing_coords_in_db=${companiesWithoutCoords}`);

    res.json({
      city: "India",
      jobs: result,
      pagination: { total: totalCompanies, page, limit, pages: totalPages, hasMore: page < totalPages }
    });
  } catch (error) {
    console.error("[MAP API] Error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/jobs/search-by-skills
router.post("/search-by-skills", searchRateLimit, async (req, res) => {
  try {
    const { skills, roles, primarySkills, secondarySkills, domain, sessionId } = req.body;
    if (!skills?.length && !primarySkills?.length && !roles?.length) {
      return res.status(400).json({ error: "skills or roles required" });
    }
    const primary   = primarySkills || skills || [];
    const secondary = secondarySkills || [];

    const { companies, fromCache } = await searchJobsBySkills({
      skills, roles,
      primarySkills:   primary,
      secondarySkills: secondary,
      domain: domain || "other"
    });

    const located = companies.filter(c => c.coords?.lat && c.coords?.lng);

    if (sessionId) {
      updateLastSearch(sessionId, {
        domain: domain || "other",
        primarySkills:   primary,
        secondarySkills: secondary,
        roles: roles || [],
        resultCount: located.length
      }).catch(() => {});
    }

    res.json({ jobs: located, fromCache });
  } catch (e) {
    console.error("Skill search error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/jobs/skill-gap
router.post("/skill-gap", async (req, res) => {
  try {
    const { primarySkills, secondarySkills, jobTitle, jobDescription, jobId } = req.body;
    if (!primarySkills?.length && !secondarySkills?.length) {
      return res.status(400).json({ error: "primarySkills or secondarySkills required" });
    }

    let description = jobDescription || null;
    if (!description && jobId) {
      const job = await Job.findById(jobId).select("description title").lean();
      if (job) description = job.description || null;
    }

    const analysis = analyseSkillGap({ primarySkills, secondarySkills, jobTitle, jobDescription: description });
    res.json(analysis);
  } catch (e) {
    console.error("[SKILL GAP] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/jobs/click — anonymous click counter (fire-and-forget writes)
router.post("/click", async (req, res) => {
  try {
    const { applyLink, jobId } = req.body;
    if (jobId) {
      Job.findByIdAndUpdate(jobId, { $inc: { applyClickCount: 1 } }).catch(() => {});
    } else if (applyLink) {
      Job.findOneAndUpdate({ applyLink }, { $inc: { applyClickCount: 1 } }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/jobs/report-closed
router.post("/report-closed", async (req, res) => {
  try {
    const { applyLink, jobId } = req.body;
    let updated = null;
    if (jobId) {
      updated = await Job.findByIdAndUpdate(jobId, { $set: { isActive: false } });
    } else if (applyLink) {
      updated = await Job.findOneAndUpdate({ applyLink }, { $set: { isActive: false } });
    }
    if (!updated) return res.status(404).json({ error: "Job not found" });
    console.log(`[REPORT CLOSED] Marked inactive: ${applyLink || jobId}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
