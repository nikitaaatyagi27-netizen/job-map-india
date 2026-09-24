// Local embeddings via Transformers.js (bge-base-en-v1.5).
// No API, no key, no quota, no rate limit — the model runs in-process on CPU.
// The model is downloaded once (~440MB) to the Transformers.js cache on first use.

// bge-base-en-v1.5 outputs 768-dim vectors.
const EMBEDDING_DIMENSIONS = 768;
const MODEL_ID = process.env.LOCAL_EMBED_MODEL || "Xenova/bge-base-en-v1.5";

// BGE models retrieve best when the QUERY is prefixed with this instruction and
// the DOCUMENT is left bare. This is the local equivalent of an asymmetric
// query/document embedding and measurably improves match quality.
const EMBED_CHUNK_SIZE = Math.max(Number(process.env.EMBED_CHUNK_SIZE || 16), 1);

const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

// Lazily-loaded singleton pipeline — the model is loaded into memory once and
// reused for every call (loading is the expensive part).
let _extractorPromise = null;

async function getExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      // Dynamic import: @xenova/transformers is an ESM package.
      const { pipeline } = await import("@xenova/transformers");
      console.log(`[EMBED] Loading local model ${MODEL_ID} (first run downloads it)...`);
      const extractor = await pipeline("feature-extraction", MODEL_ID);
      console.log(`[EMBED] Local model ready.`);
      return extractor;
    })();
  }
  return _extractorPromise;
}


/**
 * Embed one or more texts with the local bge-base model.
 *
 * Same interface as the previous hosted clients, so callers (search, backfill,
 * ingestion) need no changes.
 *
 * @param {string|string[]} input - a single string or a batch of strings
 * @param {Object} options
 * @param {'query'|'document'} options.inputType
 *   'document' for jobs (no prefix); 'query' for a resume/skill profile
 *   (BGE query-instruction prefix added).
 * @returns {Promise<number[]|number[][]>} a single vector for a string input, or an array of vectors (input order preserved) for an array input.
 */

// ─── Hosted option: Cloudflare Workers AI (same bge-base-en-v1.5 weights) ─────
// Set EMBED_PROVIDER=cloudflare (+ CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)
// on small hosts like Render's 512 MB free tier, where loading the ONNX model
// runs out of memory. Workers AI defaults to MEAN pooling for bge models — the
// same pooling as the local path — so its vectors are comparable with the job
// embeddings produced locally by ingestion. (Never pass pooling: "cls" here:
// CLS vectors are not compatible with the stored mean-pooled ones.)
const USE_CLOUDFLARE = String(process.env.EMBED_PROVIDER || "").toLowerCase() === "cloudflare";
const CF_MODEL = "@cf/baai/bge-base-en-v1.5";
const CF_BATCH = 50;

function normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map(v => v / norm);
}

async function embedWithCloudflare(texts) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error("EMBED_PROVIDER=cloudflare needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
  }
  const axios = require("axios");
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`;
  const vectors = [];
  for (let start = 0; start < texts.length; start += CF_BATCH) {
    const batch = texts.slice(start, start + CF_BATCH);
    const { data } = await axios.post(
      url,
      { text: batch, pooling: "mean" },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
    );
    const rows = data?.result?.data;
    if (!Array.isArray(rows) || rows.length !== batch.length) {
      throw new Error(`Cloudflare embedding returned ${rows?.length ?? "no"} vectors for ${batch.length} texts`);
    }
    for (const row of rows) vectors.push(normalize(row));
  }
  return vectors;
}

async function embed(input, { inputType = "document" } = {}) {
  if (USE_CLOUDFLARE) {
    const isBatch = Array.isArray(input);
    const raw = (isBatch ? input : [input]).map(t => (t || "").toString());
    const texts = inputType === "query" ? raw.map(t => QUERY_PREFIX + t) : raw;
    const vectors = await embedWithCloudflare(texts);
    return isBatch ? vectors : vectors[0];
  }

  const extractor = await getExtractor();

  const isBatch = Array.isArray(input);
  const raw = (isBatch ? input : [input]).map(t => (t || "").toString());
  const texts = inputType === "query"
    ? raw.map(t => QUERY_PREFIX + t)
    : raw;

  // Mean-pool + normalize → one unit-length vector per text. With normalization,
  // cosine similarity reduces to a dot product, and scores land in a clean range.
  // Run in small chunks: ONNX activation memory grows with batch size × sequence
  // length, and one call with hundreds of long texts can exceed a 512 MB host.
  const vectors = [];
  for (let start = 0; start < texts.length; start += EMBED_CHUNK_SIZE) {
    const output = await extractor(texts.slice(start, start + EMBED_CHUNK_SIZE), { pooling: "mean", normalize: true });

    // output is a Tensor of shape [n, 768]; slice it into per-text arrays.
    const [n, dim] = output.dims;
    const data = output.data;
    for (let i = 0; i < n; i++) {
      vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
    }
  }

  return isBatch ? vectors : vectors[0];
}

module.exports = { embed, EMBEDDING_DIMENSIONS, MODEL_ID };



// Hosted embeddings via Hugging Face Inference API (bge-base-en-v1.5).
// No local model in memory — fixes the Render 512MB OOM crash.
// Same weights as Xenova/bge-base-en-v1.5, so vector space is unchanged.

// bge-base-en-v1.5 outputs 768-dim vectors.
