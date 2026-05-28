require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { runYoutubeHiringDiscovery } = require("../services/youtubeHiringService");

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log("Connected to MongoDB");
  const result = await runYoutubeHiringDiscovery();
  console.log("\nResult:", result);
  await mongoose.disconnect();
}

run().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
