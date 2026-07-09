# Semantic job search (local embeddings)

Job matching is **semantic**, not keyword-based. Every job carries an embedding
of its title + skills + description; search embeds the resume/skill profile and
ranks jobs by **cosine similarity computed in Node**. Relevance — not age —
decides what surfaces. The same similarity bar governs **both** DB jobs and
live-API results.

> **Local model, no time window.** Embeddings come from a local model
> (`Xenova/bge-base-en-v1.5`) via Transformers.js — no API, key, quota, or rate
> limit. Every job in the DB is embedded; there is no freshness cutoff. Hosted
> free tiers (Voyage, Gemini) were tried first but their daily caps couldn't keep
> up; local has no ceiling.

> **Why app-side cosine, not Atlas `$vectorSearch`?** Atlas Vector Search needs a
> dedicated M10+ cluster (not on free tiers). Similarity is computed in-process.
> At the current corpus size (~18k jobs) per-search memory is small. If the
> corpus grows into the tens of thousands, move to a vector index (Atlas
> `$vectorSearch` / pgvector) — that's the one place this would need to change.

## Pipeline

| Piece | File |
|-------|------|
| Embedding client (local bge-base) | `server/utils/embeddingClient.js` |
| Canonical embed text + hashing | `server/utils/jobEmbedText.js` |
| Vector fields on the model | `server/models/Job.js` (`embedding`, `embedHash`, `embeddedAt`) |
| Embed-on-ingest hook | `server/utils/jobPersistence.js` (`embedJobIfChanged`) |
| One-off / re-runnable backfill | `server/scripts/backfillJobEmbeddings.js` |
| DB search + ranking | `server/services/skillBasedJobSearchService.js` (`searchDBJobs`, `cosineSimilarity`, `relevanceFor`) |
| Live-API semantic filter | `server/services/skillBasedJobSearchService.js` (`semanticFilterLiveJobs`) |

## Model

- **`Xenova/bge-base-en-v1.5`** — 768-dim, retrieval-tuned, ~440MB.
- Runs locally on CPU via `@xenova/transformers`, downloaded once and cached.
- Asymmetric: the **query** gets a retrieval-instruction prefix, **documents**
  don't — handled inside `embed()` via `inputType` (`'query'` vs `'document'`).
- Override with `LOCAL_EMBED_MODEL` (keep `EMBEDDING_DIMENSIONS` in sync).

## Config (all optional)

```
LOCAL_EMBED_MODEL=Xenova/bge-base-en-v1.5   # embedding model
JOB_VECTOR_MIN_SCORE=0.62                    # min cosine similarity to count as a match
JOB_VECTOR_TOP_K=300                         # max DB matches returned per search
```

`MIN_VECTOR_SCORE` (0.62) is **model-specific** — bge-base has a high similarity
baseline (~0.50–0.60 for unrelated professional text), so 0.62 is where real
signal starts. **Re-measure and re-tune if you change the embedding model.**

## How search works (`searchJobsBySkills`)

1. **Cache check** — identical recent searches return cached results.
2. **DB search** (`searchDBJobs`) — embeds the resume profile, scores *all*
   embedded active jobs by cosine, keeps those ≥ `MIN_VECTOR_SCORE`, sorts,
   returns top `TOP_K`.
3. **Live APIs** — JSearch + ATS boards (Greenhouse/Lever/Ashby/SmartRecruiters)
   fetched in real time, keyword pre-filtered (`isTitleRelevant`, cheap), then
   **semantically filtered** (`semanticFilterLiveJobs`) against the same
   threshold — this drops keyword-only junk (e.g. pentest jobs for a React resume).
4. **Merge + rank** — DB + surviving live jobs are grouped by company and ranked
   by `relevanceFor` (semantic score leads; source quality is a small tiebreaker).

## Backfill

```
node server/scripts/backfillJobEmbeddings.js
```

Embeds every active job that has no vector yet — no time window. Local model, no
rate limits, runs straight through. Safe to re-run (only touches jobs where
`embeddedAt` is null).

## Storage

The free MongoDB Atlas tier is 512 MB. Embeddings (768 floats ≈ ~6KB/job) plus
descriptions add up. Three safeguards keep it bounded:

1. **`server/utils/dbQuota.js`** detects the "over quota — writes blocked"
   condition so ingestion stops cleanly instead of spamming failures.
2. **`storageCleanupService.js`** runs daily (after the staleness sweep): deletes
   inactive jobs past a grace period, and hard-caps total job count
   (`STORAGE_MAX_JOBS`, default 40k) by trimming the oldest. Run manually with
   `npm run cleanup:storage`.
3. Manual: delete inactive/non-embedded jobs to free space (writes unblock once
   back under quota; Mongo reuses freed file space rather than returning it).

Tunables: `STORAGE_INACTIVE_GRACE_DAYS` (default 3), `STORAGE_MAX_JOBS` (40000).

## Notes

- `embedding` has `select: false` — not loaded by ordinary `Job.find()`;
  `searchDBJobs` opts in with `.select('+embedding')`.
- `IRRELEVANT_TITLES` is a hard post-filter in `searchDBJobs` so
  sales/HR/leadership titles never surface regardless of similarity.
- Switching models changes vector dimensions → reset embeddings + re-run the
  backfill (all vectors must live in one comparable space).
