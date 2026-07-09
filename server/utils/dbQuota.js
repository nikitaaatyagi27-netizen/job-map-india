// Detects the MongoDB Atlas "over space quota — writes blocked" condition, which
// on the free M0 tier (512 MB) silently breaks every ingestion + embedding write.
// Centralized so any source/service can recognize it and stop cleanly instead of
// spamming the same failure for thousands of jobs.

const QUOTA_RE = /over your space quota|space quota.*writes are blocked|you are over your.*quota/i;

function isQuotaError(err) {
  const msg = (err && (err.message || err.errmsg || String(err))) || "";
  return QUOTA_RE.test(msg);
}

// Throw this to abort an ingestion run when the DB is full. Callers catch it at
// the top level, print one clear message, and stop — rather than treating it as
// a normal per-job persist hiccup.
class DbQuotaFullError extends Error {
  constructor(message = "MongoDB storage quota is full — writes are blocked.") {
    super(message);
    this.name = "DbQuotaFullError";
    this.isQuotaFull = true;
  }
}

module.exports = { isQuotaError, DbQuotaFullError };
