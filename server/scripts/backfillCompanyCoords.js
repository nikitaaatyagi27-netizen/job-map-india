require("dotenv").config();

const connectDB = require("../config/db");
const { backfillCompanyCoords } = require("../services/companyCoordsService");

async function run() {
  await connectDB();
  await backfillCompanyCoords();
  process.exit();
}

run().catch((error) => {
  console.error("Coordinate backfill failed");
  console.error(error.message);
  process.exit(1);
});
