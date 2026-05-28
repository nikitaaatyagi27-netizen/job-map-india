const { classifyExperienceLevel, extractYearsRange } = require("./experienceLevelClassifier");

const SKILL_KEYWORDS = [
  "aws", "azure", "gcp", "google cloud", "cloud",
  "react", "node", "node.js", "javascript", "typescript", "java", "python",
  "sql", "mongodb", "postgresql", "mysql", "redis",
  "docker", "kubernetes", "linux", "devops", "ci/cd",
  "network security", "email security", "endpoint security", "cloud security",
  "firewall", "ids", "ips", "siem", "soc", "edr", "xdr",
  "spf", "dkim", "dmarc", "cisco", "ironport",
  "machine learning", "data engineering", "etl", "spark"
];

const QUALIFICATION_RE = /\b(bachelor|master|degree|b\.?tech|m\.?tech|bca|mca|certification|certified|diploma|graduate)\b/i;
const EXPERIENCE_RE = /\b(\d+\s*(?:\+|[-–]\s*\d+|\s+to\s+\d+)?\s*(?:year|yr)s?\b|experience|freshers?|no prior experience)\b/i;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;

function stripHtml(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r/g, "\n");
}

function normalizeLine(line) {
  return line
    .replace(BULLET_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitDescriptionLines(description) {
  return stripHtml(description)
    .split(/\n+/)
    .map(normalizeLine)
    .filter(line => line.length >= 3);
}

function unique(values, limit) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }

  return result;
}

function extractSkills(text) {
  const lower = String(text || "").toLowerCase();
  return SKILL_KEYWORDS.filter(skill => lower.includes(skill));
}

function parseJobDescription({ title, description }) {
  const text = stripHtml(description || "");
  const lines = splitDescriptionLines(text);
  const experienceLevel = classifyExperienceLevel(title, text);
  const years = extractYearsRange(text);

  const experienceLines = lines.filter(line => EXPERIENCE_RE.test(line));
  const qualifications = lines.filter(line => QUALIFICATION_RE.test(line));
  const responsibilityBullets = lines.filter(line =>
    !QUALIFICATION_RE.test(line) &&
    !EXPERIENCE_RE.test(line)
  );

  return {
    normalizedDescription: text.replace(/\n{3,}/g, "\n\n").trim() || null,
    experienceLevel,
    yearsMin: years?.min ?? null,
    yearsMax: years?.max ?? null,
    experienceText: unique(experienceLines, 6).join("\n") || null,
    requiredSkills: unique(extractSkills(`${title || ""} ${text}`), 30),
    qualifications: unique(qualifications, 8),
    responsibilityBullets: unique(responsibilityBullets, 20),
    extractionConfidence: text.length > 80
      ? (experienceLevel || years ? "high" : "medium")
      : "low"
  };
}

module.exports = {
  parseJobDescription,
  splitDescriptionLines
};
