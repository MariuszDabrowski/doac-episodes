#!/usr/bin/env node
/**
 * Summarize topic candidates logged by ingest-episode.mjs.
 * Use to decide which gaps are worth promoting to data/taxonomies.json.
 *
 * Usage: node scripts/topic-candidates.mjs
 */

import { readFileSync, existsSync } from 'node:fs';

const LOG = 'data/_topic-candidates.jsonl';
if (!existsSync(LOG)) {
  console.log(`${LOG} not found — no candidates logged yet.`);
  process.exit(0);
}

const rows = readFileSync(LOG, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const grouped = {};
for (const row of rows) {
  const key = row.suggested;
  if (!grouped[key]) grouped[key] = [];
  grouped[key].push(row);
}

const sorted = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

console.log(`${rows.length} candidate signal(s) across ${sorted.length} suggested topic(s):\n`);
for (const [suggested, entries] of sorted) {
  console.log(`  ${entries.length}× "${suggested}"`);
  for (const e of entries) {
    console.log(`     · ${e.title.slice(0, 80)}  → picked ${JSON.stringify(e.picked)}`);
  }
  console.log();
}
