#!/usr/bin/env node
/**
 * Recompute episodeNumber + episodeNumberSource for every entry in
 * data/episodes.json using the canonical algorithm:
 *   - title-parse: "| E###" extracted directly from the YouTube title (canonical)
 *   - estimate:    nearest title-parsed anchor + offset for this chronological position
 *
 * Use this any time the algorithm changes, or after refreshing
 * data/_youtube-raw.json with new episodes.
 *
 * Usage: node scripts/renumber-episodes.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');

const catalog = JSON.parse(readFileSync('data/_youtube-raw.json', 'utf8'));
const episodes = JSON.parse(readFileSync('data/episodes.json', 'utf8'));

const E_NUMBER_IN_TITLE = /\|\s*E(\d{1,4})\b/;

function durationIsoToSeconds(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return parseInt(m[1] || 0) * 3600 + parseInt(m[2] || 0) * 60 + parseInt(m[3] || 0);
}

function episodeNumberFor(videoId, MIN_SECONDS = 1800) {
  const longform = catalog
    .filter((v) => durationIsoToSeconds(v.duration) >= MIN_SECONDS)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const target = longform.findIndex((v) => v.id === videoId);
  if (target === -1) return { number: null, source: null };
  const direct = longform[target].title.match(E_NUMBER_IN_TITLE);
  if (direct) return { number: parseInt(direct[1], 10), source: 'title-parse' };
  let nearest = null;
  let minDist = Infinity;
  for (let i = 0; i < longform.length; i++) {
    const m = longform[i].title.match(E_NUMBER_IN_TITLE);
    if (!m) continue;
    const dist = Math.abs(i - target);
    if (dist < minDist) {
      minDist = dist;
      nearest = { chrono: i + 1, ep: parseInt(m[1], 10) };
    }
  }
  if (!nearest) return { number: target + 1, source: 'estimate' };
  const offset = nearest.ep - nearest.chrono;
  return { number: target + 1 + offset, source: 'estimate' };
}

let changed = 0;
for (const ep of episodes) {
  const vid = ep.id.replace(/^doac-/, '');
  const { number, source } = episodeNumberFor(vid);
  if (ep.episodeNumber !== number || ep.episodeNumberSource !== source) {
    console.log(
      `  ${vid}  was=${ep.episodeNumber}(${ep.episodeNumberSource ?? 'unset'})  now=${number}(${source})`
    );
    ep.episodeNumber = number;
    ep.episodeNumberSource = source;
    changed += 1;
  }
}

if (DRY_RUN) {
  console.log(`\n${changed} entries would be updated (dry-run).`);
} else if (changed) {
  // Keep date-desc sort that the rest of the system expects
  episodes.sort((a, b) => b.date.localeCompare(a.date));
  writeFileSync('data/episodes.json', JSON.stringify(episodes, null, 2) + '\n');
  console.log(`\n${changed} entries updated in data/episodes.json.`);
} else {
  console.log('\nNo changes needed.');
}
