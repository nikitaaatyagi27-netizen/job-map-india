const { URL } = require("url");
const {
  detectATSProvider,
  normalizeHostname
} = require("./atsProviderRegistry");

const blockedHosts = [
  "linkedin.com",
  "indeed.com",
  "naukri.com",
  "glassdoor.com",
  "bebee.com",
  "monster.com",
  "foundit.in",
  "timesjobs.com"
];

function hasBlockedHost(hostname) {
  return blockedHosts.some(
    (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`)
  );
}

function detectCareerProvider(applyLink) {
  if (!applyLink) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(applyLink);
  } catch {
    return null;
  }

  const hostname = normalizeHostname(parsed.hostname);
  const pathSegments = parsed.pathname.split("/").filter(Boolean);

  if (!hostname || hasBlockedHost(hostname)) {
    return null;
  }

  return detectATSProvider(applyLink);
}

module.exports = {
  detectCareerProvider
};
