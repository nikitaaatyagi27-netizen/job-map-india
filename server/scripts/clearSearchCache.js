require("dotenv").config();

const connectDB = require("../config/db");
const SearchCache = require("../models/SearchCache");

async function run() {
  await connectDB();
  const result = await SearchCache.deleteMany({});
  console.log(`[SEARCH CACHE] Cleared ${result.deletedCount || 0} cached search result(s).`);
  process.exit(0);
}

run().catch((err) => {
  console.error("[SEARCH CACHE] Clear failed:", err.message);
  process.exit(1);
});
