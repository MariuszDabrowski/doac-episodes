# Review page

Local-only editorial triage tool at `/review`. Surfaces every episode's
portrait + editable title / description / primary-guest bio, with a
"mark good" approval state per episode so triage can be resumed across
sessions.

The frontend is the same Vite SPA that serves `/`, but the page only
functions when the dev API server is running. The deployed site at `/`
is static, there is no `/review` in production by design (it needs
filesystem write access to `data/` and `public/`, which a static host
can't provide).

## What's reviewed

Per row:

- **Portrait**, current cropped thumbnail. Buttons to generate top-5
  alts (re-runs `scripts/portraits/auto-portrait.py` with `top-n=5`)
  and to swap any of them in as the primary. Re-extract pulls 50 fresh
  frames when the existing 20 are host-dominated.
- **Title**, episode title. Inline text input, saves on blur to
  `data/episodes.json`.
- **Description**, 1-2 sentence editorial summary. Inline textarea,
  saves on blur to `data/episodes.json`.
- **Primary guest bio** (`credibilityLine`), inline textarea, saves
  on blur to `data/guests.json`. A hint underneath shows
  `applies to N appearances` because the bio is keyed on the guest,
  not the episode, editing it updates every card that guest appears
  on. The local state of all matching rows is updated immediately so
  the UI doesn't drift from the server.

The whole row gets one approval status (`good` / `pending`), persisted
to `data/_portrait-review.json` (gitignored). Filter chips at the top
restrict the list to one status.

## API

All routes under `/api/review/*`, served by `server/index.mjs` on port
3001. Vite proxies `/api/*` to this server in dev.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/episodes` | (none) | List with editorial fields + `primaryGuest.appearanceCount` |
| POST | `/edit-episode` | `{ id, title?, description? }` | Patches `data/episodes.json` |
| POST | `/edit-guest` | `{ id, credibilityLine? }` | Patches `data/guests.json` |
| POST | `/approve` | `{ id, status: 'good' \| 'pending' }` | Patches `data/_portrait-review.json` |
| POST | `/alts` | `{ videoId }` | Runs `auto-portrait.py top-n=5` into `public/_review-picks/{vid}/` |
| POST | `/swap` | `{ videoId, pick }` | Promotes pick 1-5 to the primary portrait |
| POST | `/reextract` | `{ videoId, count? }` | Wipes `data/_frames/{vid}/`, re-extracts (default 50) |

## Persistence

| Path | Contents | Tracked? |
| --- | --- | --- |
| `data/episodes.json` | Episode catalog | Yes |
| `data/guests.json` | Guest catalog | Yes |
| `data/_portrait-review.json` | `{ episodeId: 'good' }` | No (gitignored `data/_*`) |
| `public/_review-picks/{vid}/` | Alt portrait candidates | No (gitignored) |
| `public/portraits/doac-{vid}.{jpg,webp,avif}` | Promoted portrait files | Yes |

Edits are non-atomic (read → mutate → write the whole file). Open the
page in one tab at a time.

## Known gaps / future ideas

- Only the primary guest's bio is editable in the UI. For multi-guest
  panels the secondary bios live in `guests.json` but aren't surfaced.
- No "regenerate with Claude" button for any of the fields. The
  ingestion pipeline (`scripts/ingest/ingest-episode.mjs`) already
  drafts titles/descriptions/bios, so plugging the same prompts into a
  per-field regenerate button is the natural next step.
- No undo. Edits overwrite immediately.
- Approval status is a single flag per episode (`good`/`pending`). If
  splitting between "portrait good" vs "editorial good" becomes
  useful, the field can become an object.

## Out of scope

- Production deployability. The dev server intentionally needs
  filesystem write access; gating those writes behind auth so it could
  run on a public host is more complexity than the tool is worth.
- Hosting the staging alt portraits under `public/`. They're served
  from there only because Vite's static serving makes the URLs
  trivial, a real review server would isolate them.
