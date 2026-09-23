require("dotenv").config();

const connectDB = require("../config/db");
const mongoose = require("mongoose");

const COLLECTIONS = [
  "jobs",
  "companies",
  "ingestionruns",
  "discoveryqueries",
  "searchcaches",
  "sessions",
  "careersources",
  "sourcehealths",
  "workdaytenantconfigs",
  "users"
];

(async () => {
  await connectDB();
  const db = mongoose.connection.db;

  console.log("=== Collection sizes ===");
  for (const name of COLLECTIONS) {
    try {
      const count = await db.collection(name).countDocuments();
      const stats = await db.command({ collStats: name });
      const storageMB = (stats.storageSize / (1024 * 1024)).toFixed(2);
      const dataMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(
        `${name.padEnd(22)} | docs: ${String(count).padEnd(8)} | storage: ${storageMB} MB | data: ${dataMB} MB`
      );
    } catch (e) {
      console.log(`${name.padEnd(22)} | (missing or error: ${e.message})`);
    }
  }

  process.exit();
})().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});