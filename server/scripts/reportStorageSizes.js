// Reports storage size per collection so you know what's actually eating
// your Atlas quota before deleting anything.
//
// Run with: node scripts/reportStorageSizes.js
//
// Notes:
//  - "storageSize" is what counts against your Atlas quota (disk pages
//    allocated by WiredTiger). It does NOT shrink automatically when you
//    deleteMany() — only dataSize drops. That's why deletes can "not seem
//    to work" even though document counts go down.
//  - "avgObjSize" tells you the fattest doc shape (e.g. Job.embedding is a
//    768-float array and is usually the main offender).

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function pad(value, width) {
  const str = String(value ?? "");
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

(async () => {
  await connectDB();
  const db = mongoose.connection.db;

  const dbStats = await db.stats();
  console.log("=".repeat(78));
  console.log(`DATABASE: ${db.databaseName}`);
  console.log("=".repeat(78));
  console.log(`dataSize:    ${mb(dbStats.dataSize)}  (logical size of all docs)`);
  console.log(`storageSize: ${mb(dbStats.storageSize)}  (allocated on disk — this is what counts against your 512MB quota)`);
  console.log(`indexSize:   ${mb(dbStats.indexSize)}`);
  console.log(`totalSize:   ${mb(dbStats.storageSize + dbStats.indexSize)}  (storageSize + indexSize ≈ what Atlas shows you)`);
  console.log("");

  const collections = await db.listCollections().toArray();
  const rows = [];

  for (const { name } of collections) {
    if (name.startsWith("system.")) continue;
    const stats = await db.command({ collStats: name });
    rows.push({
      name,
      count: stats.count || 0,
      storageSize: stats.storageSize || 0,
      dataSize: stats.size || 0,
      indexSize: stats.totalIndexSize || 0,
      avgObjSize: stats.avgObjSize || 0
    });
  }

  rows.sort((a, b) => b.storageSize - a.storageSize);

  console.log(
    pad("collection", 22) + pad("docs", 10) + pad("storageSize", 14) +
    pad("dataSize", 14) + pad("indexSize", 12) + "avgObjSize"
  );
  console.log("-".repeat(90));

  for (const r of rows) {
    console.log(
      pad(r.name, 22) +
      pad(r.count, 10) +
      pad(mb(r.storageSize), 14) +
      pad(mb(r.dataSize), 14) +
      pad(mb(r.indexSize), 12) +
      (r.avgObjSize ? (r.avgObjSize / 1024).toFixed(2) + " KB" : "-")
    );
  }

  console.log("");
  console.log("Tip: sort is by storageSize (what counts against quota), highest first.");
  console.log("Tip: deleteMany() lowers dataSize but usually NOT storageSize on M0 —");
  console.log("     that space is only reclaimed by dropping the collection (or on a");
  console.log("     paid tier, running compact()).");

  process.exit(0);
})().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});