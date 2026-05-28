/**
 * Seeds well-known India tech companies into the DB with basic profile data.
 * These companies use custom career pages or Indian ATS platforms, so we
 * don't try to integrate their ATS — we just ensure they appear on the map
 * and have a careers URL so users can apply directly.
 * JSearch/Adzuna will populate their jobs organically over time.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Company = require('../models/Company');
const normalizeCompanyName = require('../utils/normalizeCompanyName');
const getCoords = require('../utils/geocode');

// ─── Seed list ────────────────────────────────────────────────────────────────
// Format: { name, city, domain, careersUrl }
const SEEDS = [
  // ── Fintech ──────────────────────────────────────────────────────────────
  { name: 'Razorpay',        city: 'Bangalore', domain: 'razorpay.com',       careersUrl: 'https://razorpay.com/jobs' },
  { name: 'CRED',            city: 'Bangalore', domain: 'cred.club',          careersUrl: 'https://careers.cred.club' },
  { name: 'PhonePe',         city: 'Bangalore', domain: 'phonepe.com',        careersUrl: 'https://www.phonepe.com/careers' },
  { name: 'Groww',           city: 'Bangalore', domain: 'groww.in',           careersUrl: 'https://groww.in/about/careers' },
  { name: 'Zerodha',         city: 'Bangalore', domain: 'zerodha.com',        careersUrl: 'https://zerodha.com/careers' },
  { name: 'Upstox',          city: 'Mumbai',    domain: 'upstox.com',         careersUrl: 'https://upstox.com/careers' },
  { name: 'Paytm',           city: 'Noida',     domain: 'paytm.com',          careersUrl: 'https://paytm.com/about-us/careers' },
  { name: 'BharatPe',        city: 'Delhi',     domain: 'bharatpe.com',       careersUrl: 'https://jobs.bharatpe.com' },
  { name: 'Slice',           city: 'Bangalore', domain: 'sliceit.com',        careersUrl: 'https://sliceit.com/careers' },
  { name: 'Jupiter Money',   city: 'Bangalore', domain: 'jupiter.money',      careersUrl: 'https://jupiter.money/careers' },
  { name: 'Fi Money',        city: 'Bangalore', domain: 'fi.money',           careersUrl: 'https://fi.money/careers' },
  { name: 'Smallcase',       city: 'Bangalore', domain: 'smallcase.com',      careersUrl: 'https://smallcase.com/careers' },
  { name: 'Lendingkart',     city: 'Ahmedabad', domain: 'lendingkart.com',    careersUrl: 'https://lendingkart.com/careers' },
  { name: 'KreditBee',       city: 'Bangalore', domain: 'kreditbee.in',       careersUrl: 'https://kreditbee.in/careers' },
  { name: 'Acko',            city: 'Bangalore', domain: 'acko.com',           careersUrl: 'https://www.acko.com/careers' },
  { name: 'PolicyBazaar',    city: 'Gurugram',  domain: 'policybazaar.com',   careersUrl: 'https://www.policybazaar.com/info/careers' },
  { name: 'Cashfree',        city: 'Bangalore', domain: 'cashfree.com',       careersUrl: 'https://www.cashfree.com/careers' },
  { name: 'Perfios',         city: 'Bangalore', domain: 'perfios.com',        careersUrl: 'https://www.perfios.com/careers' },

  // ── SaaS / B2B ───────────────────────────────────────────────────────────
  { name: 'Freshworks',      city: 'Chennai',   domain: 'freshworks.com',     careersUrl: 'https://www.freshworks.com/company/careers' },
  { name: 'Zoho',            city: 'Chennai',   domain: 'zoho.com',           careersUrl: 'https://www.zoho.com/careers.html' },
  { name: 'BrowserStack',    city: 'Mumbai',    domain: 'browserstack.com',   careersUrl: 'https://www.browserstack.com/careers' },
  { name: 'Chargebee',       city: 'Chennai',   domain: 'chargebee.com',      careersUrl: 'https://www.chargebee.com/careers' },
  { name: 'Darwinbox',       city: 'Hyderabad', domain: 'darwinbox.com',      careersUrl: 'https://darwinbox.com/careers' },
  { name: 'CleverTap',       city: 'Mumbai',    domain: 'clevertap.com',      careersUrl: 'https://clevertap.com/careers' },
  { name: 'MoEngage',        city: 'Bangalore', domain: 'moengage.com',       careersUrl: 'https://www.moengage.com/careers' },
  { name: 'Druva',           city: 'Pune',      domain: 'druva.com',          careersUrl: 'https://www.druva.com/company/careers' },
  { name: 'Postman',         city: 'Bangalore', domain: 'postman.com',        careersUrl: 'https://www.postman.com/company/careers' },
  { name: 'Wingify',         city: 'Delhi',     domain: 'wingify.com',        careersUrl: 'https://wingify.com/careers' },
  { name: 'Innovaccer',      city: 'Noida',     domain: 'innovaccer.com',     careersUrl: 'https://innovaccer.com/careers' },
  { name: 'Mindtickle',      city: 'Pune',      domain: 'mindtickle.com',     careersUrl: 'https://www.mindtickle.com/careers' },
  { name: 'Whatfix',         city: 'Bangalore', domain: 'whatfix.com',        careersUrl: 'https://whatfix.com/careers' },
  { name: 'Icertis',         city: 'Pune',      domain: 'icertis.com',        careersUrl: 'https://www.icertis.com/company/careers' },
  { name: 'Zenoti',          city: 'Hyderabad', domain: 'zenoti.com',         careersUrl: 'https://www.zenoti.com/company/careers' },
  { name: 'Leadsquared',     city: 'Bangalore', domain: 'leadsquared.com',    careersUrl: 'https://www.leadsquared.com/careers' },
  { name: 'Yellow.ai',       city: 'Bangalore', domain: 'yellow.ai',          careersUrl: 'https://yellow.ai/careers' },
  { name: 'Exotel',          city: 'Bangalore', domain: 'exotel.com',         careersUrl: 'https://exotel.com/company/careers' },
  { name: 'Uniphore',        city: 'Chennai',   domain: 'uniphore.com',       careersUrl: 'https://www.uniphore.com/company/careers' },
  { name: 'Springworks',     city: 'Bangalore', domain: 'springworks.in',     careersUrl: 'https://www.springworks.in/careers' },
  { name: 'Khatabook',       city: 'Bangalore', domain: 'khatabook.com',      careersUrl: 'https://khatabook.com/careers' },
  { name: 'Locus',           city: 'Bangalore', domain: 'locus.sh',           careersUrl: 'https://locus.sh/careers' },
  { name: 'Udaan',           city: 'Bangalore', domain: 'udaan.com',          careersUrl: 'https://udaan.com/careers' },
  { name: 'Hasura',          city: 'Bangalore', domain: 'hasura.io',          careersUrl: 'https://hasura.io/careers' },

  // ── Consumer / E-commerce ────────────────────────────────────────────────
  { name: 'Swiggy',          city: 'Bangalore', domain: 'swiggy.com',         careersUrl: 'https://careers.swiggy.com' },
  { name: 'Zomato',          city: 'Gurugram',  domain: 'zomato.com',         careersUrl: 'https://www.zomato.com/careers' },
  { name: 'Flipkart',        city: 'Bangalore', domain: 'flipkart.com',       careersUrl: 'https://www.flipkartcareers.com' },
  { name: 'Meesho',          city: 'Bangalore', domain: 'meesho.com',         careersUrl: 'https://meesho.io/careers' },
  { name: 'Nykaa',           city: 'Mumbai',    domain: 'nykaa.com',          careersUrl: 'https://careers.nykaa.com' },
  { name: 'Cars24',          city: 'Gurugram',  domain: 'cars24.com',         careersUrl: 'https://www.cars24.com/careers' },
  { name: 'CarDekho',        city: 'Jaipur',    domain: 'cardekho.com',       careersUrl: 'https://www.cardekho.com/careers' },
  { name: 'OLX India',       city: 'Gurugram',  domain: 'olx.in',             careersUrl: 'https://www.olx.in/careers' },
  { name: 'NoBroker',        city: 'Bangalore', domain: 'nobroker.in',        careersUrl: 'https://www.nobroker.in/careers' },
  { name: 'Lenskart',        city: 'Delhi',     domain: 'lenskart.com',       careersUrl: 'https://www.lenskart.com/careers' },
  { name: 'Mamaearth',       city: 'Gurugram',  domain: 'mamaearth.in',       careersUrl: 'https://mamaearth.in/careers' },

  // ── Edtech ───────────────────────────────────────────────────────────────
  { name: 'Unacademy',       city: 'Bangalore', domain: 'unacademy.com',      careersUrl: 'https://unacademy.com/careers' },
  { name: 'upGrad',          city: 'Mumbai',    domain: 'upgrad.com',         careersUrl: 'https://www.upgrad.com/careers' },
  { name: 'Vedantu',         city: 'Bangalore', domain: 'vedantu.com',        careersUrl: 'https://www.vedantu.com/info/careers' },
  { name: 'Physics Wallah',  city: 'Noida',     domain: 'pw.live',            careersUrl: 'https://careers.pw.live' },
  { name: 'Scaler',          city: 'Bangalore', domain: 'scaler.com',         careersUrl: 'https://www.scaler.com/careers' },

  // ── Healthtech ───────────────────────────────────────────────────────────
  { name: 'Practo',          city: 'Bangalore', domain: 'practo.com',         careersUrl: 'https://careers.practo.com' },
  { name: 'Pristyn Care',    city: 'Gurugram',  domain: 'pristyncare.com',    careersUrl: 'https://www.pristyncare.com/career' },
  { name: 'Cure.fit',        city: 'Bangalore', domain: 'cure.fit',           careersUrl: 'https://www.cure.fit/careers' },
  { name: 'HealthKart',      city: 'Gurugram',  domain: 'healthkart.com',     careersUrl: 'https://www.healthkart.com/careers' },

  // ── Logistics / Mobility ─────────────────────────────────────────────────
  { name: 'Delhivery',       city: 'Gurugram',  domain: 'delhivery.com',      careersUrl: 'https://careers.delhivery.com' },
  { name: 'Ola',             city: 'Bangalore', domain: 'olacabs.com',        careersUrl: 'https://www.olacabs.com/careers' },
  { name: 'Rapido',          city: 'Bangalore', domain: 'rapido.bike',        careersUrl: 'https://rapido.bike/careers' },
  { name: 'Porter',          city: 'Bangalore', domain: 'porter.in',          careersUrl: 'https://porter.in/careers' },
  { name: 'Shiprocket',      city: 'Delhi',     domain: 'shiprocket.in',      careersUrl: 'https://shiprocket.in/careers' },
  { name: 'Shadowfax',       city: 'Bangalore', domain: 'shadowfax.in',       careersUrl: 'https://shadowfax.in/careers' },
  { name: 'Ninjacart',       city: 'Bangalore', domain: 'ninjacart.com',      careersUrl: 'https://ninjacart.com/careers' },
  { name: 'Ather Energy',    city: 'Bangalore', domain: 'atherenergy.com',    careersUrl: 'https://www.atherenergy.com/careers' },

  // ── Gaming / Media / Social ──────────────────────────────────────────────
  { name: 'Dream11',         city: 'Mumbai',    domain: 'dream11.com',        careersUrl: 'https://www.dream11.com/careers' },
  { name: 'ShareChat',       city: 'Bangalore', domain: 'sharechat.com',      careersUrl: 'https://sharechat.com/careers' },
  { name: 'InMobi',          city: 'Bangalore', domain: 'inmobi.com',         careersUrl: 'https://www.inmobi.com/company/careers' },
  { name: 'MPL',             city: 'Bangalore', domain: 'mpl.live',           careersUrl: 'https://www.mpl.live/careers' },
  { name: 'Dailyhunt',       city: 'Bangalore', domain: 'dailyhunt.in',       careersUrl: 'https://dailyhunt.in/careers' },

  // ── Infrastructure / Deep Tech ───────────────────────────────────────────
  { name: 'Setu',            city: 'Bangalore', domain: 'setu.co',            careersUrl: 'https://setu.co/careers' },
  { name: 'Juspay',          city: 'Bangalore', domain: 'juspay.in',          careersUrl: 'https://juspay.in/careers' },
  { name: 'Dezerv',          city: 'Bangalore', domain: 'dezerv.in',          careersUrl: 'https://www.dezerv.in/careers' },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`DB connected — seeding ${SEEDS.length} companies\n`);

  // Pre-fetch all existing names to avoid N+1 queries
  const existing = new Set(
    (await Company.find({}).select('name').lean()).map(c => c.name)
  );

  let seeded = 0, skipped = 0;

  for (const entry of SEEDS) {
    const normalizedName = normalizeCompanyName(entry.name);
    if (!normalizedName) continue;

    if (existing.has(normalizedName)) {
      process.stdout.write('.');
      skipped++;
      continue;
    }

    const coords = await getCoords(entry.city + ', India');
    const logo = entry.domain ? `https://img.logo.dev/${entry.domain}` : null;

    await Company.create({
      name: normalizedName,
      logo,
      domain: entry.domain,
      website: `https://${entry.domain}`,
      careersUrl: entry.careersUrl,
      careersProvider: null,
      discoverySources: ['manual-seed'],
      intelligenceStatus: 'direct-source-linked',
      source: 'manual-seed',
      city: entry.city,
      location: entry.city + ', India',
      coords,
      lastIntelligenceAt: new Date()
    });

    existing.add(normalizedName);
    seeded++;
    process.stdout.write('✅');
  }

  console.log(`\n\n── Summary ──────────────────────────────`);
  console.log(`Seeded  : ${seeded} new companies`);
  console.log(`Skipped : ${skipped} already in DB`);
  console.log(`Total   : ${seeded + skipped}`);

  await mongoose.disconnect();
}

run().catch(e => { console.error(e.message); process.exit(1); });
