// Reads the token on every request so tests can set/unset the env var freely.
function requireAdminAuth(req, res, next) {
  const configuredToken = (process.env.INGESTION_ADMIN_TOKEN || "").trim();

  if (!configuredToken) {
    return res.status(503).json({
      error: "Admin endpoints are not configured on this server. Set INGESTION_ADMIN_TOKEN."
    });
  }

  const bearer = String(req.headers.authorization || "");
  const requestToken = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";

  if (requestToken !== configuredToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

module.exports = { requireAdminAuth };
