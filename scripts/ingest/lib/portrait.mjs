// Stage 1-2 of the ingestion pipeline: pull frames from YouTube and run
// the auto-portrait scorer to pick the best face crop.
import { existsSync, mkdirSync } from 'node:fs';
import { run } from './utils.mjs';

/**
 * Ensures a portrait exists for the given video by:
 *   1. Extracting 20 candidate frames (skipped if data/_frames/{vid}/ exists)
 *   2. Running auto-portrait.py on those frames; the top pick lands in
 *      data/_portrait-staging/{vid}.{jpg,webp,avif} + @2x variants
 *
 * Returns the brightness (used by the UI scrim) and the staging paths so
 * the caller can copy them under the eventual guest id.
 */
export async function ensurePortrait(videoId) {
  const framesDir = `data/_frames/${videoId}`;
  if (!existsSync(framesDir)) {
    console.log(`[1/6] extracting frames…`);
    await run('node', ['scripts/portraits/extract-portrait-frames.mjs', videoId, '20']);
  } else {
    console.log(`[1/6] frames already extracted, skipping`);
  }

  console.log(`[2/6] auto-portrait scoring…`);
  const tmpOut = `data/_portrait-staging/${videoId}.jpg`;
  mkdirSync('data/_portrait-staging', { recursive: true });
  // Only the top pick. Alts were never used in practice (host blacklist
  // + face_recognition make the default reliable), so we don't generate
  // -2/-3 candidates anymore.
  const { stdout } = await run(
    '.venv/bin/python',
    ['scripts/portraits/auto-portrait.py', framesDir, tmpOut, '1'],
    { capture: true }
  );

  // Parse the "[default] ... brightness 0.231 → out.jpg + @2x" line.
  const m = stdout.match(/\[default\][^→]*brightness ([\d.]+)/);
  if (!m) throw new Error(`Could not parse auto-portrait output:\n${stdout}`);
  const brightness = parseFloat(m[1]);

  return {
    brightness,
    portraitPath: tmpOut,
    portrait2xPath: tmpOut.replace('.jpg', '@2x.jpg'),
  };
}
