require("dotenv").config();

const connectDB = require("../config/db");
const {
  buildListingPageUrl,
  fetchWorkdayTenant,
  ingestWorkdayTenant
} = require("../services/workdayService");

function parseArgValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function run() {
  const config = {
    companyName:
      parseArgValue("company") ||
      process.env.WORKDAY_COMPANY_NAME,
    host:
      parseArgValue("host") ||
      process.env.WORKDAY_HOST,
    tenant:
      parseArgValue("tenant") ||
      process.env.WORKDAY_TENANT ||
      "wday",
    site:
      parseArgValue("site") ||
      process.env.WORKDAY_SITE
  };

  if (!config.companyName || !config.host || !config.site) {
    throw new Error(
      "Set WORKDAY_COMPANY_NAME, WORKDAY_HOST, and WORKDAY_SITE in server/.env or pass --company, --host, --tenant, and --site."
    );
  }

  console.log("[WORKDAY TEST] Page URL:", buildListingPageUrl(config));

  const jobs = await fetchWorkdayTenant(config);
  console.log(`[WORKDAY TEST] Rendered jobs returned: ${jobs.length}`);
  console.log(
    "[WORKDAY TEST] Sample:",
    jobs.slice(0, 3)
  );

  if (jobs.length === 0) {
    console.log("[WORKDAY TEST] No jobs returned for this tenant.");
    process.exit();
  }

  await connectDB();
  const ingestedCount = await ingestWorkdayTenant(config);
  console.log(`[WORKDAY TEST] India jobs ingested: ${ingestedCount}`);
  process.exit();
}

run().catch((error) => {
  console.error("[WORKDAY TEST] Failed");
  console.error(error.response?.data || error.message);
  process.exit(1);
});
