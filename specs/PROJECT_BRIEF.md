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

## Scope

**DOAC only.** Single show, deep treatment. Resisting the temptation to generalize to other podcasts. If the project succeeds and there's energy to expand later, the data model supports it — but the v1 ships scoped.

**Two pages, no episode detail pages:**

1. **Browse** — filterable episode grid, cards link directly to YouTube/Spotify. Also serves shareable-list URLs as a filtered view.
2. **Guest** — lean top section (name, role, credentials with sources), followed by their list of appearances rendered as the same cards.

No episode detail pages. If info doesn't fit on the card, it doesn't belong on the site. Users want to find the episode and click out to watch it, not read about it.

## Signals

All signals must be visible on the episode card itself — users decide whether to watch from the listing page, not by clicking into a guest. If a card gets too dense, hover/tap reveals additional detail rather than hiding the signal entirely.

### Credibility (guest-level)

The card answers one question: *is this person credible on the topic they're discussing?* It does **not** try to communicate their full résumé.

A row of icons indicating what credentials the guest has. Multiple can apply.

- 🎓 Academic — terminal degree (PhD, MD, etc.) from a recognized institution, relevant field
- 🔬 Researcher — currently publishes peer-reviewed work
- 🩺 Clinician — actively practicing in a regulated profession
- 📚 Author — has written books on the topic (neutral signal)
- 🏢 Practitioner — works in industry/business in the field
- 🎤 Public figure — known primarily for media/commentary

Role indicators appear directly on the episode card. Whether they render as icons, text labels, or a combination is a design decision — six icons may be hard to distinguish at a glance, and text may read more clearly. Hover may surface a one-line summary (e.g., "PhD Neuroscience, Stanford") but **not** the full credential list — full credentials with source links live on the guest page.

The absence of credentials is itself the signal. Don't say "fake doctor" — let the empty badge row speak for itself.

### Promotion (episode-level)

Answers the user's underlying question: *why is this guest on the show right now?* Press tour, product launch, or genuine education.

Three states, visually distinct:

- 📢 **Featuring** — guest is actively promoting something (book, product, company)
- ⚠️ **Disclosure** — host has a financial relationship with what's being discussed
- (none) — non-promotional episode

**Featuring** is the more common signal — extractable from the YouTube video description (sponsors block) and the transcript (guest plugging their book, etc.).

**Disclosure** splits in two:

- *Stated* — host explicitly mentions a financial relationship on-air. Extractable from the transcript via the same pipeline.
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

Each card displays, at minimum:

- Portrait (one per guest, reused across appearances)
- Episode title
- Guest name(s)
- Role indicators (binary credibility signal — icons, text, or both, TBD in design; detail lives on guest page)
- Promotion badge (Featuring / Disclosure / none)
- Appearance count (1st, 2nd, ...) — color-coded
- Topic tags (up to 3)
- Date
- Duration

Card links directly to YouTube/Spotify. No episode detail page.

## Guest page

A lean profile reused as the canonical entry for any guest. Two zones:

**Header** — the same identity fields as the card (name, role label, role indicators), plus the full credentials list from `guests.json`: degree, field, institution, year, source URL. This is the one place that detail is exposed. Keep it terse — a credentials table with links, not a bio.

**Appearances** — a chronological list of every episode the guest has been on, rendered with the same episode card component used on Browse. Same density, same signals, same click behavior.

No long-form bio. No "Notable positions" (still in Open Questions). Credentials are the bio.

## Shareable lists

Deferred from the initial MVP — added as a pre-launch feature (see Build Sequence). Not blocking the first ship.

A user assembles a small set of episodes ("here are the three you should start with") and gets a URL that loads exactly those episodes for the recipient. This is the project's core insight extended into user-land: human curation is what's missing from algorithmic discovery. The site provides the mechanism; the user provides the opinion.

**Mechanism.** URL encodes episode IDs directly, e.g., `/?list=doac-342,doac-289,doac-156`. When the page loads with a list parameter, the catalog is filtered to exactly those episodes. Fully static — no backend, no auth, no persistence required.

**User flow (rough — design open):**
- Add/remove episodes to a working list from any card on Browse
- A persistent panel or button surfaces the current list as it's built
- "Copy link" generates the shareable URL
- Recipient opens the link → sees those episodes in card form, can click through to watch

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
  "id": "doac-342",
  "title": "...",
  "slug": "andrew-huberman-dopamine",
  "date": "2024-03-15",
  "duration": 9240,
  "guestIds": ["andrew-huberman"],
  "topics": ["focus", "sleep"],
  "description": "Rewritten one-line description, honest and useful.",
  "links": {
    "youtube": "...",
    "spotify": "...",
    "apple": "..."
  },
  "thumbnail": "/portraits/andrew-huberman.webp",
  "promotions": [
    {
      "type": "book",
      "title": "...",
      "by": "guest",
      "link": "..."
    }
  ]
}
```

### Schema rules

- **Namespaced IDs** (`doac-342`, not `342`) — preserves the option to add other shows later without rewriting
- **Guest IDs are kebab-case names** — readable URLs (`/guests/andrew-huberman`)
- **One portrait per guest**, reused across all their episodes (visual consistency, makes the grid feel coherent)
- **Controlled vocabularies for fields, roles, topics, promotion types** — defined in `taxonomies.json` so the LLM can't invent variants
- **`sourceUrl` on credentials** — keeps the site honest, gives users a way to verify

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
6. Extract candidate portrait frames (ffmpeg → face detection → top 10 candidates)

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
