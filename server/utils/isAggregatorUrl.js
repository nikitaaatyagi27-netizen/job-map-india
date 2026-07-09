// Detects URLs that are job AGGREGATORS / boards rather than a single company's
// careers page. The universal LLM scraper expects one company's page; aggregator
// pages (mixed-company listings) produce junk. Used both to purge bad sources and
// to reject them at discovery time.

const AGGREGATOR_RE = new RegExp(
  [
    "builtin", "cutshort", "indeed\\.", "linkedin\\.com", "glassdoor",
    "monster", "instahyre", "angel\\.co", "wellfound", "ycombinator",
    "crossover\\.com", "michaelpage", "consultancy-", "nextleap",
    "naukri\\.com", "shine\\.com", "timesjobs", "foundit\\.in",
    "hirist", "iimjobs", "internshala", "freshersworld",
    "simplyhired", "ziprecruiter", "dice\\.com", "remoteok", "weworkremotely"
  ].join("|"),
  "i"
);

// A generic "/jobs/<something>" path on an aggregator-style host is also a board,
// but a company's own "/careers" or "/jobs" page is fine — so only flag the
// known aggregator hosts above, not every URL containing "/jobs".
function isAggregatorUrl(url) {
  if (!url || typeof url !== "string") return false;
  return AGGREGATOR_RE.test(url);
}

module.exports = { isAggregatorUrl };
