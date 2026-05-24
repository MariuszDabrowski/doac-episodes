# Project Brief

A discovery tool for The Diary of a CEO podcast. The goal is to help people find episodes worth their time without scrolling through clickbait YouTube thumbnails.

## North Star

**Don't waste people's time.**

Every decision is tested against this. The site exists to route users to the right episode quickly, then get out of the way. Success looks like: a user lands on the site, finds an episode worth watching, and leaves — in under 60 seconds.

This means:
- Speed is a feature. Fast loads, instant filter response, no layout shifts.
- Density beats decoration. More episodes visible at once, less whitespace theater.
- Default to "no" on features. Anything that doesn't help users find their episode is noise.
- No newsletter signups, share buttons, "related content" attention traps.
- The site is infrastructure, not a destination.

## What This Is

A filterable catalog of DOAC episodes with structured information about each guest, designed to surface the things conventional podcast catalogs hide:

1. **Is this a real expert?** — credibility signals based on credentials, not opinions
2. **Are they selling something?** — factual promotion disclosure
3. **What's it actually about?** — topic-based browsing instead of clickbait titles
4. **Have they been on before?** — appearance count, so recurring guests and first-timers are both legible

## Editorial Stance

**Neutral, fact-based, no opinions baked in.** The filters do the editorial work. By choosing what to surface (credentials, promotions, topics) and how to organize it, the site has a clear point of view without ever editorializing on specific guests or episodes.

- Don't label guests "fake doctors" — just show what credentials exist (or don't)
- Don't call episodes "infomercials" — just list what's being promoted and by whom
- Don't write op-eds — write clean one-line descriptions that respect the reader
- Link to sources for credentials so users can verify
- **Rewrite episode titles to be topic-explanatory, not clickbait.** YouTube titles often hide the actual subject behind a curiosity gap ("You've Been Lied To About...!"). Our title says what the episode is actually about. The original YouTube title is preserved as `originalTitle` for record/SEO.
- **Resolve affiliate redirects to canonical destinations.** DOAC routes external links through `linkly.link` tracking redirects; we show the actual destination URL.

## Scope

**DOAC only.** Single show, deep treatment. Resisting the temptation to generalize to other podcasts. If the project succeeds and there's energy to expand later, the data model supports it — but the v1 ships scoped.

**Two pages, no episode detail pages:**

1. **Browse** — filterable episode grid, cards link directly to YouTube/Spotify. Also serves shareable-list URLs as a filtered view.
2. **Guest** — lean top section (name, role, credentials with sources), followed by their list of appearances rendered as the same cards.

No episode detail pages. If info doesn't fit on the card, it doesn't belong on the site. Users want to find the episode and click out to watch it, not read about it.

## Signals

All signals must be visible on the episode card itself — users decide whether to watch from the listing page, not by clicking into a guest. If a card gets too dense, hover/tap reveals additional detail rather than hiding the signal entirely.

### Credibility (guest-level)

The card answers one question: *is this person credible on the topic they're discussing?*

Instead of abstract role indicators (Academic + Researcher + Practitioner...), the card shows a **curated one-line credibility summary** (`guest.credibilityLine`) that states the relevant facts in plain English. Example: *"Harvard professor of genetics; author of Lifespan; founded multiple longevity biotech companies."*

This shifts the work from the user (decoding role taxonomy) to the editor (writing one good line of facts). Neutral, fact-based — just what they've done.

**Role taxonomy is preserved in the data** (`guest.roles[]`):

- `academic` — terminal degree (PhD, MD, etc.) from a recognized institution in a relevant field
- `researcher` — currently publishes peer-reviewed work
- `clinician` — actively practicing in a regulated profession
- `author` — has written books on the topic (neutral signal)
- `practitioner` — works in industry/business in the field
- `public-figure` — known primarily for media/commentary

Roles power filtering on the Browse page (e.g., "show only academic guests") and feed the guest page header where full credentials with source links live. They're scaffolding, not card surface.

The absence of strong credibility is itself the signal — the line just states what they're actually known for ("Businesswoman; former senior advisor at the White House.").

### Promotion (episode-level)

Answers the user's underlying question: *why is this guest on the show right now?* Press tour, product launch, or genuine education.

Three states, visually distinct:

- 📢 **Featuring** — guest is actively promoting something (book, product, company)
- ⚠️ **Disclosure** — host has a financial relationship with what's being discussed
- (none) — non-promotional episode

Distinguishing three things that are easy to conflate:

- **Featuring** (internal taxonomy term; UI label is **"Promoting"**) — *guest* is actively promoting something. In `episodes.promotions[]` with `by: 'guest'`. The card surfaces a *type-level summary* with hover detail — e.g., "Promoting a book and a company", where "a book" and "a company" carry dotted underlines and reveal the specific titles on hover. Keeps the surface terse; specifics on demand.
- **Sponsors** — *host* has paid advertisers (read-out ads). In `episodes.sponsors[]` with a `topical: true/false` flag. Each sponsor is factual; the flag indicates whether the sponsor's product is directly related to what the episode discusses (e.g., Ketone-IQ sponsoring an episode about ketones).
- **Disclosure** — see below.

**Featuring** is extractable from the YouTube video description and the transcript (guest plugging their book, etc.).

**Sponsors** are typically declared in the description footer ("Sponsors:" block). The `topical` flag is judgment — usually obvious from comparing the sponsor's product to the episode topic.

**Disclosure** splits in two:

- *Stated* — host explicitly mentions a financial relationship on-air, **or** a topical sponsor overlaps with the episode subject (the `sponsors[].topical: true` case). Extractable from the transcript and the description's sponsor block.
- *Unstated* — host has investments in the guest's company or product but doesn't say so. Sourcing it requires a hand-maintained list of the host's known business interests (Flight Fund holdings, Companies House, press) cross-referenced against each episode. **Deferred to v2** — high editorial value, but also high maintenance burden and the highest legal/reputational stakes (publicly asserting a specific person has a specific financial interest). v1 ships with stated disclosures only.

### Appearance count (episode-level, derived from guest data)

For each episode, show which numbered appearance this is for the guest: "1st appearance", "2nd appearance", etc. Color-coded so recurring guests stand out more visibly as the count grows. First-appearance episodes are also worth marking — they signal a new voice for the show.

Derived at build time from `guestIds` across `episodes.json` — no schema change needed.

### Topics (episode-level)

12-20 controlled-vocabulary topic tags. Hierarchical clusters:

- Health & Body → Sleep, Nutrition, Longevity, Mental Health, Fitness, Hormones
- Mind → Psychology, Productivity, Focus, Addiction, Trauma
- Business → Founders, Leadership, Marketing, Investing
- Relationships → Dating, Marriage, Parenting
- Society → Politics, Media, Culture

Episodes have up to 3 topic tags. Topics are the primary browse axis — see Browse page below.

## Browse page

The main entry point. A pill cloud of topic tags acts as the primary filter, with each pill showing the count of episodes it contains.

**Single-select topic.** The user picks one topic at a time. Combining topics adds UI weight for marginal benefit — a single well-chosen topic already narrows the catalog substantially; further refinement comes from the secondary filters below.

**Secondary toggle filters** layer on top of the selected topic. They map to the same signals shown on the card, so users can refine along the same dimensions they're reading:

- **Credibility** — e.g., "credentialed only", or filter by specific role (Academic, Researcher, Clinician, ...)
- **Promotion** — e.g., "hide promotional episodes"
- **Appearance** — e.g., "first appearances only" or "recurring guests only"

**Pill counts stay stable.** Topic counts in the cloud always reflect the full catalog — secondary filters do not re-compute them. Instead, a plain-language summary above the result list communicates the active query and result count, e.g.:

> *Showing 62 episodes on Sleep with a credentialed guest.*

The Sleep pill still reads 68; the summary tells the user why they're seeing 62. This keeps the cloud visually stable as the user toggles filters on and off.

**Default sort.** Reverse-chronological by release date — most recent first. No other sort options for v1.

Fuzzy search (Fuse.js) sits alongside the cloud for direct guest/episode lookup, but the cloud is the primary entry.

### Card anatomy

The card layout (as of the first prototype):

**Top row** — two columns side by side:
- Left: 16:9 thumbnail (the YouTube click target)
- Right: metadata list — date, appearance order, topic tags. Plain label/value pairs, no chips overlaid on the image.

Overlays-on-image were tried first but moved out — putting metadata in a sibling column reads cleaner, doesn't fight the eventual portrait photo, and gives the topic tags room to breathe.

Duration was dropped from the card surface — if the user is interested they'll watch either way. Value stays in `episode.duration` for downstream features.

**Middle block** — title + description (no padding break from top row, just inset on bottom):

**Content block** — title + description, each doing a distinct job:
- **Title** — short topical headline, 3-7 words. Says what the episode is *about*. (E.g., "Reversing biological aging.")
- **Description** — 15-25 words. Says what specifically gets *covered*. (E.g., "Sinclair on his lab's gene-therapy trials, his daily supplement stack, and why fasting and 'good stress' extend life.")

The YouTube original title (`originalTitle`) stays in the data for SEO / record but isn't shown — it's typically too clickbait to surface.

**Guest block** — visually separated from the episode content above (light gray background + top border). This signals "now we're talking about the person, not the episode."
- **Guest name**
- **`credibilityLine`** — concrete facts about the guest, plain English.
- **"Promoting …" line** — type-level summary with hover detail. E.g., "Promoting a book and a company" where *a book* and *a company* have dotted underlines; hovering reveals the specific titles as clickable links. Keeps the surface tidy; specifics (and outbound links) on demand.

**Multi-guest collapse.** Roundtables/panels show only the first guest by default with a "+N more guests" pill that expands the rest in place via a grid-template-rows slide (no `height` animation — the sibling card in the row follows along naturally). Keeps card heights uniform for the common single-guest case; the extra guests are one click away when needed. Appearance count renders per-guest (each guest gets their own ordinal pill once expanded).

**Row dividers.** Between rows in the grid: a faint 1px dotted line (~12% ivory) sits in the gap. Per-card, so it visually respects the column gap. Marks rhythm without adding ink.

Card links directly to YouTube/Spotify. No episode detail page.

### Motion stance

- **Filter/category changes**: the grid and result-summary swap atomically via `<Transition mode="out-in">` keyed by the filter state. Cards inside fade + slide-up with a staggered enter (CSS animation triggered on mount). No FLIP-style "diagonal move" between filter states — that read as physical motion of the same card, which isn't true.
- **Subtopic pills**: same atomic-swap pattern, with each pill pivoting from its left edge on enter (left-hinged drop-in from above) and from its right edge on leave (right-hinged drop-out below). Staggered by index.
- **Result summary**: bolded keywords (count, cluster, subtopic, query) shift to the bright ivory; connecting words stay muted. Pivots from its left edge on enter/leave, mirrors the pill rhythm.
- **No scroll-tied animation.** We tried edge-fade and FLIP-style entry — both caused motion-sickness reports for sensitive users. Static once placed, animated only on user input.
- **Background gradient** is anchored to the viewport via `background-attachment: fixed` so it stays consistent regardless of how many cards the current filter renders.

## Guest page

A lean profile reused as the canonical entry for any guest. Two zones:

**Header** — the same identity fields as the card (name, role label, role indicators), plus the full credentials list from `guests.json`: degree, field, institution, year, source URL. This is the one place that detail is exposed. Keep it terse — a credentials table with links, not a bio.

**Appearances** — a chronological list of every episode the guest has been on, rendered with the same episode card component used on Browse. Same density, same signals, same click behavior.

No long-form bio. No "Notable positions" (still in Open Questions). Credentials are the bio.

## Shareable lists

Deferred from the initial MVP — added as a pre-launch feature (see Build Sequence). Not blocking the first ship.

A user assembles a small set of episodes ("here are the three you should start with") and gets a URL that loads exactly those episodes for the recipient. This is the project's core insight extended into user-land: human curation is what's missing from algorithmic discovery. The site provides the mechanism; the user provides the opinion.

**Mechanism.** URL encodes episode IDs directly, optionally with a chapter index, e.g., `/?list=doac-342,doac-289:7,doac-156`. When the page loads with a list parameter, the catalog is filtered to exactly those entries. Fully static — no backend, no auth, no persistence required.

**Chapter-level entries.** Because episodes carry `chapters[]`, a list entry can target a specific chapter rather than the whole episode (`doac-289:7` = chapter index 7 of `doac-289`). Recipients land on a card that deep-links into the YouTube video at the chapter's start timestamp. This turns curation from "watch these 3 episodes" into "watch these 5 specific moments" — a tighter recommendation.

**User flow (rough — design open):**
- Add/remove episodes (or specific chapters) to a working list from any card on Browse
- A persistent panel or button surfaces the current list as it's built
- "Copy link" generates the shareable URL
- Recipient opens the link → sees those entries in card form, can click through to watch (with chapter deep-link when applicable)

**Distinguishing from share buttons.** Share buttons (still excluded) attach to a single page and post to a social platform — attention-trap territory. Shareable lists are a curation mechanism that produces a personal recommendation. Different intent, different UX, different fit with the north star.

## Stack

- **Framework:** Nuxt 3 (static site generation via `nuxt generate`)
- **Data:** JSON files in repo (`episodes.json`, `guests.json`, `taxonomies.json`)
- **Search/filter:** client-side, Fuse.js for fuzzy search
- **Styling:** Tailwind
- **Hosting:** GitHub Pages with custom domain
- **Automation:** GitHub Actions for new episode detection + LLM enrichment

Static generation chosen for SEO (guest pages need to be indexable) and link previews (every shared episode link should have a proper card).

## Data Model

Guests and episodes are separate entities joined by ID. Keep all guest data in one place — never nest it under episodes.

```json
// guests.json
{
  "id": "andrew-huberman",
  "name": "Andrew Huberman",
  "fields": ["neuroscience", "health"],
  "roles": ["academic", "researcher"],
  "credentials": [
    {
      "type": "PhD",
      "field": "Neuroscience",
      "institution": "UC Davis",
      "year": 2004,
      "sourceUrl": "..."
    }
  ],
  "currentRole": "Professor of Neurobiology, Stanford",
  "links": {
    "website": "...",
    "wikipedia": "..."
  }
}

// episodes.json
{
  "id": "doac-DnvWAP99r3Y",
  "episodeNumber": 540,
  "episodeNumberSource": "estimate",
  "title": "Rewritten topic-explanatory title.",
  "originalTitle": "Exact YouTube title, preserved for record/SEO.",
  "slug": "david-sinclair-aging-reversal",
  "date": "2026-03-23",
  "duration": 8947,
  "guestIds": ["david-sinclair"],
  "topics": ["longevity", "nutrition"],
  "description": "Rewritten one-line description, honest and useful.",
  "links": {
    "youtube": "...",
    "spotify": "...",
    "apple": "..."
  },
  "thumbnail": "/portraits/david-sinclair.webp",
  "promotions": [
    { "type": "book", "title": "...", "by": "guest", "link": "canonical URL, not affiliate redirect" }
  ],
  "sponsors": [
    { "name": "Ketone-IQ", "url": "...", "topical": true }
  ],
  "chapters": [
    { "start": 0, "title": "Intro" },
    { "start": 214, "title": "..." }
  ]
}
```

### Schema rules

- **Namespaced IDs** (`doac-{youtubeVideoId}`) — preserves the option to add other shows later without rewriting; YouTube IDs are globally unique on YouTube so collisions are impossible
- **Guest IDs are kebab-case names** — readable URLs (`/guests/andrew-huberman`)
- **Per-episode portrait when available**, with the guest's canonical portrait as a fallback. Episode-specific shots prevent repetition for recurring guests — Mo Gawdat's 2021 and 2024 appearances show different frames from different studios. The card reads `episode.thumbnail` if set; otherwise falls back to `guest.portrait`
- **Controlled vocabularies for fields, roles, topics, promotion types** — defined in `taxonomies.json` so the LLM can't invent variants
- **`sourceUrl` on credentials** — keeps the site honest, gives users a way to verify. Typically Wikipedia or the institutional source-of-truth page, whichever is more authoritative for that specific credential.
- **`year: null` allowed on credentials** for ongoing positions where the start year isn't a strong signal (e.g., current professorship).
- **Sponsors are separate from promotions.** `promotions[]` carries guest-side activity (Featuring); `sponsors[]` carries host-side paid ads, with `topical` indicating whether the sponsor's product overlaps with episode subject matter.
- **`episodeNumberSource` tracks provenance** — `'title-parse'` when the number came directly from `| E###` in the YouTube title (canonical, never overwrite), or `'estimate'` when derived via nearest-anchor offset interpolation (safe to overwrite if a better source emerges later). See `EPISODE_INGESTION.md` for the algorithm and the `npm run renumber` command for batch recompute.

## Build Sequence

Resist building automation before the manual version exists. Order:

1. **Hand-curate 10 episodes.** Mixed bag — scientist, founder, celebrity, recurring guest, episode with heavy promotion. Real data drives schema decisions.
2. **Settle the schema** against that real data.
3. **Mood boards** — collect 15-20 visual references across categories, not just podcast sites.
4. **Design two key screens** — episode card + guest page. Real type, real spacing, real data. The rest of the site flows from these.
5. **Build Nuxt MVP** with the manual data. Ship it.
6. **Automation layer** — GitHub Action that detects new episodes, opens PRs with draft enrichment data for human review.
7. **Backfill** the rest of the catalog using the enrichment pipeline.
8. **Shareable lists** — add the curation/share-link feature once the catalog is real.
9. **Polish.**

## Automation Architecture

**Detection:** GitHub Action on a 6-hour cron checks YouTube Data API for new episodes from the DOAC channel. Dedupes against existing `episodes.json` by video ID.

**Enrichment (per new episode):**
1. Pull transcript via `yt-dlp` (the YouTube Data API's captions endpoint requires channel-owner OAuth, so it's not viable for us — yt-dlp scrapes the publicly visible captions without auth). Pin the yt-dlp version; YouTube changes occasionally break it. Raw VTT is then extracted to structured JSON with cue-level timing — `[{ start, end, text }, ...]` — stripping word-level timing noise and overlapping cue dedupe. Preserving cue timing keeps the door open to deep-linking into specific moments later without re-pulling.
2. Extract guest name(s) — LLM pass with structured output
3. Match against existing `guests.json`; if new guest, generate profile (LLM + web search)
4. Assign topic tags from controlled vocabulary
5. Detect promotions: extract sponsors from description, guest plugs from transcript, flag stated host disclosures from transcript (unstated disclosures = v2)
6. Extract candidate portrait frames: download only a middle slice of the video (`yt-dlp --download-sections "*00:05:00-00:45:00"`) → sample 20 frames with `ffmpeg` → OpenCV face detection + eye detection (bonus for eyes-open frames, penalty for blinks) → top 3 candidates per-episode for manual identity verification. See `specs/EPISODE_INGESTION.md` for the full workflow.

**Review:** Action opens a PR with draft additions. Human reviews diff, picks portrait from candidates, merges. Merge triggers redeploy.

**Models:**
- Sonnet for bulk extraction (transcripts, topic tagging, promotion detection)
- Opus for judgment-heavy tasks (guest bios, QA flagging)
- All API keys in GitHub Actions secrets, never in code

**Cost:** ~$0.05-0.15 per episode enriched. Backfill of full catalog under $50.

## Things Deliberately Left Out

- Episode detail pages (info fits on cards or doesn't belong)
- Long-form guest bios (credentials are the bio)
- Star ratings / scores (editorializing)
- User reviews / comments (moderation burden, not the project)
- "Trending" / popularity (reinforces clickbait, undermines editorial point)
- Recommendations / "you might also like" (attention trap)
- AI-generated episode summaries (lazy; your one-liners do it better)
- Newsletter signup, social-platform share buttons, social embeds (shareable lists are a separate mechanism — see above)
- Cross-show coverage (scope creep — DOAC only for v1)

## Open Questions

Things still to decide as the build progresses:

- Final product name and domain (working repo name is fine for now)
- Exact portrait crop dimensions and styling
- Whether to expose timestamps in the UI as a feature (deep links to specific moments) — v2 territory. Cue-level timing is already preserved in the cached transcripts, so the feature is unblocked at the data layer.
- How aggressively to surface promotion patterns on guest pages
- Whether the "Notable positions/claims" feature on guest pages is worth the controversy it invites

## Notes

- Keep a separate `NOTES.md` for build decisions, things tried and rejected, ideas for later
- Keep a `design-questions.md` for questions that come up during data curation — these are the real design brief
- Check DOAC terms and YouTube API ToS before scaling automation
- Custom domain from day one — $12/year, future-proofs everything
- Footer disclosure: "A fan-built guide. Not affiliated with The Diary of a CEO."
