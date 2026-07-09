// Converts CODEBOOK.html → CODEBOOK.pdf using headless Edge via puppeteer-core.
// Run from repo root: node make-pdf.js

const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "CODEBOOK.html");
const PDF = path.join(ROOT, "CODEBOOK.pdf");

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
];
const BROWSER = process.env.CHROME_PATH || BROWSERS.find(p => fs.existsSync(p));

(async () => {
  if (!fs.existsSync(HTML)) {
    console.error("CODEBOOK.html not found — run `node generate-codebook.js` first.");
    process.exit(1);
  }
  if (!BROWSER) {
    console.error("No Edge/Chrome found. Set CHROME_PATH.");
    process.exit(1);
  }

  console.log("Launching headless browser:", BROWSER);
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  console.log("Loading CODEBOOK.html...");
  await page.goto("file://" + HTML.replace(/\\/g, "/"), {
    waitUntil: "networkidle0",
    timeout: 120000
  });

  console.log("Rendering PDF (this can take a minute for a large doc)...");
  await page.pdf({
    path: PDF,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    timeout: 180000
  });

  await browser.close();

  const sizeMB = (fs.statSync(PDF).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ Done — ${PDF} (${sizeMB} MB)`);
})().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
