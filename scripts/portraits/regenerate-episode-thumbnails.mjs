// Walk episodes.json, find any entry whose thumbnail still points at the
// canonical guest portrait (older ingest pattern, `/portraits/<slug>.jpg`)
// and mint a per-episode thumbnail at `/portraits/doac-<videoId>.{jpg,webp,avif}`
// + @2x siblings. Only touches the thumbnail/thumbnail2x/thumbnailBrightness
// fields; editorial copy (title, description, topics, bios) stays untouched.
//
// Re-reads episodes.json before each save so concurrent edits to other
// episodes (e.g. /review) don't get clobbered during the long-running batch.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { ensurePortrait } from '../ingest/lib/portrait.mjs';

const EPISODES_PATH = 'data/episodes.json';

async function loadEpisodes() {
  return JSON.parse(await readFile(EPISODES_PATH, 'utf8'));
}

async function saveEpisodes(episodes) {
  await writeFile(EPISODES_PATH, JSON.stringify(episodes, null, 2) + '\n');
}

const initial = await loadEpisodes();
const candidates = initial.filter(
  (e) => !e.thumbnail?.startsWith('/portraits/doac-')
);

console.log(
  `Found ${candidates.length} episodes still using the canonical guest portrait.\n`
);

const failed = [];
for (let i = 0; i < candidates.length; i++) {
  const ep = candidates[i];
  const videoId = ep.id.replace(/^doac-/, '');
  console.log(`\n========== [${i + 1}/${candidates.length}] ${videoId} ==========`);
  console.log(`  ${ep.title}`);

  try {
    const { brightness, portraitPath, portrait2xPath } = await ensurePortrait(videoId);

    const publicBase = `public/portraits/doac-${videoId}`;
    await mkdir('public/portraits', { recursive: true });
    for (const ext of ['.jpg', '.webp', '.avif']) {
      await copyFile(portraitPath.replace('.jpg', ext), `${publicBase}${ext}`);
      await copyFile(portrait2xPath.replace('.jpg', ext), `${publicBase}@2x${ext}`);
    }

    // Re-read + targeted update + write. Narrows the clobber window for
    // concurrent /review edits from minutes to ~milliseconds.
    const fresh = await loadEpisodes();
    const target = fresh.find((e) => e.id === ep.id);
    if (target) {
      target.thumbnail = `/portraits/doac-${videoId}.jpg`;
      target.thumbnail2x = `/portraits/doac-${videoId}@2x.jpg`;
      target.thumbnailBrightness = brightness;
      await saveEpisodes(fresh);
    }
    console.log(`✓ regenerated`);
  } catch (err) {
    console.error(`✗ failed: ${err.message}`);
    failed.push(videoId);
  }
}

console.log(`\n========== SUMMARY ==========`);
console.log(`Regenerated: ${candidates.length - failed.length}/${candidates.length}`);
if (failed.length) console.log(`Failed: ${failed.join(', ')}`);
