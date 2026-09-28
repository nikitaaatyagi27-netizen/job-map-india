# Job Map India 🗺️

**Upload your resume, see who is hiring near you.**
Job Map India reads a resume, works out your skills and experience level, and shows matching jobs on an interactive map of India, grouped by company. It is available as a **web app** and an **Android app**, both backed by the same API.

[**Live web app**](https://job-map-india.vercel.app) · [**Download the Android APK**](https://github.com/nikitaaatyagi27-netizen/job-map-india/releases/latest) · [How it works](#how-it-works) · [Run it locally](#run-it-locally)

<!-- Add screenshots to docs/screenshots/ and uncomment:
<p align="center">
  <img src="docs/screenshots/map.png" width="240" alt="Map view" />
  <img src="docs/screenshots/company.png" width="240" alt="Company sheet with skill match" />
  <img src="docs/screenshots/saved.png" width="240" alt="Saved jobs" />
</p>
-->

---

## What the app does

1. **Upload a resume** (PDF, DOC or DOCX). An LLM parses it into skills, roles and experience.
2. **Pick your level**: Fresher (0–2 yrs), Mid (2–5 yrs) or Senior (5+ yrs).
3. **Get matched jobs on a map.** Companies hiring for your profile appear as pins on a dark map of India. Tap a company to see its roles.
4. **See how well you fit.** Every role shows skill-match bars and a skill-gap comparison against the job description.
5. **Act on it.** Apply (opens the original posting), save or unsave jobs, and report closed listings so dead links get cleaned up.

Also included: map and list views, an experience-level filter, saved jobs, optional sign-in (anonymous sessions work without an account), and the last search restored on launch.

## Features

| | |
|---|---|
| 🎯 **Semantic matching** | Jobs are matched to your resume by meaning, not keywords, so a pentest job doesn't show up for a "React" search. |
| 🏢 **13 job sources** | Direct company career boards (Workday, Greenhouse, Lever, Ashby, SmartRecruiters, SAP SuccessFactors, Oracle Taleo) plus JSearch, Adzuna, Naukri, Remotive and Arbeitnow. |
| 📍 **Map-first UI** | Leaflet map with clustering; no Google Maps key needed. |
| 📱 **Web + Android** | React web app and a React Native (Expo) Android app sharing one backend. |
| 🧹 **Fresh listings** | Nightly link verification, stale-job sweeps, and user "report closed" feedback. |
| 🔁 **Resilient** | LLM provider failover, per-source health scoring with backoff, and a DB-first query strategy. |

---

## Architecture

```
client/    React 19 + MUI + Leaflet        → web app (Vercel)
Android app: React Native (Expo) + WebView → installable APK (see Releases)
server/    Node.js + Express 5 + MongoDB   → REST API, ingestion, semantic search
```

```
   Web app (Vercel) ─┐
                     ├──▶  API (Render) ──▶ MongoDB Atlas
 Android app (APK) ──┘          │
                                └──▶ Cloudflare Workers AI (query embeddings)

 GitHub Actions (scheduled) ──▶ ingestion · embeddings · verification · cleanup ──▶ MongoDB Atlas
```

### Deployment

| Part | Where | Why |
|---|---|---|
| Web app | Vercel | Static React build |
| API | Render (free plan, `WEB_ONLY=true`) | Serves requests only; small memory footprint |
| Background jobs | GitHub Actions (`.github/workflows/background-jobs.yml`) | Ingestion, scraping, embeddings and cleanup run on a schedule, off the small web server |
| Database | MongoDB Atlas (free tier, 512 MB) | Jobs, companies, sessions, users |
| Query embeddings on the API | Cloudflare Workers AI | The local model needs more RAM than Render's free plan has; same `bge-base-en-v1.5` weights, so vectors stay compatible |

Step-by-step free deployment guide: [`DEPLOY-FREE.md`](DEPLOY-FREE.md).

---

## How it works

### Ingestion
Scheduled tasks pull jobs from all 13 sources every 12 hours, normalize them, and store them per company. A source that keeps failing is backed off (up to 48 h) without blocking the others.

### Semantic search
Every job is embedded with `Xenova/bge-base-en-v1.5` (768 dimensions, runs on CPU via Transformers.js, no API key or rate limit). A resume is embedded as a query and compared with job vectors by cosine similarity in Node. Results below a tuned similarity threshold (`JOB_VECTOR_MIN_SCORE`, default 0.62) are dropped, and live-API results pass through the same filter before merging with database results. Details: [`server/docs/semantic-search.md`](server/docs/semantic-search.md).

### Data integrity
Two compound unique indexes prevent duplicate jobs per company (by canonical apply URL, and by normalized title + location). Nightly jobs verify aggregator links, and Naukri listings are verified separately through their job-detail API.

### Storage guardrails
The database lives on Atlas's 512 MB free tier, so it is kept bounded: a daily sweep deletes inactive listings after a grace period, and a hard cap on total jobs (`STORAGE_MAX_JOBS`, default 15,000) trims the oldest first. Manual helpers live in `server/scripts/` (`checkCollectionSizes.js`, `deleteOldestJobs.js`, `deleteInactiveJobs.js`).

---

## Android app

The Android app is a React Native (Expo SDK 57) port of the web client. It uses the same API, so the backend must be reachable. The map runs in a WebView using Leaflet, so no Google Maps key is needed.

**Install:** download the latest `.apk` from the [Releases page](https://github.com/nikitaaatyagi27-netizen/job-map-india/releases/latest), open it on your phone, and allow "Install unknown apps" for your browser when asked.

**Server URL:** the app connects to the same API as the web app. If no URL is baked in, it asks for the server address on first launch (change it later with the **Server** button on the home screen).

> The API runs on Render's free plan and sleeps after 15 minutes idle, so the first request can take about a minute.

---

## Tech stack

**Backend:** Node.js, Express 5, MongoDB / Mongoose, `@xenova/transformers`, JWT + bcrypt, node-cron, Puppeteer, Jest + Supertest
**Web:** React 19, MUI, Leaflet / react-leaflet, Supercluster, Framer Motion
**Mobile:** React Native, Expo, react-native-webview, AsyncStorage
**LLMs (resume parsing):** Groq → Gemini → OpenRouter with automatic failover
**Infra:** Vercel, Render, GitHub Actions, MongoDB Atlas, Cloudflare Workers AI

---

## Run it locally

```bash
# API
cd server
npm install
cp .env.example .env     # fill in MONGO_URI and at least one LLM key
npm start

# Web app
cd client
npm install
npm start
```

Useful server commands:
```bash
npm test                                  # Jest suite
npm run cache:clear                       # clear the search cache
npm run inspect:status                    # ingestion health snapshot
node scripts/backfillJobEmbeddings.js     # embed any job missing a vector
node scripts/checkCollectionSizes.js      # database size per collection
```

## API overview

| Route | Purpose |
|---|---|
| `GET /api/jobs` | Paginated map data: companies with their active jobs |
| `POST /api/jobs/search-by-skills` | Semantic search by skills and roles (rate-limited) |
| `POST /api/jobs/skill-gap` | Compare a candidate's skills against a job description |
| `POST /api/jobs/click`, `/report-closed` | Apply-click tracking and dead-link reports |
| `/api/resume` | Resume upload and parsing |
| `/api/session`, `/api/auth` | Anonymous sessions, saved jobs, sign-in |
| `/api/admin`, `/api/ingestion` | Operator endpoints for ingestion control and monitoring |

## Testing

```bash
cd server && npm test
```
Covers job identity and dedup logic, company-name cleanup, skill-gap analysis, and the jobs/admin routes (via Supertest).

---

## License

Personal project, not currently licensed for reuse.

---

## License

Personal project — not currently licensed for reuse.
