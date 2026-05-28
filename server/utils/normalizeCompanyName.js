// Trailing tokens that are legal/geographic qualifiers — stripped from the END
// of the name so "Accenture Solutions Pvt Ltd" and "Accenture India" both
// produce the same canonical key "accenture" and land on the same Company doc.
const TRAILING_SUFFIXES = new Set([
  "pvt", "ltd", "limited", "private", "inc", "corp", "corporation", "llc", "llp",
  "india",
  "solutions", "technologies", "technology", "services", "tech", "group",
  "consulting", "infotech", "systems", "software", "digital", "enterprises",
  "global", "international", "ventures", "labs", "innovations",
]);

function normalizeCompanyName(name) {
  const base = (name || "unknown")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const tokens = base.split(" ").filter(Boolean);
  while (tokens.length > 1 && TRAILING_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ") || "unknown";
}

module.exports = normalizeCompanyName;
