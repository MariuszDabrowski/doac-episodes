# Workflows

Two GitHub Actions workflows automate the site:

- **`ingest-new-episodes.yml`** runs on a 6-hour schedule (and on manual
  dispatch). It refreshes the YouTube catalog, ingests any new long-form
  episodes (≥30 min) through the full pipeline, and opens a draft PR
  with the resulting `data/*.json` + portrait file changes.
- **`deploy.yml`** runs on pushes to `main`. It builds the Vite app and
  publishes `dist/` to GitHub Pages.

The flow: schedule fires, ingest opens a draft PR, reviewer (you) checks
the new portraits + titles + descriptions, merges. Merge fires deploy.

## One-time setup

### 1. Repository secrets

Add these in `Settings → Secrets and variables → Actions → New repository secret`:

- `YOUTUBE_API_KEY` (YouTube Data API v3 key). Used by `fetch:channel` to
  list videos on the DOAC channel.
- `ANTHROPIC_API_KEY`. Used by the Claude calls in `scripts/ingest/lib/ai.mjs`.
- `BRAVE_API_KEY`. Used by the bio enrichment step for guests without a
  Wikipedia match.

### 2. GitHub Pages

`Settings → Pages → Build and deployment → Source: GitHub Actions`.
The `deploy.yml` workflow uses the official Pages actions
(`actions/configure-pages`, `actions/upload-pages-artifact`,
`actions/deploy-pages`), which handle the rest.

### 3. Allow Actions to open PRs

`Settings → Actions → General → Workflow permissions`:
- ✅ Read and write permissions
- ✅ Allow GitHub Actions to create and approve pull requests

(The first is also granted per-workflow via the `permissions:` block, but
the second is an org-/repo-level toggle that the per-workflow setting
can't override.)

## Reviewing an auto-ingest PR

Most episodes (~95% per spot-check) need no edits — glance at the PR diff
and merge. For the rare exception:

```sh
gh pr checkout <pr-number>
npm run dev
# visit http://localhost:3000/review, filter to Pending
# swap a portrait alt, edit title/description/bio inline (saves on blur)
git commit -am 'review: fix <episode>'
git push
```

The PR auto-updates with the fixed content. Merge → deploy.

## Caches

- Node `node_modules` cache via `actions/setup-node`.
- Python `.venv` cached separately. `face_recognition` compiles `dlib`
  from source on a cold cache, which adds 3–5 min to the run. The cache
  key is bumped (`venv-...-vN`) when the dep list in the workflow
  changes.

## Costs (rough)

- Workflow runs are within GitHub's free tier for personal accounts
  (2000 min/month). A typical ingest run is 5–15 min; deploy ~1 min.
- API: each episode is ~$0.05–0.15 in Claude tokens plus 1–3 Brave
  searches. DOAC publishes ~2 episodes/week, so ~$1–2/month.
