function normalizeJobText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeApplyLink(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.search = "";

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";

    return `${parsed.protocol}//${host}${pathname}`.toLowerCase();
  } catch {
    return raw
      .toLowerCase()
      .replace(/[#?].*$/, "")
      .replace(/\/+$/, "");
  }
}

function buildJobIdentity({ title, location, applyLink }) {
  return {
    normalizedTitle: normalizeJobText(title),
    normalizedLocation: normalizeJobText(location || "india") || "india",
    canonicalApplyLink: normalizeApplyLink(applyLink)
  };
}

module.exports = {
  normalizeJobText,
  normalizeApplyLink,
  buildJobIdentity
};
