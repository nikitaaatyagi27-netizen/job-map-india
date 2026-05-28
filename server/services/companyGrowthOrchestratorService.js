const { syncCompanyIntelligenceMetadata } = require("./companyIntelligenceService");
const { bootstrapCareerSourcesFromCompanyWebsites } = require("./companyWebsiteBootstrapService");
const { discoverWebCompanies } = require("./webCompanyDiscoveryService");
const { discoverCompanyWebsiteCareers } = require("./companyWebsiteDiscoveryService");
const { discoverAndIngestWorkdayBoards } = require("./workdayDiscoveryService");
const { discoverGreenhouse, discoverLever, discoverAshby, discoverSmartRecruiters } = require("./atsSitemapDiscoveryService");
const { getIngestionSourceKeys } = require("../config/ingestionSourceCatalog");

async function runCompanyGrowthCycle(trigger = "manual") {
  console.log(`[COMPANY GROWTH] Starting cycle (${trigger})`);

  const intelligence = await syncCompanyIntelligenceMetadata();
  console.log(
    `[COMPANY GROWTH] intelligence sync | scanned ${intelligence.scannedCompanies} | updated ${intelligence.updatedCompanies}`
  );

  const websiteBootstrap = await bootstrapCareerSourcesFromCompanyWebsites();
  console.log(
    `[COMPANY GROWTH] website bootstrap | scanned ${websiteBootstrap.companiesScanned} | sources ${websiteBootstrap.sourcesRegistered} | upgraded ${websiteBootstrap.companiesUpgraded}`
  );

  if (process.env.SERPER_API_KEY) {
    try {
      const webDiscovery = await discoverWebCompanies();
      console.log(
        `[COMPANY GROWTH] web discovery | queries ${webDiscovery.queriesRun} | discovered companies ${webDiscovery.discoveredCompanies} | failed queries ${webDiscovery.failedQueries || 0}`
      );
    } catch (error) {
      console.error("[COMPANY GROWTH] Web discovery failed");
      console.error(error.message);
    }

    try {
      const websiteDiscovery = await discoverCompanyWebsiteCareers();
      console.log(
        `[COMPANY GROWTH] website discovery | scanned ${websiteDiscovery.scannedCompanies} | updated ${websiteDiscovery.updatedCompanies} | providers ${websiteDiscovery.providersDiscovered} | careers urls ${websiteDiscovery.careersUrlsDiscovered}`
      );
    } catch (error) {
      console.error("[COMPANY GROWTH] Website discovery failed");
      console.error(error.message);
    }
  } else {
    console.log("[COMPANY GROWTH] Skipping web discovery (SERPER_API_KEY missing)");
  }

  if (process.env.GITHUB_TOKEN || process.env.SERPER_API_KEY) {
    try {
      const workdayDiscovery = await discoverAndIngestWorkdayBoards();
      console.log(
        `[COMPANY GROWTH] workday discovery | boards ${workdayDiscovery.candidatesFound} | validated ${workdayDiscovery.validatedBoards} | ingested ${workdayDiscovery.ingestedBoards} | new companies ${workdayDiscovery.newCompanies}`
      );
    } catch (error) {
      console.error("[COMPANY GROWTH] Workday discovery failed");
      console.error(error.message);
    }

    try {
      const gh = await discoverGreenhouse();
      console.log(`[COMPANY GROWTH] greenhouse discovery | registered ${gh}`);
    } catch (error) {
      console.error("[COMPANY GROWTH] Greenhouse discovery failed");
      console.error(error.message);
    }

    // Wait 2 minutes between ATS discovery runs to avoid GitHub secondary rate limit
    await new Promise(r => setTimeout(r, 120000));

    try {
      const lv = await discoverLever();
      console.log(`[COMPANY GROWTH] lever discovery | registered ${lv}`);
    } catch (error) {
      console.error("[COMPANY GROWTH] Lever discovery failed");
      console.error(error.message);
    }

    await new Promise(r => setTimeout(r, 120000));

    try {
      const ab = await discoverAshby();
      console.log(`[COMPANY GROWTH] ashby discovery | registered ${ab}`);
    } catch (error) {
      console.error("[COMPANY GROWTH] Ashby discovery failed");
      console.error(error.message);
    }

    // SmartRecruiters uses public sitemap — no GitHub token needed, no delay required
    try {
      const sr = await discoverSmartRecruiters();
      console.log(`[COMPANY GROWTH] smartrecruiters discovery | registered ${sr}`);
    } catch (error) {
      console.error("[COMPANY GROWTH] SmartRecruiters discovery failed");
      console.error(error.message);
    }
  } else {
    console.log("[COMPANY GROWTH] Skipping GitHub-based discovery (GITHUB_TOKEN missing)");
  }

  console.log(
    `[COMPANY GROWTH] source registry | ingestable sources ${getIngestionSourceKeys().length}`
  );

  console.log(`[COMPANY GROWTH] Cycle finished (${trigger})`);
}

module.exports = {
  runCompanyGrowthCycle
};
