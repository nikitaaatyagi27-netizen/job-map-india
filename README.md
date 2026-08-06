# Job Locator India

A full-stack job aggregation and semantic search platform for the Indian job market. The backend ingests listings from 13 independent sources (direct ATS boards like Workday, Greenhouse, Lever, Ashby, SmartRecruiters, SAP SuccessFactors, and Oracle Taleo, plus aggregators like JSearch, Adzuna, Naukri, Remotive, and Arbeitnow), embeds every job locally for semantic matching, and exposes it through a REST API consumed by a React map UI.

**Live app:** [job-map-india.vercel.app](https://job-map-india.vercel.app)

---

## Architecture

```
client/   React 19 + MUI + Leaflet — interactive job map UI
server/   Node.js + Express 5 + MongoDB (Mongoose) — API, ingestion, semantic search
```

The server is organized around three concerns:

- **`routes/`** — 6 route groups (`auth`, `jobs`, `session`, `admin`, `ingestion`, `resume`), each a thin HTTP layer over the service layer.
- **`services/`** — 46 modules holding the actual business logic: per-source ingestion adapters, semantic search/ranking, dedup, health scoring, branding enrichment, resume parsing, and more.
- **`scripts/`** — 50+ operational scripts for backfills, discovery, cleanup, and one-off data repair, runnable independently of the server (`npm run <script>`).

### Request flow
`app.js` wires CORS (Vercel preview domains + configured origin), cookie-based sessions, and rate limiting, then delegates to routers. `index.js` owns process bootstrap: it connects to MongoDB, starts the HTTP server, kicks off background data preparation *without blocking request handling*, and schedules six cron jobs (ingestion every 12h, staleness sweep + storage cleanup daily, job-link verification nightly, YouTube/Workday discovery weekly, dead ATS board cleanup weekly).

### Semantic search
Every job is embedded locally with `Xenova/bge-base-en-v1.5` (768-dim, ~440MB, runs on CPU via Transformers.js — no external API, key, or rate limit). A resume/skill query is embedded with a retrieval-instruction prefix and matched against stored job vectors by cosine similarity computed in-process (`skillBasedJobSearchService.js`), filtered at a tuned similarity threshold (`JOB_VECTOR_MIN_SCORE`, default 0.62) determined empirically for this model's baseline. Live-API results go through the same semantic filter before merging with DB results, so keyword-only false positives (e.g. a pentest listing matching a "React" search) are dropped regardless of source. Full pipeline documented in [`server/docs/semantic-search.md`](server/docs/semantic-search.md).

### Reliability
- **DB-first query gating** — skips redundant live API calls when local results already clear the relevance bar, cutting external dependency load.
- **Multi-provider LLM failover** (Groq → Gemini → OpenRouter) for resume parsing, so a single provider's rate limit or outage doesn't take down parsing.
- **Per-source health scoring** with exponential backoff (up to 48h) on repeated ingestion failures — an unhealthy source is isolated without blocking the rest of the ingestion queue.
- **Storage guardrails** for MongoDB Atlas's 512MB free tier: a hard cap on total job count (default 40k, oldest trimmed first) and a daily sweep that retires inactive listings past a grace period.

### Data integrity
- Two compound unique indexes prevent duplicate jobs per company (by canonical apply URL, and by normalized title + location) — dedup is enforced at the schema level, not just in application code.
- Nightly verification jobs check aggregator links for dead postings and separately verify Naukri listings via their job-detail API (Naukri's public page requires login, so a plain link check can't detect expiry there).

---

## Tech stack

**Backend:** Node.js, Express 5, MongoDB / Mongoose, `@xenova/transformers` (local embeddings), JWT + bcrypt auth, node-cron, Puppeteer (scraping), Jest + Supertest
**Frontend:** React 19, MUI, Leaflet / react-leaflet, Framer Motion

---

## Getting started

```bash
# server
cd server
npm install
cp .env.example .env   # fill in MONGO_URI and provider keys
npm start

# client
cd client
npm install
npm start
```

### Useful server scripts
```bash
npm test                        # run the Jest suite
npm run cache:clear             # clear the search cache
npm run backfill:job-descriptions
node scripts/backfillJobEmbeddings.js   # embed any job missing a vector
npm run inspect:status          # ingestion health snapshot
```

---

## Testing

```bash
npm test
```

5 test suites / 52 tests covering job identity/dedup logic, company-name cleanup, skill-gap analysis, and the jobs/admin route layer (via Supertest).

---

## API overview

| Route | Purpose |
|---|---|
| `GET /api/jobs` | Paginated map data — companies + their active jobs, with coordinate fallback |
| `POST /api/jobs/search-by-skills` | Semantic search by skills/roles, rate-limited (20 req/min) |
| `POST /api/jobs/skill-gap` | Compares a candidate's skills against a job description |
| `POST /api/jobs/click` / `report-closed` | Engagement + dead-link feedback loop |
| `/api/auth`, `/api/session` | Auth and session handling |
| `/api/admin`, `/api/ingestion` | Operator endpoints for ingestion control and monitoring |

---

## License

Personal project — not currently licensed for reuse.