// Probe Naukri API to find the correct endpoint and required headers.
// Run: node scripts/probeNaukriApi.js

require("dotenv").config();
const axios = require("axios");

const KEYWORD  = "software engineer";
const LOCATION = "delhi";
const SEO_KEY  = "software-engineer-jobs-in-delhi";

const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-IN,en;q=0.9",
  "Referer": "https://www.naukri.com/",
  "Origin": "https://www.naukri.com"
};

const COMMON_PARAMS = {
  noOfResults: 5,
  urlType: "search_by_key_loc",
  searchType: "adv",
  keyword: KEYWORD,
  location: LOCATION,
  pageNo: 1,
  seoKey: SEO_KEY,
  src: "jobsearchDesk"
};

// v1 endpoint confirmed working — now inspect the full response structure
const CANDIDATES = [
  { label: "v1 mobile (working)", method: "get", url: "https://www.naukri.com/jobapi/v1/search", extraHeaders: { appid: "109", systemid: "NaukriMobile" } },
];

async function probe({ label, method, url, extraHeaders }) {
  try {
    const headers = { ...BASE_HEADERS, ...extraHeaders };
    const config = { headers, timeout: 15000, validateStatus: () => true };

    let res;
    if (method === "post") {
      res = await axios.post(url, COMMON_PARAMS, config);
    } else {
      res = await axios.get(url, { ...config, params: COMMON_PARAMS });
    }

    console.log(`\n[${label}]`);
    console.log(`  Status      : ${res.status}`);

    if (typeof res.data === "object" && res.data !== null) {
      const topLevelKeys = Object.keys(res.data);
      console.log(`  Top-level keys: ${JSON.stringify(topLevelKeys)}`);

      // Print count + first item for any array-valued key
      for (const key of topLevelKeys) {
        if (Array.isArray(res.data[key])) {
          console.log(`  Array "${key}" length: ${res.data[key].length}`);
          if (res.data[key].length > 0) {
            console.log(`  Array "${key}"[0] keys: ${JSON.stringify(Object.keys(res.data[key][0]))}`);
            console.log(`  Array "${key}"[0] sample: ${JSON.stringify(res.data[key][0]).slice(0, 500)}`);
          }
        } else if (typeof res.data[key] !== "object") {
          console.log(`  Scalar "${key}": ${res.data[key]}`);
        }
      }
    } else {
      console.log(`  Body: ${String(res.data).slice(0, 400)}`);
    }

    return res.status === 200 && jobCount !== "?" && Number(jobCount) > 0;
  } catch (err) {
    console.log(`\n[${label}]`);
    console.log(`  ERROR  : ${err.message}`);
    return false;
  }
}

async function run() {
  console.log("=== Naukri API endpoint probe ===\n");
  for (const candidate of CANDIDATES) {
    const worked = await probe(candidate);
    if (worked) {
      console.log(`\n✅ WORKING: ${candidate.label} → ${candidate.url}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log("\n=== Done ===");
}

run().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
