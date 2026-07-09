// Local embeddings via Transformers.js (bge-base-en-v1.5).
// No API, no key, no quota, no rate limit — the model runs in-process on CPU.
// The model is downloaded once (~440MB) to the Transformers.js cache on first use.

// bge-base-en-v1.5 outputs 768-dim vectors.
const EMBEDDING_DIMENSIONS = 768;
const MODEL_ID = process.env.LOCAL_EMBED_MODEL || "Xenova/bge-base-en-v1.5";

// BGE models retrieve best when the QUERY is prefixed with this instruction and
// the DOCUMENT is left bare. This is the local equivalent of an asymmetric
// query/document embedding and measurably improves match quality.
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
 * @returns {Promise<number[]|number[][]>} a single vector for a string input,
 *   or an array of vectors (input order preserved) for an array input.
 */
async function embed(input, { inputType = "document" } = {}) {
  const extractor = await getExtractor();

  const isBatch = Array.isArray(input);
  const raw = (isBatch ? input : [input]).map(t => (t || "").toString());
  const texts = inputType === "query"
    ? raw.map(t => QUERY_PREFIX + t)
    : raw;

  // Mean-pool + normalize → one unit-length vector per text. With normalization,
  // cosine similarity reduces to a dot product, and scores land in a clean range.
  const output = await extractor(texts, { pooling: "mean", normalize: true });

  // output is a Tensor of shape [n, 768]; slice it into per-text arrays.
  const [n, dim] = output.dims;
  const data = output.data;
  const vectors = [];
  for (let i = 0; i < n; i++) {
    vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }

  return isBatch ? vectors : vectors[0];
}

module.exports = { embed, EMBEDDING_DIMENSIONS, MODEL_ID };
