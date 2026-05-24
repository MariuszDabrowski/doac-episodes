#!/usr/bin/env node
/**
 * Run ingest-episode.mjs across the next N un-ingested candidates.
 * Skips any that already exist in episodes.json (defensive — the
 * candidate picker already filters them, but races could occur).
 *
 * Usage: node scripts/ingest-batch.mjs [count=10] [min-minutes=30]
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const count = parseInt(process.argv[2] || '10', 10);
const minMinutes = parseInt(process.argv[3] || '30', 10);

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code));
  });
}

function pickCandidates() {
  const catalog = JSON.parse(readFileSync('data/_youtube-raw.json', 'utf8'));
  const episodes = JSON.parse(readFileSync('data/episodes.json', 'utf8'));
  const haveIds = new Set(episodes.map((ep) => ep.id.replace(/^doac-/, '')));
  const durationToSec = (iso) => {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return parseInt(m[1] || 0) * 3600 + parseInt(m[2] || 0) * 60 + parseInt(m[3] || 0);
  };
  return catalog
    .filter((v) => !haveIds.has(v.id))
    .filter((v) => durationToSec(v.duration) >= minMinutes * 60)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, count)
    .map((v) => v.id);
}

const candidates = pickCandidates();
console.log(`Batch ingesting ${candidates.length} episodes:\n  ${candidates.join('\n  ')}\n`);

let succeeded = 0;
const failed = [];
const start = Date.now();
for (const id of candidates) {
  console.log(`\n========== ${id} ==========\n`);
  const code = await run('node', ['scripts/ingest-episode.mjs', id]);
  if (code === 0) succeeded += 1;
  else failed.push(id);
}
const seconds = Math.round((Date.now() - start) / 1000);

console.log(`\n========== BATCH SUMMARY ==========`);
console.log(`Time: ${Math.floor(seconds / 60)}m ${seconds % 60}s`);
console.log(`Succeeded: ${succeeded}/${candidates.length}`);
if (failed.length) console.log(`Failed: ${failed.join(', ')}`);
console.log(`\nReview with: git diff data/episodes.json data/guests.json public/portraits/`);
