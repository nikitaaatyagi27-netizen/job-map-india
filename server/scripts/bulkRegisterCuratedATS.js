// Bulk-register famous companies onto their existing ATS boards in CareerSource.
// Each entry below has been live-probed against the ATS API — every (slug, ats)
// combo is verified to return 200 OK with at least one job.
//
// Run: node scripts/bulkRegisterCuratedATS.js
//
// What this does:
//   1. For each entry, creates a Company (if missing) and upserts a CareerSource
//      pointing at the ATS board URL.
//   2. Once registered, every cron run picks them up via the existing
//      Greenhouse / Lever / Ashby / SmartRecruiters services.
//   3. The live skill-search path also queries them on every resume upload.
//
// To add more companies later: probe slug + ats with a quick curl, append here.

require("dotenv").config();
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const Company = require("../models/Company");
const CareerSource = require("../models/CareerSource");
const normalizeCompanyName = require("../utils/normalizeCompanyName");

// Each entry includes a domain so logo.dev can resolve a real logo
// (logo.dev/{domain} works much better than logo.dev/name/{name}).
const BOARDS = [
  // ── Indian unicorns / startups ─────────────────────────────────────────
  // TCS uses iBegin (careers.tcs.com), not Greenhouse — removed to avoid ingesting a stranger's board
  { displayName: "Paytm",      slug: "paytm",      ats: "lever",           domain: "paytm.com" },
  { displayName: "PhonePe",    slug: "phonepe",    ats: "greenhouse",      domain: "phonepe.com" },
  { displayName: "Meesho",     slug: "meesho",     ats: "lever",           domain: "meesho.com" },
  { displayName: "CRED",       slug: "cred",       ats: "lever",           domain: "cred.club" },
  { displayName: "InMobi",     slug: "inmobi",     ats: "greenhouse",      domain: "inmobi.com" },
  { displayName: "PubMatic",   slug: "pubmatic",   ats: "greenhouse",      domain: "pubmatic.com" },
  { displayName: "Postman",    slug: "postman",    ats: "greenhouse",      domain: "postman.com" },
  { displayName: "Druva",      slug: "druva",      ats: "greenhouse",      domain: "druva.com" },
  { displayName: "Glance",     slug: "glance",     ats: "greenhouse",      domain: "glance.com" },
  { displayName: "Groww",      slug: "groww",      ats: "greenhouse",      domain: "groww.in" },
  { displayName: "Freshworks", slug: "freshworks", ats: "smartrecruiters", domain: "freshworks.com" },
  { displayName: "Unacademy",  slug: "unacademy",  ats: "smartrecruiters", domain: "unacademy.com" },
  { displayName: "Zomato",     slug: "eternal",    ats: "lever",           domain: "zomato.com" }, // rebranded "eternal"
  { displayName: "Fi Money",   slug: "fi",         ats: "lever",           domain: "fi.money" },

  // ── Global tech with major India engineering hubs ──────────────────────
  { displayName: "Databricks",  slug: "databricks",  ats: "greenhouse", domain: "databricks.com" },
  { displayName: "Stripe",      slug: "stripe",      ats: "greenhouse", domain: "stripe.com" },
  { displayName: "Cloudflare",  slug: "cloudflare",  ats: "greenhouse", domain: "cloudflare.com" },
  { displayName: "MongoDB",     slug: "mongodb",     ats: "greenhouse", domain: "mongodb.com" },
  { displayName: "Datadog",     slug: "datadog",     ats: "greenhouse", domain: "datadoghq.com" },
  { displayName: "Airbnb",      slug: "airbnb",      ats: "greenhouse", domain: "airbnb.com" },
  { displayName: "GitLab",      slug: "gitlab",      ats: "greenhouse", domain: "gitlab.com" },
  { displayName: "Elastic",     slug: "elastic",     ats: "greenhouse", domain: "elastic.co" },
  { displayName: "Intercom",    slug: "intercom",    ats: "greenhouse", domain: "intercom.com" },
  { displayName: "Pinterest",   slug: "pinterest",   ats: "greenhouse", domain: "pinterest.com" },
  { displayName: "Figma",       slug: "figma",       ats: "greenhouse", domain: "figma.com" },
  { displayName: "Twilio",      slug: "twilio",      ats: "greenhouse", domain: "twilio.com" },
  { displayName: "Robinhood",   slug: "robinhood",   ats: "greenhouse", domain: "robinhood.com" },
  { displayName: "Reddit",      slug: "reddit",      ats: "greenhouse", domain: "reddit.com" },
  { displayName: "Coinbase",    slug: "coinbase",    ats: "greenhouse", domain: "coinbase.com" },
  { displayName: "Plaid",       slug: "plaid",       ats: "lever",      domain: "plaid.com" },
  { displayName: "Vercel",      slug: "vercel",      ats: "greenhouse", domain: "vercel.com" },
  { displayName: "Discord",     slug: "discord",     ats: "greenhouse", domain: "discord.com" },
  { displayName: "Gusto",       slug: "gusto",       ats: "greenhouse", domain: "gusto.com" },
  { displayName: "Notion",      slug: "notion",      ats: "ashby",      domain: "notion.so" },
  { displayName: "Mistral AI",  slug: "mistral",     ats: "ashby",      domain: "mistral.ai" },
  { displayName: "Supabase",    slug: "supabase",    ats: "ashby",      domain: "supabase.com" },
  { displayName: "Linear",      slug: "linear",      ats: "ashby",      domain: "linear.app" },

  // ── More Indian product companies ─────────────────────────────────────────
  { displayName: "Razorpay",    slug: "razorpaysoftwareprivatelimited", ats: "greenhouse", domain: "razorpay.com" }, // moved lever→greenhouse (verified)
  { displayName: "BrowserStack", slug: "browserstack", ats: "greenhouse", domain: "browserstack.com" },
  { displayName: "Wingify",     slug: "wingify",     ats: "greenhouse",  domain: "wingify.com" },  // Delhi HQ
  { displayName: "Chargebee",   slug: "chargebee",   ats: "greenhouse",  domain: "chargebee.com" },
  { displayName: "MoEngage",    slug: "moengage",    ats: "greenhouse",  domain: "moengage.com" },
  { displayName: "CleverTap",   slug: "clevertap",   ats: "greenhouse",  domain: "clevertap.com" },
  { displayName: "Hasura",      slug: "hasura",      ats: "greenhouse",  domain: "hasura.io" },
  { displayName: "Setu",        slug: "setu",        ats: "lever",       domain: "setu.co" },
  { displayName: "Sprinklr",    slug: "sprinklr",    ats: "greenhouse",  domain: "sprinklr.com" },  // Gurugram HQ

  // ── Global tech with large India engineering centres ───────────────────────
  { displayName: "Atlassian",   slug: "atlassian",   ats: "greenhouse",  domain: "atlassian.com" },
  { displayName: "Nutanix",     slug: "nutanix",     ats: "greenhouse",  domain: "nutanix.com" },  // Hyderabad hub
  { displayName: "Rubrik",      slug: "rubrik",      ats: "greenhouse",  domain: "rubrik.com" },
  { displayName: "CrowdStrike", slug: "crowdstrike", ats: "greenhouse",  domain: "crowdstrike.com" },
  { displayName: "Pagerduty",   slug: "pagerduty",   ats: "greenhouse",  domain: "pagerduty.com" },
  { displayName: "Zendesk",     slug: "zendesk",     ats: "greenhouse",  domain: "zendesk.com" },
  { displayName: "HubSpot",     slug: "hubspot",     ats: "greenhouse",  domain: "hubspot.com" },
  { displayName: "Okta",        slug: "okta",        ats: "greenhouse",  domain: "okta.com" },
  { displayName: "Snowflake",   slug: "snowflake",   ats: "greenhouse",  domain: "snowflake.com" },
  { displayName: "Amplitude",   slug: "amplitude",   ats: "greenhouse",  domain: "amplitude.com" },
  { displayName: "Mixpanel",    slug: "mixpanel",    ats: "greenhouse",  domain: "mixpanel.com" },
  { displayName: "Contentful",  slug: "contentful",  ats: "greenhouse",  domain: "contentful.com" },
  { displayName: "Brex",        slug: "brex",        ats: "greenhouse",  domain: "brex.com" },
  { displayName: "Rippling",    slug: "rippling",    ats: "greenhouse",  domain: "rippling.com" },

  // ── Indian IT giants + MNCs confirmed on SmartRecruiters via ATS detection ──
  // Slugs verified from jobs.smartrecruiters.com URLs returned by Serper
  { displayName: "HCL Technologies", slug: "HCLAmericaInc",              ats: "smartrecruiters", domain: "hcltech.com" },
  { displayName: "Infosys",          slug: "Infosys2",                   ats: "smartrecruiters", domain: "infosys.com" },
  { displayName: "Cognizant",        slug: "CognizantTechnologies2",     ats: "smartrecruiters", domain: "cognizant.com" },
  { displayName: "Capgemini",        slug: "CapgeminiFSSBU",             ats: "smartrecruiters", domain: "capgemini.com" },
  { displayName: "Nagarro",          slug: "Nagarro1",                   ats: "smartrecruiters", domain: "nagarro.com" },
  { displayName: "Concentrix",       slug: "Concentrix1",                ats: "smartrecruiters", domain: "concentrix.com" },
  { displayName: "WNS",              slug: "WNSGlobalServices144",       ats: "smartrecruiters", domain: "wns.com" },
  { displayName: "Bosch",            slug: "BoschGroup",                 ats: "smartrecruiters", domain: "bosch.com" },
  { displayName: "Continental",      slug: "Continental",                ats: "smartrecruiters", domain: "continental.com" },
  { displayName: "Jabil",            slug: "NyproPackagingAJabilCompany", ats: "smartrecruiters", domain: "jabil.com" },

  // ── Indian startups / product companies — all live-probed (verified working) ──
  { displayName: "Sarvam AI",    slug: "sarvam",         ats: "ashby",           domain: "sarvam.ai" },
  { displayName: "Slice",        slug: "slice",          ats: "greenhouse",      domain: "sliceit.com" },
  { displayName: "DevRev",       slug: "devrev",         ats: "greenhouse",      domain: "devrev.ai" },
  { displayName: "Dream11",      slug: "dreamsports",    ats: "lever",           domain: "dream11.com" },
  { displayName: "Nanonets",     slug: "nanonets",       ats: "greenhouse",      domain: "nanonets.com" },
  { displayName: "Observe.ai",   slug: "observeai",      ats: "greenhouse",      domain: "observe.ai" },
  { displayName: "Porter",       slug: "porter",         ats: "lever",           domain: "porter.in" },
  { displayName: "Refyne",       slug: "refyne",         ats: "smartrecruiters", domain: "refyne.co.in" },
  { displayName: "Navi",         slug: "navi",           ats: "ashby",           domain: "navi.com" },
  { displayName: "Atlan",        slug: "atlan",          ats: "ashby",           domain: "atlan.com" },
  { displayName: "Scaler",       slug: "scaler",         ats: "ashby",           domain: "scaler.com" },
  { displayName: "Cars24",       slug: "cars24",         ats: "smartrecruiters", domain: "cars24.com" },
  { displayName: "Whatfix",      slug: "whatfix",        ats: "smartrecruiters", domain: "whatfix.com" },
  { displayName: "Newton School", slug: "newtonschool",  ats: "smartrecruiters", domain: "newtonschool.co" },
];

const ATS_URL_PATTERNS = {
  greenhouse:      (slug) => `https://boards.greenhouse.io/${slug}`,
  lever:           (slug) => `https://jobs.lever.co/${slug}`,
  ashby:           (slug) => `https://jobs.ashbyhq.com/${slug}`,
  smartrecruiters: (slug) => `https://jobs.smartrecruiters.com/${slug}`
};

const ATS_PARSER_TYPES = {
  greenhouse:      "greenhouse-api",
  lever:           "lever-api",
  ashby:           "ashby-api",
  smartrecruiters: "smartrecruiters-api"
};

async function ensureCompany({ displayName, slug, domain }) {
  const normalizedName = normalizeCompanyName(displayName);
  if (!normalizedName) {
    throw new Error(`Could not normalize company name: ${displayName}`);
  }

  let company = await Company.findOne({ name: normalizedName });

  if (company) {
    // Patch missing fields on existing entries (re-running this script will
    // backfill domains for companies registered by the older version).
    let dirty = false;
    if (!company.domain && domain) {
      company.domain = domain;
      dirty = true;
    }
    if (!company.website && domain) {
      company.website = `https://${domain}`;
      dirty = true;
    }
    if (dirty) {
      company.updatedAt = new Date();
      await company.save();
    }
    return { company, created: false, patched: dirty };
  }

  company = await Company.create({
    name: normalizedName,
    logo: null,
    domain: domain || null,
    website: domain ? `https://${domain}` : null,
    careersUrl: null,
    careersProvider: null,
    discoverySources: ["bulk-curated-ats"],
    intelligenceStatus: "seeded",
    source: "bulk-curated-ats",
    brandingSource: "bulk-curated-ats",
    brandingConfidence: "low",
    brandingReasoning: `Curated entry for ${displayName} (${slug})`
  });

  return { company, created: true, patched: false };
}

async function upsertCareerSource({ company, displayName, slug, ats }) {
  const boardUrl = ATS_URL_PATTERNS[ats](slug);
  const parserType = ATS_PARSER_TYPES[ats];
  const normalizedName = normalizeCompanyName(displayName);

  const existing = await CareerSource.findOne({
    company: company._id,
    provider: ats,
    boardUrl
  });

  if (existing) {
    if (existing.status !== "active") {
      existing.status = "active";
      existing.updatedAt = new Date();
      await existing.save();
    }
    return { source: existing, created: false };
  }

  const source = await CareerSource.create({
    company: company._id,
    companyName: normalizedName,
    provider: ats,
    boardUrl,
    careersUrl: boardUrl,
    discoveryMethod: "bulk-curated",
    parserType,
    status: "active",
    jobsFound: 0
  });

  return { source, created: true };
}

async function run() {
  await connectDB();

  let companiesCreated = 0;
  let companiesExisted = 0;
  let sourcesCreated = 0;
  let sourcesExisted = 0;
  const failures = [];

  console.log(`[BULK REGISTER] Processing ${BOARDS.length} curated boards...\n`);

  for (const entry of BOARDS) {
    try {
      const { company, created: companyCreated } = await ensureCompany(entry);
      const { created: sourceCreated } = await upsertCareerSource({
        company,
        ...entry
      });

      if (companyCreated) companiesCreated += 1;
      else companiesExisted += 1;

      if (sourceCreated) sourcesCreated += 1;
      else sourcesExisted += 1;

      const tag = sourceCreated ? "NEW source" : "exists";
      console.log(`  ${entry.displayName.padEnd(20)} ${entry.ats.padEnd(16)} -> ${tag}`);
    } catch (error) {
      failures.push({ entry, error: error.message });
      console.log(`  ${entry.displayName.padEnd(20)} ${entry.ats.padEnd(16)} -> FAILED: ${error.message}`);
    }
  }

  console.log(`\n[BULK REGISTER] Companies: ${companiesCreated} new, ${companiesExisted} existing`);
  console.log(`[BULK REGISTER] CareerSources: ${sourcesCreated} new, ${sourcesExisted} existing`);
  if (failures.length > 0) {
    console.log(`[BULK REGISTER] Failures: ${failures.length}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error("[BULK REGISTER] Failed:", error.message);
  process.exit(1);
});
