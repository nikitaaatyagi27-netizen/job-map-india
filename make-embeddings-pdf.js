// Converts EMBEDDINGS-REPORT.html -> EMBEDDINGS-REPORT.pdf via headless Edge/Chrome.
// Run from repo root: node make-embeddings-pdf.js

const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const HTML = path.join(__dirname, "EMBEDDINGS-REPORT.html");
const PDF = path.join(__dirname, "EMBEDDINGS-REPORT.pdf");

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
];
const BROWSER = process.env.CHROME_PATH || BROWSERS.find(p => fs.existsSync(p));

(async () => {
  if (!fs.existsSync(HTML)) { console.error("EMBEDDINGS-REPORT.html not found."); process.exit(1); }
  if (!BROWSER) { console.error("No Edge/Chrome found. Set CHROME_PATH."); process.exit(1); }

  console.log("Launching headless browser:", BROWSER);
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.goto("file://" + HTML.replace(/\\/g, "/"), { waitUntil: "networkidle0", timeout: 120000 });
  await page.pdf({
    path: PDF,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    timeout: 180000
  });
  await browser.close();

  const sizeKB = (fs.statSync(PDF).size / 1024).toFixed(0);
  console.log(`\nDone -> ${PDF} (${sizeKB} KB)`);
})().catch(err => { console.error("Failed:", err.message); process.exit(1); });
