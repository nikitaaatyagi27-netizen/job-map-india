# Free deploy without a card: Render (API) + GitHub Actions (background jobs)

The API runs on Render's free web service with `WEB_ONLY=true`, so it only
serves requests. Ingestion, Chrome scraping, embedding and cleanup run on a
schedule in GitHub Actions (`.github/workflows/background-jobs.yml`).

## 1. MongoDB Atlas
Network Access → Add IP Address → **Allow access from anywhere (0.0.0.0/0)**.
Render and GitHub runners don't have fixed IPs.

## 2. GitHub Actions (background jobs)
1. In your fork: **Actions** tab → "I understand my workflows, go ahead and enable them".
2. **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `SERVER_ENV`
   - Value: the whole contents of your `server/.env` (MONGO_URI, GROQ_API_KEY, other API keys…)
3. **Actions → Background jobs → Run workflow → task: bootstrap** to fill the database
   the first time. After that it runs on its own schedule.

GitHub pauses scheduled workflows in repos with no commits for 60 days; re-enable it
from the Actions tab or push any commit.

## 3. Render (API)
1. Sign up at render.com with GitHub (no card needed).
2. **New → Blueprint** → pick your fork → it reads `render.yaml`.
   (Or **New → Web Service**: root directory `server`, build/start commands and
   env vars copied from `render.yaml`, instance type Free.)
3. Fill in `MONGO_URI` and one of `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY`.
   Optional job-source keys (RAPID_API_KEY, ADZUNA_*) can be added too; search uses them for live results.
4. Deploy. Your API URL is `https://job-map-india-api.onrender.com` (or similar).

Free services sleep after 15 min idle; the first request after that takes ~1 minute.

## Test
```
curl -X POST https://YOUR-SERVICE.onrender.com/api/session \
  -H 'Content-Type: application/json' -d '{"sessionId":"test"}'
```
Put the URL into the Android app's **Server** setting.
