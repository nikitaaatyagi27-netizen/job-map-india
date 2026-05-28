require("dotenv").config();

const connectDB = require("../config/db");
const { markStaleJobs } = require("../services/staleJobService");

async function run() {
  await connectDB();
  await markStaleJobs();
  process.exit();
}

run().catch((error) => {
  console.error("Mark stale jobs failed");
  console.error(error.message);
  process.exit(1);
});
