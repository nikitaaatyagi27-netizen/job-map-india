require("dotenv").config();

const connectDB = require("../config/db");
const Job = require("../models/Job");
const { searchDBJobs } = require("../services/skillBasedJobSearchService");

// Sample resume profiles to try. Edit/add freely.
const PROFILES = [
  { label: "Frontend (React/TS)", primarySkills: ["react", "typescript", "javascript"], secondarySkills: ["css", "redux"], roles: ["Frontend Developer", "React Developer"], domain: "fullstack" },
  { label: "Data Science (Python/ML)", primarySkills: ["python", "machine learning", "pandas"], secondarySkills: ["sql", "tensorflow"], roles: ["Data Scientist", "ML Engineer"], domain: "data-science" },
  { label: "Backend (Java/Spring)", primarySkills: ["java", "spring boot", "microservices"], secondarySkills: ["kafka", "postgresql"], roles: ["Backend Engineer", "Java Developer"], domain: "backend" }
];

async function run() {
  await connectDB();

  const embedded = await Job.countDocuments({ embeddedAt: { $ne: null } });
  console.log(`\nEmbedded jobs available for search: ${embedded}\n`);

  for (const p of PROFILES) {
    console.log("============================================================");
    console.log(`PROFILE: ${p.label}`);
    console.log(`  skills: ${p.primarySkills.join(", ")} | roles: ${p.roles.join(", ")}`);
    console.log("------------------------------------------------------------");

    const results = await searchDBJobs(p.primarySkills, p.secondarySkills, p.roles, p.domain);

    if (!results.length) {
      console.log("  (no matches above threshold — try lowering JOB_VECTOR_MIN_SCORE)\n");
      continue;
    }

    results.slice(0, 10).forEach((r, i) => {
      const score = r._vectorScore != null ? r._vectorScore.toFixed(3) : "—";
      console.log(`  ${String(i + 1).padStart(2)}. [${score}] ${r.job_title}  @ ${r.employer_name}  (${r.source})`);
    });
    console.log(`  ...${results.length} total matches\n`);
  }

  process.exit();
}

run().catch((e) => { console.error(e); process.exit(1); });
