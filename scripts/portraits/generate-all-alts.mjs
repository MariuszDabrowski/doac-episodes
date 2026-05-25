// One-time (+ incremental) batch: pre-compute the top-5 portrait alts for
// every episode so /review can render them without waiting for the
// auto-portrait Python pipeline on each click. Outputs land in
// public/_review-picks/<videoId>/out{,-2,-3,-4,-5}.{jpg,webp,avif}
// (+ @2x variants). That directory is gitignored and ~1-2MB/episode.
//
// Skips an episode if `out.jpg` already exists in its picks dir, so
// running this again only fills in new episodes. Pass --force to redo
// every episode (e.g. after re-extracting frames at higher count).
//
// Usage:
//   node scripts/portraits/generate-all-alts.mjs           # incremental
//   node scripts/portraits/generate-all-alts.mjs --force   # redo everything
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { run } from '../ingest/lib/utils.mjs';

const FORCE = process.argv.includes('--force');

const episodes = JSON.parse(await readFile('data/episodes.json', 'utf8'));
console.log(`Catalog: ${episodes.length} episodes`);

let skipped = 0;
let done = 0;
const failed = [];

for (let i = 0; i < episodes.length; i++) {
  const ep = episodes[i];
  const videoId = ep.id.replace(/^doac-/, '');
  const dir = `public/_review-picks/${videoId}`;
  const flagFile = `${dir}/out.jpg`;

  if (!FORCE && existsSync(flagFile)) {
    skipped++;
    continue;
  }

  const framesDir = `data/_frames/${videoId}`;
  if (!existsSync(framesDir)) {
    // No frames on disk (frames cache is gitignored; older episodes from
    // an earlier laptop may not have them locally). Skip rather than
    // re-extract here, that's a separate, much heavier flow.
    failed.push({ videoId, reason: 'no frames cached' });
    continue;
  }

  await mkdir(dir, { recursive: true });
  process.stdout.write(`[${i + 1}/${episodes.length}] ${videoId} …`);

  try {
    await run('.venv/bin/python', [
      'scripts/portraits/auto-portrait.py',
      framesDir,
      `${dir}/out.jpg`,
      '5',
    ]);
    done++;
    process.stdout.write(' ✓\n');
  } catch (err) {
    failed.push({ videoId, reason: err.message.split('\n')[0] });
    process.stdout.write(` ✗ ${err.message.split('\n')[0]}\n`);
  }
}

console.log(`\n========== SUMMARY ==========`);
console.log(`Generated: ${done}`);
console.log(`Skipped (already done): ${skipped}`);
console.log(`Failed: ${failed.length}`);
for (const f of failed.slice(0, 20)) {
  console.log(`  ${f.videoId}: ${f.reason}`);
}
if (failed.length > 20) {
  console.log(`  …and ${failed.length - 20} more`);
}
