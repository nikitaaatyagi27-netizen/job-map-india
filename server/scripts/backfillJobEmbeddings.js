require("dotenv").config();

const connectDB = require("../config/db");
const Job = require("../models/Job");
const { embed, MODEL_ID } = require("../utils/embeddingClient");
const { buildEmbedText, embedTextHash } = require("../utils/jobEmbedText");

// Local embedding has no rate limit or quota, so we just run straight through.
// Batch size only controls how many jobs we embed + write per DB round-trip.
const BATCH_SIZE = Number(process.env.BACKFILL_BATCH_SIZE || 32);

async function backfillJobEmbeddings() {
  await connectDB();

  // Every active job that doesn't have an embedding yet — no time window.
  const filter = {
    isActive: true,
    embeddedAt: null
  };

  const total = await Job.countDocuments(filter);
  console.log(`[BACKFILL] Model: ${MODEL_ID} (local)`);
  console.log(`[BACKFILL] Jobs needing embeddings: ${total}`);

  let processed = 0;
  let embedded = 0;
  let skipped = 0;

  while (true) {
    const jobs = await Job.find(filter)
      .select("title requiredSkills qualifications experienceText description")
      .limit(BATCH_SIZE)
      .lean();

    if (jobs.length === 0) break;

    const prepared = jobs
      .map(job => ({ job, text: buildEmbedText(job) }))
      .filter(p => p.text);

    // Jobs with no embeddable text: stamp embeddedAt so the loop terminates.
    const emptyIds = jobs.filter(j => !buildEmbedText(j)).map(j => j._id);
    if (emptyIds.length) {
      await Job.updateMany({ _id: { $in: emptyIds } }, { $set: { embeddedAt: new Date() } });
      skipped += emptyIds.length;
    }

    if (prepared.length) {
      const vectors = await embed(prepared.map(p => p.text), { inputType: "document" });
      const ops = prepared.map((p, i) => ({
        updateOne: {
          filter: { _id: p.job._id },
          update: {
            $set: {
              embedding: vectors[i],
              embedHash: embedTextHash(p.text),
              embeddedAt: new Date()
            }
          }
        }
      }));
      // Atlas connections can drop mid-run (ECONNRESET). Retry the write a few
      // times so a transient blip doesn't abort the whole backfill — embeds are
      // already computed, so re-writing is cheap and idempotent.
      for (let attempt = 1; ; attempt++) {
        try {
          await Job.bulkWrite(ops);
          break;
        } catch (err) {
          if (attempt >= 5) throw err;
          console.warn(`[BACKFILL] DB write failed (${err.code || err.message}) — retry ${attempt}/5 in 3s`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      embedded += ops.length;
    }

    processed += jobs.length;
    console.log(`[BACKFILL] ${processed}/${total} processed | embedded ${embedded} | skipped ${skipped}`);
  }

  console.log(`[BACKFILL] Done. Embedded ${embedded}, skipped ${skipped}.`);
  process.exit();
}

backfillJobEmbeddings().catch((error) => {
  console.error("[BACKFILL] Failed");
  console.error(error);
  process.exit(1);
});
