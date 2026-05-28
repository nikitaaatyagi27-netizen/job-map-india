require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const axios = require("axios");

const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
const BRAVE_SEARCH_KEY = process.env.BRAVE_SEARCH_KEY;

async function testGitHub() {
  console.log("\n--- Testing GitHub Search API ---");

  if (!GITHUB_TOKEN) { console.log("FAIL: GITHUB_TOKEN is missing in .env"); return; }

  try {
    const res = await axios.get("https://api.github.com/search/code", {
      params: { q: '"boards.greenhouse.io" india', per_page: 3 },
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.text-match+json",
        "User-Agent": "job-map-india-discovery"
      },
      timeout: 15000
    });

    const count = res.data?.total_count || 0;
    const items = res.data?.items || [];
    console.log(`PASS: GitHub Search working. Found ${count} total matches.`);
    items.forEach((item, i) => console.log(`  [${i + 1}] ${item.html_url}`));
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    console.log(`FAIL: GitHub Search error — ${msg}`);
  }
}

async function testBrave() {
  console.log("\n--- Testing Brave Search API ---");

  if (!BRAVE_SEARCH_KEY) { console.log("SKIP: BRAVE_SEARCH_KEY not set in .env"); return; }

  try {
    const res = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      params: { q: '"boards.greenhouse.io" india developer', count: 3 },
      headers: {
        "X-Subscription-Token": BRAVE_SEARCH_KEY,
        "Accept": "application/json"
      },
      timeout: 15000
    });

    const results = res.data?.web?.results || [];
    console.log(`PASS: Brave Search working. Got ${results.length} results.`);
    results.forEach((r, i) => console.log(`  [${i + 1}] ${r.url}`));
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.error || e.message;
    console.log(`FAIL: Brave Search error — ${msg}`);
  }
}

async function run() {
  console.log("=== Discovery Keys Test ===");
  console.log(`GITHUB_TOKEN     : ${GITHUB_TOKEN     ? GITHUB_TOKEN.slice(0, 8)     + "..." : "NOT SET"}`);
  console.log(`BRAVE_SEARCH_KEY : ${BRAVE_SEARCH_KEY ? BRAVE_SEARCH_KEY.slice(0, 8) + "..." : "NOT SET"}`);

  await testGitHub();
  await testBrave();

  console.log("\n=== Done ===");
}

run().catch(e => {
  console.error("Unexpected error:", e.message);
  process.exit(1);
});
