const Session = require("../models/Session");

function touch(session) {
  session.lastActiveAt = new Date();
  return session.save();
}

async function getOrCreateSession(sessionId) {
  if (!sessionId || typeof sessionId !== "string" || sessionId.length < 8) {
    throw new Error("Invalid sessionId");
  }
  let session = await Session.findOne({ sessionId });
  if (!session) {
    session = await Session.create({ sessionId });
  } else {
    await touch(session);
  }
  return session;
}

async function getSession(sessionId) {
  return Session.findOne({ sessionId });
}

async function saveJob(sessionId, jobData) {
  const session = await Session.findOne({ sessionId });
  if (!session) throw new Error("Session not found");

  // Prevent duplicate saves
  const alreadySaved = session.savedJobs.some(
    j => j.applyLink === jobData.applyLink || String(j.jobId) === String(jobData.jobId)
  );
  if (alreadySaved) return session;

  session.savedJobs.push({
    jobId: jobData.jobId || null,
    title: jobData.title,
    company: jobData.company,
    companyId: jobData.companyId || null,
    applyLink: jobData.applyLink,
    location: jobData.location,
    source: jobData.source,
    savedAt: new Date()
  });

  session.lastActiveAt = new Date();
  await session.save();
  return session;
}

async function unsaveJob(sessionId, applyLink) {
  const session = await Session.findOne({ sessionId });
  if (!session) throw new Error("Session not found");
  session.savedJobs = session.savedJobs.filter(j => j.applyLink !== applyLink);
  session.lastActiveAt = new Date();
  await session.save();
  return session;
}

async function trackApply(sessionId, jobData) {
  const session = await Session.findOne({ sessionId });
  if (!session) throw new Error("Session not found");

  const alreadyTracked = session.appliedJobs.some(
    j => j.applyLink === jobData.applyLink
  );
  if (!alreadyTracked) {
    session.appliedJobs.push({
      jobId: jobData.jobId || null,
      title: jobData.title,
      company: jobData.company,
      applyLink: jobData.applyLink,
      appliedAt: new Date()
    });
  }
  session.lastActiveAt = new Date();
  await session.save();
  return session;
}

async function updateLastSearch(sessionId, { domain, primarySkills, secondarySkills, roles, resultCount }) {
  const session = await Session.findOne({ sessionId });
  if (!session) return;

  session.lastSearch = {
    domain,
    primarySkills,
    secondarySkills,
    roles,
    searchedAt: new Date()
  };

  // Keep last 10 searches in history
  session.searchHistory.unshift({
    domain,
    primarySkills,
    roles,
    resultCount,
    searchedAt: new Date()
  });
  if (session.searchHistory.length > 10) {
    session.searchHistory = session.searchHistory.slice(0, 10);
  }

  session.lastActiveAt = new Date();
  await session.save();
}

module.exports = {
  getOrCreateSession,
  getSession,
  saveJob,
  unsaveJob,
  trackApply,
  updateLastSearch
};
