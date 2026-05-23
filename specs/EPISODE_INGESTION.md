# Episode Ingestion Workflow

The end-to-end process for taking a YouTube video ID and producing a committed
episode entry with portrait, structured transcript, and verified guest data.

> When this process changes (new step, different tool, swapped data source),
> update this doc in the same commit. The brief and this spec are the durable
> record — chat history is not.

## Prerequisites

- Node LTS (`.nvmrc` pins it; `nvm use` picks it up)
- Python 3 with `.venv` set up:
  `python3 -m venv .venv && .venv/bin/pip install opencv-python mediapipe==0.10.18 face_recognition "setuptools<81"`.
  Notes on pins: mediapipe 0.10.20+ removed the legacy `mp.solutions` API the
  script uses; setuptools 81+ removed `pkg_resources`, which
  `face_recognition_models` still imports.
- `yt-dlp` and `ffmpeg` installed (brew on macOS)
- `YOUTUBE_API_KEY` in `.env` (Google Cloud Console → YouTube Data API v3)
- The full channel metadata in `data/_youtube-raw.json` (regenerate via `npm run fetch:channel`)

## Stage 1 — Pick the episode

Open `data/_youtube-raw.json`, find the target video. Note its `id` (YouTube
video ID, 11 chars). All subsequent steps key off this ID.

For a quick "what's next?" suggestion:

```
node scripts/next-candidates.mjs [count=6] [min-minutes=30]
```

Prints the N most recent un-ingested episodes that are at least `min-minutes`
long. The duration filter exists because the DOAC catalog contains both
long-form interviews and YouTube Shorts (~30s clips), and we only care
about the interviews.

For repeatable batches, add the entry (or the bare `{ id, ... }` reference) to
`data/_curated-candidates.json` so the rest of the pipeline can find it.

## Stage 2 — Transcript

```
npm run fetch:transcripts        # yt-dlp pulls captions for every id in _curated-candidates.json
npm run extract:transcripts      # VTT → structured JSON with cue-level timing
```

Outputs:

- `data/_transcripts/{videoId}.vtt` — raw VTT (kept for re-extraction)
- `data/_transcripts/{videoId}.json` — `[{ start, end, text }, ...]`, ~50–150KB per episode

The YouTube Data API's `captions` endpoint requires channel-owner OAuth and is
not usable for us; `yt-dlp` scrapes the publicly visible auto-captions. Pin
yt-dlp's version — YouTube changes occasionally break it.

## Stage 3 — Guest data

For each guest the episode introduces (or that we don't have in
`data/guests.json` yet):

1. **Find the canonical Wikipedia URL.** Usually `en.wikipedia.org/wiki/{Name}`
   with disambiguation as needed (e.g., `David_A._Sinclair`).
2. **Pull the summary** to verify name + headline facts:
   ```
   curl https://en.wikipedia.org/api/rest_v1/page/summary/{Article_Name}
   ```
   Returns the canonical title, Wikidata Q-ID, one-paragraph extract.
3. **Pull Wikidata** for structured properties:
   ```
   curl https://www.wikidata.org/wiki/Special:EntityData/{Q-id}.json
   ```
   Relevant claims:
   - `P21` sex/gender
   - `P27` country of citizenship
   - `P69` educated at (Q-IDs of institutions)
   - `P108` employer (Q-IDs)
   - `P106` occupation
   - `P101` field of work
   - `P800` notable work (Q-IDs of books/works)
   - `P569` birth date
4. **Resolve referenced Q-IDs** (institutions, works, etc.) in batch:
   ```
   curl "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q1|Q2|...&props=labels&languages=en&format=json"
   ```
5. **Write the `credibilityLine`** — one short fact-based clause per major
   credential, semicolon-separated. Example:

   > "Harvard professor of genetics; author of Lifespan; founded multiple longevity biotech companies."

   Rules:
   - Neutral, fact-based, no opinions
   - Concrete (institution name, book title) over abstract (role label)
   - Skip credentials that don't bear on the episode's topic
   - Don't include the host or the show

6. **Roles** — pick from the controlled vocabulary in `taxonomies.json` (`academic`,
   `researcher`, `clinician`, `author`, `practitioner`, `public-figure`). Multiple OK.
7. **Credentials array** — degree/position entries with `sourceUrl` (Wikipedia
   or institutional page). `year: null` is allowed for ongoing positions where
   the start year doesn't add signal.
8. **Links** — at minimum `wikipedia`; add `website` (institutional page) when
   it's the authoritative source-of-truth.

## Stage 4 — Episode entry

Write the episode entry in `data/episodes.json`:

- **`id`** — `doac-{youtubeVideoId}` (namespaced for future shows)
- **`episodeNumber`** — DOAC's published episode number when visible in the
  title (older episodes had `| E108` style suffixes); otherwise estimate from
  chronology
- **`title`** — rewritten, topic-explanatory, 3–7 words. NOT the YouTube title.
  Example: "Reversing biological aging." Not "Can Aging Be Reversed?! 75%
  Younger Cells!"
- **`originalTitle`** — exact YouTube title, preserved for SEO/record
- **`slug`** — kebab-case identifier for URLs
- **`date`** — `YYYY-MM-DD` (UTC date from `publishedAt`)
- **`duration`** — seconds (convert from `PT2H29M7S` ISO 8601 format)
- **`guestIds`** — array of guest IDs. Multi-guest panels list all
- **`topics`** — up to 3 from `taxonomies.json`. Single-select on the Browse
  page, so pick the most representative
- **`description`** — 15–25 words. Says what specifically gets *covered*, not
  who the guest is (that's the `credibilityLine`'s job)
- **`links.youtube`** — full watch URL
- **`thumbnail`** — `/portraits/{guestId}.jpg` (will be set later in Stage 5)
- **`promotions`** — items the *guest* is plugging (book, product, course,
  company). Each: `{ type, title, by: 'guest', link }`. Resolve `linkly.link`
  affiliate URLs to canonical destinations
- **`sponsors`** — items the *host* has as paid ads, from the description's
  "Sponsors:" block. Mark `topical: true` for sponsors whose product overlaps
  the episode subject (stated-disclosure signal)
- **`chapters`** — chapter markers from the description's timestamped TOC.
  Each: `{ start: seconds, title }`

### Editorial rules

- **Don't editorialize** — describe what's discussed, never characterize the
  guest or judge the content
- **Rewrite clickbait titles** to be topical headlines. Keep the original in
  `originalTitle`
- **Resolve affiliate links** to canonical destinations (the linkly redirect
  is JS-based; fetch the HTML and pull out the actual target URL)
- **Sponsors are facts** — list what was paid, mark topical overlap, never
  call something an "infomercial"

## Stage 5 — Portrait

```
npm run extract:frames -- {videoId}                          # HTTP-range frame fetch (no video on disk), samples 20 frames
.venv/bin/python scripts/auto-portrait.py \
  data/_frames/{videoId} public/portraits/{guestId}.jpg     # face-detect + 16:9 crop, saves 1x + @2x and top-3 alts
```

The frame-extraction script uses `yt-dlp -g` to resolve the direct 1080p
video stream URL, then runs `ffmpeg -ss <time> -i <stream-url>` for each
sample point. Because `-ss` precedes `-i`, ffmpeg seeks via HTTP byte-range
requests and only pulls the keyframe chunk around each requested time
(~5–10 MB total per episode) rather than the full video (~1–2 GB). No file
ever lands in `data/_videos/`. Re-extraction is cheap — just run the
script again.

The script outputs:

- `public/portraits/{guestId}.jpg` + `@2x.jpg` — default (highest-scoring frame)
- `public/portraits/{guestId}-2.jpg` + `@2x` — second candidate
- `public/portraits/{guestId}-3.jpg` + `@2x` — third candidate
- Each line prints `score`, `face` area %, `ear` (eye aspect ratio),
  `host` distance (face_recognition distance to Bartlett reference), and
  `brightness` (mean grayscale luminance, used for scrim opacity)

### Scoring inputs

- **Face area + centering** — bigger and more centered faces score higher
- **EAR (Eye Aspect Ratio)** via MediaPipe FaceMesh — bonus when eyes are
  open (≥ 0.25), small bonus partial (0.18–0.25), penalty closed (< 0.18).
  Replaces the older Haar eye cascade, which missed partial blinks
- **Host blacklist** — face_recognition encodes each candidate face and
  compares against `data/host-bartlett.jpg`. Distance < 0.50 → -0.30 penalty
  (heavy enough to override any face-size advantage). 0.50–0.60 → -0.10
  penalty. Above 0.60 → no penalty. This eliminates the "host wins" failure
  mode automatically

### Manual verification (still required)

The detector picks the correct *identity* now (host is blacklisted), but
face-size still dominates *among same-identity candidates*. The remaining
failure mode is an unflattering shot of the guest winning — looking down,
mouth open mid-speech, intense glare. **Open the saved `.jpg` and confirm
the expression reads well editorially.**

If the default is wrong:

```
cp public/portraits/{guestId}-2.jpg public/portraits/{guestId}.jpg
cp public/portraits/{guestId}-2@2x.jpg public/portraits/{guestId}@2x.jpg
```

For multi-guest panels (e.g., UFO roundtable), the top candidates often
include both guests. Manually identify each and save under the right name
using the appropriate alt index.

### Update the guest entry

Once the right portrait is in place, add to that guest's entry in `guests.json`:

```json
"portrait": "/portraits/{guestId}.jpg",
"portrait2x": "/portraits/{guestId}@2x.jpg",
"portraitBrightness": 0.231
```

The brightness value comes from the script's output for the chosen candidate.
The UI uses it to compute a target-brightness-uniform scrim opacity per card.

### Clean up

Nothing to clean up — the new extraction pipeline never writes a video
file. Frames in `data/_frames/{videoId}/` (~2–5 MB per episode) are
gitignored but useful to keep around in case you need to re-pick a frame
later. Delete only if disk space matters.

## Stage 6 — Verify and commit

1. Refresh `localhost:3000` and confirm:
   - Card renders with the right portrait, title, description, guest
   - Cluster/subtopic filters narrow the grid correctly
   - Search finds the new entry by guest name and title
2. Commit:
   - `data/episodes.json`, `data/guests.json` (always)
   - `public/portraits/{guestId}.jpg` + `@2x.jpg` (the chosen portrait)
   - `public/portraits/{guestId}-2.jpg` etc. if you want alts in version control;
     otherwise they're gitignored alongside `_*.jpg` patterns
3. Don't commit:
   - `data/_frames/`, `data/_transcripts/` (all under the `data/_*` gitignore)
   - `.env`

## Where things live

| Artifact | Path | Committed? |
|---|---|---|
| Channel metadata dump | `data/_youtube-raw.json` | no |
| Curated candidates list | `data/_curated-candidates.json` | no |
| Raw VTT transcripts | `data/_transcripts/*.vtt` | no |
| Structured transcripts | `data/_transcripts/*.json` | no |
| Frame samples | `data/_frames/{videoId}/` | no |
| Curated guests | `data/guests.json` | **yes** |
| Curated episodes | `data/episodes.json` | **yes** |
| Taxonomies | `data/taxonomies.json` | **yes** |
| Host reference photo | `data/host-bartlett.jpg` | **yes** |
| Portraits (chosen) | `public/portraits/{guestId}.jpg`, `@2x.jpg` | **yes** |
| Portrait alternates | `public/portraits/{guestId}-N.jpg`, `@2x.jpg` | **yes** |

## Known limitations

- **Host is filtered automatically, guest identity is not verified
  positively.** We blacklist Bartlett via a face_recognition embedding of
  `data/host-bartlett.jpg`. By elimination, "not host" = "guest". This works
  because each frame has exactly one face (filtered upstream), and Bartlett
  is the only consistent identity across episodes. For multi-guest panels
  the script can't distinguish guest A from guest B — manual identification
  is still required there.
- **Face-size still dominates expression quality.** Even with EAR and host
  blacklist, the highest face-area frame wins — which is often an
  unflattering shot (looking down, mid-speech, glare). Top-3 output gives
  fallback options without re-extracting.
- **EAR can be fooled by head pose.** A face looking down has spread-apart
  eye corners (high horizontal distance) even when the eyelids are nearly
  closed, inflating the ratio. Future: incorporate head-pose estimation.
- **Affiliate URL resolution requires HTML parsing** for `linkly.link`-style
  JS-redirect services. Easy with curl + regex; brittle to changes.
