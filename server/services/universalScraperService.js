const fs = require("fs");
const axios = require("axios");
const puppeteer = require("puppeteer-core");

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Keep well under typical model context limits; enough for any real careers page
const MAX_PAGE_TEXT_CHARS = 8000;

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

  const browser = await puppeteer.launch({ headless: "new", executablePath });

  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Brief pause for any post-load JS rendering
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const text = await page.evaluate(() => {
      // Strip elements that add noise but no job data
      ["script", "style", "nav", "header", "footer", "noscript", "iframe"].forEach((tag) => {
        document.querySelectorAll(tag).forEach((el) => el.remove());
      });

      return (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    });

    return text.slice(0, MAX_PAGE_TEXT_CHARS);
  } finally {
    await browser.close();
  }
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

async function extractJobsWithLLM(pageText, sourceUrl) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }

  // Prefer a fast/cheap extraction model; falls back to whatever the user configured
  // Recommended: google/gemini-flash-1.5 or anthropic/claude-haiku-4-5-20251001
  const model =
    process.env.SCRAPER_LLM_MODEL ||
    process.env.OPENROUTER_MODEL ||
    "openrouter/auto";

  const systemPrompt =
    "You are a structured data extractor. Extract job listings from careers page text and return strict JSON only. Never add commentary or explanation outside the JSON.";

  const userPrompt = [
    "Extract all tech job listings from the careers page text below.",
    `Source URL: ${sourceUrl}`,
    "",
    "Return a JSON array. Each item must have:",
    '  - "title": job title (string, required)',
    '  - "location": location as shown on page (string or null)',
    '  - "applyUrl": direct link to the job or application page (string or null)',
    '  - "employmentType": "full-time" | "part-time" | "contract" | "internship" | null',
    "",
    "Rules:",
    "  - Only include jobs in India or marked as Remote.",
    "  - India cities: Bangalore, Bengaluru, Hyderabad, Pune, Gurgaon, Gurugram, Noida, Delhi, Mumbai, Chennai, Kolkata, Ahmedabad.",
    "  - Do NOT invent data. Use null for any field that is not present.",
    "  - Do NOT include duplicate listings.",
    "  - Return ONLY the JSON array. If no matching jobs found, return [].",
    "",
    "Page text:",
    pageText
  ].join("\n");

  const response = await axios.post(
    OPENROUTER_API_URL,
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0,
      max_tokens: 4000
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );

  const content =
    response.data?.choices?.[0]?.message?.content?.trim() || "";

  const parsed = parseJsonFromLLMResponse(content);

  if (!Array.isArray(parsed)) {
    console.warn(`[UniversalScraper] LLM did not return an array for ${sourceUrl}`);
    return [];
  }

  return parsed
    .filter((job) => job && typeof job.title === "string" && job.title.trim())
    .filter((job) => !job.location || isIndiaOrRemote(job.location))
    .map((job) => ({
      title: job.title.trim(),
      location: job.location || null,
      applyUrl: job.applyUrl || sourceUrl,
      employmentType: job.employmentType || null
    }));
}

async function scrapeJobsWithLLM(url) {
  console.log(`[UniversalScraper] Scraping: ${url}`);

  const pageText = await getCleanPageText(url);

  if (!pageText || pageText.length < 100) {
    console.warn(`[UniversalScraper] Page returned no usable text: ${url}`);
    return [];
  }

  const jobs = await extractJobsWithLLM(pageText, url);
  console.log(`[UniversalScraper] ${jobs.length} India/remote jobs from ${url}`);
  return jobs;
}

module.exports = { scrapeJobsWithLLM, extractJobsWithLLM };
