const extractDomain = require("./extractDomain");

function resolveCompanyDomain(job) {
  return extractDomain(job);
}

module.exports = resolveCompanyDomain;
