const fs = require("fs");
const puppeteer = require("puppeteer-core");
const { callLLM } = require("../utils/groqClient");

// ~8000 chars ≈ ~2000 tokens per extraction call. Free LLM tiers have tight
// DAILY token budgets (e.g. Groq free = 100k tokens/day), and most jobs appear
// near the top of a listing page — so a smaller window lets us scrape many more
// pages per day. Raise SCRAPER_MAX_PAGE_CHARS only on paid tiers.
const MAX_PAGE_TEXT_CHARS = Number(process.env.SCRAPER_MAX_PAGE_CHARS || 8000);

// Anchor text that usually leads from a careers LANDING page to the actual
// JOBS-LISTING page (where all the openings are). Used to "drill in" so we
// don't just scrape the marketing landing page with 2 featured roles.
const JOBS_LINK_HINTS = [
  "open positions", "open roles", "current openings", "view all jobs",
  "view jobs", "see all jobs", "all jobs", "browse jobs", "job openings",
  "explore jobs", "search jobs", "find jobs", "vacancies", "we're hiring",
  "join us", "apply now", "openings", "positions"
];

const { isIndianLocation } = require("../utils/indiaLocation");

// "Remote" is treated as India-eligible at the universal-scraper level because
// the careers page belongs to a company we explicitly registered as having
// India hiring (otherwise we wouldn't be scraping it).
function isIndiaOrRemote(location) {
  return isIndianLocation(location, { hasIndianPresence: true });
}

function getBrowserExecutablePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ].filter(Boolean);

  return candidates.find((c) => fs.existsSync(c)) || null;
}

// Renders the page (handles SPAs), strips noise, returns clean plain text
async function getCleanPageText(url) {
  const executablePath = getBrowserExecutablePath();

  if (!executablePath) {
    throw new Error("No Chrome/Edge found. Set CHROME_PATH in server/.env");
  }

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled" // hide the automation flag
    ]
  });

  try {
    const page = await browser.newPage();

    // Look like a real browser so anti-bot protection (which otherwise returns
    // 403/404 to headless Chrome) lets us through.
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    });
    // Remove the navigator.webdriver flag that flags us as automated.
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.setDefaultNavigationTimeout(60000);

    // Don't throw on a 4xx navigation status — many career SPAs return an odd
    // status on the shell request but still render the job list via JS. We grab
    // whatever text renders and let the LLM decide if there are jobs.
    const resp = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    const status = resp ? resp.status() : 0;
    if (status === 404 || status === 410) {
      console.warn(`[UniversalScraper] ${status} on ${url} — page may be gone`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Scroll to the bottom a few times to trigger lazy-loaded / infinite-scroll
    // job lists, then nudge any "Load more" buttons.
    await autoScroll(page);

    // Return both the visible text AND the on-page links (so we can (a) map jobs
    // to real apply URLs and (b) find a deeper jobs-listing page if needed).
    return await page.evaluate(() => {
      ["script", "style", "noscript", "iframe", "svg"].forEach((tag) => {
        document.querySelectorAll(tag).forEach((el) => el.remove());
      });
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ text: (a.innerText || "").trim().slice(0, 80), href: a.href }))
        .filter((l) => l.href && l.href.startsWith("http"));
      return { text, links };
    });
  } finally {
    await browser.close();
  }
}

// Scrolls the page in steps to trigger lazy-loaded job lists, and clicks any
// obvious "load more" buttons a few times.
async function autoScroll(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const step = 600;
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          total += step;
          if (total >= document.body.scrollHeight || total > 12000) {
            clearInterval(timer);
            resolve();
          }
        }, 250);
      });
    });
    // Click up to 3 "load more" style buttons if present.
    for (let i = 0; i < 3; i++) {
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a"));
        const target = btns.find((b) =>
          /load more|show more|view more|see more/i.test((b.innerText || "")));
        if (target) { target.click(); return true; }
        return false;
      });
      if (!clicked) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch { /* scrolling is best-effort */ }
}

// Pick the best "jobs listing" link from a landing page's links, if any.
function findJobsPageLink(links, currentUrl) {
  if (!Array.isArray(links)) return null;
  const scored = links
    .map((l) => {
      const t = (l.text || "").toLowerCase();
      const h = (l.href || "").toLowerCase();
      let score = 0;
      for (const hint of JOBS_LINK_HINTS) {
        if (t.includes(hint)) score += 3;
      }
      if (/\/(jobs|openings|positions|vacancies|careers\/search)/.test(h)) score += 2;
      if (h === currentUrl.toLowerCase()) score = -1; // same page, skip
      return { href: l.href, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].href : null;
}

// Tries to parse JSON from LLM output, handles markdown fences and raw arrays
function parseJsonFromLLMResponse(text) {
  try {
    return JSON.parse(text);
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}
  }

  return null;
}

async function extractJobsWithLLM(pageText, sourceUrl, links = []) {
  const systemPrompt =
    "You are a structured data extractor. Extract job listings from careers page text and return strict JSON only. Never add commentary or explanation outside the JSON.";

  // Give the model the on-page links so it can map each job to its real apply URL.
  const linkList = (Array.isArray(links) ? links : [])
    .filter((l) => l && l.text && l.href)
    .slice(0, 60)
    .map((l) => `${l.text} => ${l.href}`)
    .join("\n");

  const userPrompt = [
    "Extract all TECHNOLOGY / engineering job listings from the careers page text below.",
    `Source URL: ${sourceUrl}`,
    "",
    "Return a JSON array. Each item must have:",
    '  - "title": job title (string, required)',
    '  - "location": location as shown on page (string or null)',
    '  - "applyUrl": the most specific apply/job link from the LINKS list that matches this job (string or null)',
    '  - "employmentType": "full-time" | "part-time" | "contract" | "internship" | null',
    '  - "description": a 1-2 sentence summary of the role from the page, or the team/skills if shown (string or null)',
    "",
    "Rules:",
    "  - Each item must be a SPECIFIC job opening (e.g. 'Senior Backend Engineer'), NOT a department, team, or category name (e.g. 'Engineering', 'Product Team', 'Design'). Skip generic section headings.",
    "  - ONLY include technology/engineering/product/data/design roles (software, data, AI/ML, devops, QA, security, product, UX). EXCLUDE sales, marketing, HR, finance, support, admin, operations.",
    "  - Only include jobs in India or marked as Remote.",
    "  - India cities: Bangalore, Bengaluru, Hyderabad, Pune, Gurgaon, Gurugram, Noida, Delhi, Mumbai, Chennai, Kolkata, Ahmedabad.",
    "  - Do NOT invent data. Use null for any field not present.",
    "  - Do NOT include duplicate listings.",
    "  - Return ONLY the JSON array. If no matching jobs found, return [].",
    "",
    "LINKS (job-title => url):",
    linkList || "(none)",
    "",
    "Page text:",
    pageText
  ].join("\n");

  // Extract via Groq (free, fast, reliable) with automatic OpenRouter fallback —
  // see utils/groqClient.js. Both are OpenAI-compatible chat APIs.
  const content = await callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { temperature: 0, max_tokens: 4000 }
  );

  const parsed = parseJsonFromLLMResponse(content);

  if (!Array.isArray(parsed)) {
    console.warn(`[UniversalScraper] LLM did not return an array for ${sourceUrl}`);
    return [];
  }

  const seen = new Set();
  return parsed
    .filter((job) => job && typeof job.title === "string" && job.title.trim())
    .filter((job) => !job.location || isIndiaOrRemote(job.location))
    .filter((job) => isTechRole(job.title))            // drop non-tech (sales/HR/etc.)
    .map((job) => ({
      title: job.title.trim(),
      location: job.location || null,
      // Prefer a real per-job apply link; only fall back to the page URL.
      applyUrl: (typeof job.applyUrl === "string" && job.applyUrl.startsWith("http"))
        ? job.applyUrl
        : sourceUrl,
      employmentType: job.employmentType || null,
      description: (typeof job.description === "string" && job.description.trim())
        ? job.description.trim()
        : null
    }))
    .filter((job) => {                                 // dedupe by title + location
      const key = `${job.title.toLowerCase()}|${(job.location || "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Safety-net tech filter (the LLM is told to only return tech roles, but this
// guards against leaks like "Sales Executive"). Rejects clearly non-tech titles.
const NON_TECH_RE = /\b(sales|business development|marketing|hr|human resource|recruit|talent acquisition|finance|account(ant|ing)|admin|administrative|receptionist|customer (support|service|success)|operations executive|telecaller|bpo|collections|legal|procurement|logistics|warehouse|driver|nurse|medical|pharma|teacher|trainer|content writer|copywriter|social media)\b/i;
const TECH_HINT_RE = /\b(engineer|developer|programmer|software|data|analyst|scientist|architect|devops|sre|qa|sdet|tester|security|cloud|backend|frontend|full ?stack|mobile|android|ios|ml|ai|machine learning|product manager|ux|ui designer|designer|technical|platform|infrastructure|database|web)\b/i;

function isTechRole(title) {
  const t = (title || "").toLowerCase();
  if (NON_TECH_RE.test(t)) return false;
  // Accept if it has a tech hint, OR if it's ambiguous (let it through rather
  // than over-filter — the semantic search will rank irrelevant ones low anyway).
  return TECH_HINT_RE.test(t) || !NON_TECH_RE.test(t);
}

async function scrapeJobsWithLLM(url) {
  console.log(`[UniversalScraper] Scraping: ${url}`);

  const first = await getCleanPageText(url);
  if (!first.text || first.text.length < 100) {
    console.warn(`[UniversalScraper] Page returned no usable text: ${url}`);
    return [];
  }

  // Extract from the landing page first.
  let jobs = await extractJobsWithLLM(first.text.slice(0, MAX_PAGE_TEXT_CHARS), url, first.links);

  // If the landing page yielded few jobs but has a "see all jobs" / "open
  // positions" link, drill into that page — the real openings live one click
  // deeper (often an ATS board), while the landing page only has marketing
  // copy + vague category names. When the deeper page yields real jobs, PREFER
  // them (they're the actual listings) over the landing-page extractions.
  if (jobs.length < 8) {
    const jobsPage = findJobsPageLink(first.links, url);
    if (jobsPage && jobsPage !== url) {
      console.log(`[UniversalScraper] Few jobs on landing — drilling into: ${jobsPage}`);
      try {
        const deeper = await getCleanPageText(jobsPage);
        if (deeper.text && deeper.text.length > 100) {
          const deeperJobs = await extractJobsWithLLM(
            deeper.text.slice(0, MAX_PAGE_TEXT_CHARS), jobsPage, deeper.links
          );
          // Prefer the deeper (real board) jobs if it found a meaningful set;
          // otherwise keep whatever the landing page gave us.
          if (deeperJobs.length >= jobs.length) {
            jobs = deeperJobs;
          } else {
            const seen = new Set(jobs.map((j) => j.title.toLowerCase()));
            for (const j of deeperJobs) {
              if (!seen.has(j.title.toLowerCase())) { jobs.push(j); seen.add(j.title.toLowerCase()); }
            }
          }
        }
      } catch { /* keep landing-page jobs */ }
    }
  }

  console.log(`[UniversalScraper] ${jobs.length} India/remote jobs from ${url}`);
  return jobs;
}

module.exports = { scrapeJobsWithLLM, extractJobsWithLLM };
