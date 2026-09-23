require("dotenv").config();
const connectDB = require("../config/db");
const Job = require("../models/Job");
const Company = require("../models/Company");

(async () => {
  await connectDB();

  const totalJobs = await Job.countDocuments({});
  const activeJobs = await Job.countDocuments({ isActive: true });
  const inactiveJobs = await Job.countDocuments({ isActive: false });
  const embeddedJobs = await Job.countDocuments({ embedding: { $ne: null } });
  const activeEmbeddedJobs = await Job.countDocuments({ isActive: true, embedding: { $ne: null } });
  const activeNotEmbedded = await Job.countDocuments({ isActive: true, embedding: null });

  const totalCompanies = await Company.countDocuments({});
  const companiesWithActiveEmbeddedJob = await Job.distinct("company", { isActive: true, embedding: { $ne: null } });
  const companiesWithAnyActiveJob = await Job.distinct("company", { isActive: true });
  const companiesWithGeocode = await Company.countDocuments({ lat: { $ne: null }, lng: { $ne: null } });
  const companiesWithoutGeocode = totalCompanies - companiesWithGeocode;

  console.log("=".repeat(60));
  console.log("JOBS");
  console.log("=".repeat(60));
  console.log(`Total jobs:                     ${totalJobs}`);
  console.log(`Active jobs:                    ${activeJobs}`);
  console.log(`Inactive jobs:                  ${inactiveJobs}`);
  console.log(`Jobs with embedding:            ${embeddedJobs}`);
  console.log(`Active + embedded (the pool):   ${activeEmbeddedJobs}  <-- this is what searchDBJobs actually scores`);
  console.log(`Active but NOT embedded:        ${activeNotEmbedded}  <-- invisible to semantic search`);

  console.log("");
  console.log("=".repeat(60));
  console.log("COMPANIES");
  console.log("=".repeat(60));
  console.log(`Total companies:                          ${totalCompanies}`);
  console.log(`Companies with >=1 active job:             ${companiesWithAnyActiveJob.length}`);
  console.log(`Companies with >=1 active+embedded job:    ${companiesWithActiveEmbeddedJob.length}  <-- max possible companies a search could ever surface`);
  console.log(`Companies with lat/lng geocoded:            ${companiesWithGeocode}`);
  console.log(`Companies WITHOUT lat/lng (excluded from results): ${companiesWithoutGeocode}`);

  process.exit(0);
})().catch(e => {
  console.error("Failed:", e.message);
  process.exit(1);
});