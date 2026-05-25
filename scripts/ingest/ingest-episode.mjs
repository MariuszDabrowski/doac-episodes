#!/usr/bin/env node
/**
 * End-to-end episode ingestion. Takes a YouTube video ID and produces a
 * complete episodes.json entry, any new guests.json entries, and the
 * portrait files under public/portraits/.
 *
 * Usage: node scripts/ingest/ingest-episode.mjs <videoId>
 *
 * Pipeline:
 *   1. Read raw metadata from data/_youtube-raw.json
 *   2. Extract frames + run auto-portrait                    (lib/portrait.mjs)
 *   3. Draft the episode (title/description/topics/...) via Claude (lib/ai.mjs)
 *   4. Resolve each guest:
 *      a. Existing? Reuse.
 *      b. Wikipedia lookup with surname-match guard          (lib/enrichment.mjs)
 *      c. Claude draft using Wiki + YouTube blurb            (lib/ai.mjs)
 *      d. For non-Wikipedia guests, refine via Open Library + Brave bios
 *   5. Copy portrait files under the primary guest's id
 *   6. Append the episode to episodes.json + new guests to guests.json
 *
 * Editorial rules from specs/PROJECT_BRIEF.md are baked into the Claude
 * prompts in lib/ai.mjs so drafts hew to the brief without us reciting
 * them every time.
 */

import { copyFileSync, mkdirSync, appendFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

import { loadJson, saveJson, slugify, durationIsoToSeconds } from './lib/utils.mjs';
import { episodeNumberFor } from './lib/episode-number.mjs';
import { ensurePortrait } from './lib/portrait.mjs';
import { wikipediaLookup } from './lib/enrichment.mjs';
import { draftEpisode, draftGuest, verifyClaudeOnlyGuest } from './lib/ai.mjs';

const VIDEO_ID = process.argv[2];
if (!VIDEO_ID) {
  console.error('Usage: ingest-episode.mjs <videoId>');
  process.exit(1);
}

// --- 1. raw metadata + duplicate guard ------------------------------

const raw = loadJson('data/_youtube-raw.json').find((v) => v.id === VIDEO_ID);
if (!raw) {
  throw new Error(`${VIDEO_ID} not in data/_youtube-raw.json, refresh with npm run fetch:channel?`);
}

const existingEpisodes = loadJson('data/episodes.json');
const guests = loadJson('data/guests.json');
const taxonomies = loadJson('data/taxonomies.json');

if (existingEpisodes.some((ep) => ep.id === `doac-${VIDEO_ID}`)) {
  console.error(`doac-${VIDEO_ID} already in episodes.json. Refusing to overwrite.`);
  process.exit(1);
}

// --- 2-3. portrait + episode draft ----------------------------------

const portrait = await ensurePortrait(VIDEO_ID);
const draft = await draftEpisode(raw, taxonomies.topics);

// Topic post-processing: Haiku occasionally violates the enum constraint
// and emits topics not in the taxonomy. Strip those out and log them as
// gap signals (alongside the explicit suggestedTopicGap field), so we
// still capture editorial intent without polluting the data.
const validTopicIds = new Set(taxonomies.topics.map((t) => t.id));
const invalidTopics = draft.topics.filter((t) => !validTopicIds.has(t));
const candidateSuggestions = [
  ...invalidTopics.map((t) => ({ source: 'hallucinated', value: t })),
  ...(draft.suggestedTopicGap ? [{ source: 'gap-field', value: draft.suggestedTopicGap }] : []),
];
for (const c of candidateSuggestions) {
  appendFileSync(
    'data/_topic-candidates.jsonl',
    JSON.stringify({
      episodeId: `doac-${VIDEO_ID}`,
      title: raw.title,
      picked: draft.topics.filter((t) => validTopicIds.has(t)),
      suggested: c.value,
      source: c.source,
      date: raw.publishedAt.slice(0, 10),
    }) + '\n'
  );
  console.log(`  ↳ topic candidate (${c.source}): "${c.value}"`);
}
draft.topics = draft.topics.filter((t) => validTopicIds.has(t));

// Solo-host episodes: when Claude returns no guests (early DOAC monologues,
// Q&As, anniversary specials, etc.), treat it as a Steven Bartlett solo and
// inject him as the sole guest. The schema/UI already handles this shape
// (see existing E55, E70, E94, E208) — we just need to ensure the
// orchestrator never sees an empty guests array.
if (draft.guests.length === 0) {
  console.log('  ↳ no guests in draft, treating as Steven Bartlett solo episode');
  draft.guests = [{ name: 'Steven Bartlett', slug: 'steven-bartlett' }];
}

// --- 4. resolve guests ----------------------------------------------

console.log(`[4/6] resolving ${draft.guests.length} guest(s)…`);
const guestIdMap = {};
const episodeContext = {
  title: draft.title,
  originalTitle: raw.title,
  topics: draft.topics,
  description: draft.description,
  // The raw YouTube description carries the producer-written guest bio
  // paragraph, useful when Wikipedia comes up empty.
  youtubeDescription: raw.description,
};
for (const g of draft.guests) {
  const existing = guests.find(
    (e) => e.name.toLowerCase() === g.name.toLowerCase() || e.id === g.slug
  );
  if (existing) {
    console.log(`  ${g.name} → existing (${existing.id})`);
    guestIdMap[g.name] = existing.id;
    continue;
  }
  console.log(`  ${g.name} → looking up Wikipedia…`);
  const wiki = await wikipediaLookup(g.name);
  const guestDraft = await draftGuest(g.name, wiki, episodeContext);
  // Claude cross-checks the Wikipedia summary against the episode context;
  // if it rejects the match (similar name, different person), drop the
  // link so we don't cite a wrong article.
  const wikiLinked = wiki && guestDraft.wikipediaUsable !== false ? wiki : null;

  // For Claude-only entries (no usable Wikipedia), run external-evidence
  // verification. Claude does an identity re-check on the fetched bio
  // (common-name guests get matched to the wrong professional, as happened
  // to Rena Malik when a different Rena Malik turned up on Google Scholar).
  let finalDraft = guestDraft;
  let bioLink = null;
  if (!wikiLinked) {
    console.log(`    · verifying via Open Library / org bio…`);
    const refined = await verifyClaudeOnlyGuest(g.name, guestDraft, episodeContext);
    if (refined) {
      finalDraft = { ...guestDraft, ...refined };
      bioLink = refined.bioMatchesGuest && refined.bioSourceUrl ? refined.bioSourceUrl : null;
      if (refined.bioMatchesGuest === false) {
        console.log(`    ↳ Claude rejected the bio match, not linking`);
      }
    }
  }
  // Defensive: fall back to a name-derived slug if Claude omitted one
  // despite the schema requirement.
  const guestId = g.slug || slugify(g.name);
  const links = {};
  if (wikiLinked) links.wikipedia = wikiLinked.url;
  if (bioLink) links.bio = bioLink;

  // Defensive capitalization in case the LLM forgets.
  const credLine = finalDraft.credibilityLine || '';
  const capitalized = credLine.charAt(0).toUpperCase() + credLine.slice(1);

  guests.push({
    id: guestId,
    name: g.name,
    portrait: `/portraits/${guestId}.jpg`,
    portrait2x: `/portraits/${guestId}@2x.jpg`,
    portraitBrightness: portrait.brightness,
    credibilityLine: capitalized,
    fields: finalDraft.fields,
    roles: finalDraft.roles,
    credentials: [],
    currentRole: finalDraft.currentRole,
    links,
  });
  guestIdMap[g.name] = guestId;
  const wikiStatus = wikiLinked
    ? `Wikipedia: ${wikiLinked.title}`
    : wiki
      ? `Wikipedia rejected by Claude (was: ${wiki.title})`
      : 'no Wikipedia match';
  console.log(`    + ${guestId} (${wikiStatus})`);
}

// --- 5. portrait files under the primary guest's id -----------------

console.log(`[5/6] saving portrait files…`);
const primaryGuestId = guestIdMap[draft.guests[0].name];
mkdirSync('public/portraits', { recursive: true });
// auto-portrait.py emits jpg, webp, and avif alongside each other in staging.
// Copy all three so the <picture> element's modern-format sources resolve.
for (const ext of ['.jpg', '.webp', '.avif']) {
  copyFileSync(portrait.portraitPath.replace('.jpg', ext), `public/portraits/${primaryGuestId}${ext}`);
  copyFileSync(portrait.portrait2xPath.replace('.jpg', ext), `public/portraits/${primaryGuestId}@2x${ext}`);
}

// --- 6. assemble + write --------------------------------------------

console.log(`[6/6] writing episodes.json + guests.json…`);
const fullCatalog = loadJson('data/_youtube-raw.json');
const epNum = episodeNumberFor(fullCatalog, VIDEO_ID);
const episodeEntry = {
  id: `doac-${VIDEO_ID}`,
  episodeNumber: epNum.number,
  episodeNumberSource: epNum.source,
  title: draft.title,
  originalTitle: raw.title,
  slug: draft.slug,
  date: raw.publishedAt.slice(0, 10),
  duration: durationIsoToSeconds(raw.duration),
  guestIds: draft.guests.map((g) => guestIdMap[g.name]),
  topics: draft.topics,
  description: draft.description,
  links: { youtube: `https://www.youtube.com/watch?v=${VIDEO_ID}` },
  thumbnail: `/portraits/${primaryGuestId}.jpg`,
  promotions: draft.promotions,
  sponsors: draft.sponsors,
  chapters: draft.chapters,
};

// Re-read both files right before writing. The /review tool also writes
// to episodes.json and guests.json (title/description/bio patches), so
// reloading here narrows the race window from the full ingest cycle
// (1-2 min) to the final read-modify-write (milliseconds). Existing
// entries on disk win, we only append the new episode + any new guests.
const latestEpisodes = loadJson('data/episodes.json');
if (!latestEpisodes.some((ep) => ep.id === episodeEntry.id)) {
  latestEpisodes.push(episodeEntry);
}
latestEpisodes.sort((a, b) => b.date.localeCompare(a.date));
saveJson('data/episodes.json', latestEpisodes);

const latestGuests = loadJson('data/guests.json');
const latestGuestIds = new Set(latestGuests.map((g) => g.id));
for (const g of guests) {
  if (!latestGuestIds.has(g.id)) {
    latestGuests.push(g);
    latestGuestIds.add(g.id);
  }
}
saveJson('data/guests.json', latestGuests);

console.log(`\n✓ ingested ${VIDEO_ID} as "${draft.title}", guest(s): ${draft.guests.map((g) => g.name).join(', ')}`);
console.log(`  Review with: git diff data/episodes.json data/guests.json public/portraits/`);
