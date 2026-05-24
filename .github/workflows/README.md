# Workflows

- **`deploy.yml`** runs on pushes to `main`. Builds the Vite app and
  publishes `dist/` to GitHub Pages.
- **`ingest-new-episodes.yml`** is **disabled**: schedule trigger
  removed because YouTube downgrades the runner IP to a stripped player
  that returns only storyboard images, even with valid signed-in
  cookies. The file stays in place (manual dispatch only) so it's easy
  to re-enable if YouTube ever relaxes. Day-to-day ingestion runs
  locally via `scripts/ingest/auto-ingest.sh`, see the top-level
  README's Automation section.

Flow: local `auto-ingest.sh` ingests + commits + pushes; push fires
`deploy.yml`, which builds and publishes.

## One-time setup

### 1. Repository secrets

Add these in `Settings → Secrets and variables → Actions → New repository secret`:

- `YOUTUBE_API_KEY` (YouTube Data API v3 key). Used by `fetch:channel` to
  list videos on the DOAC channel.
- `ANTHROPIC_API_KEY`. Used by the Claude calls in `scripts/ingest/lib/ai.mjs`.
- `BRAVE_API_KEY`. Used by the bio enrichment step for guests without a
  Wikipedia match.
- `YT_COOKIES` (optional, but effectively required in practice). YouTube
  blocks unauthenticated `yt-dlp` requests from GitHub's runner IPs with
  a "confirm you're not a bot" challenge, which causes ingest to fail
  with `ERROR: [youtube] <id>: Sign in to confirm you're not a bot`.
  Pass cookies from a signed-in browser session to make the requests
  look authentic:
  ```sh
  # On a machine signed into YouTube in Firefox (or Chrome/Safari)
  yt-dlp --cookies-from-browser firefox --cookies cookies.txt \
    --skip-download 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  pbcopy < cookies.txt   # paste this into the YT_COOKIES secret
  ```
  The workflow writes it to a runner-temp file (outside
  `$GITHUB_WORKSPACE`, so it can't end up in the PR) and sets
  `YT_COOKIES_FILE` for the ingest scripts. Cookies expire every few
  weeks; if ingest starts failing again with the bot challenge, refresh.

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
