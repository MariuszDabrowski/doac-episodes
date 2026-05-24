import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { defineEventHandler, readBody, createError } from 'h3';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

// Re-extract more frames for a video when the existing 20 don't yield a
// good guest portrait (e.g. host dominated → only host-flagged candidates
// survive the filter). Wipes the existing _frames dir for that video and
// pulls 50 fresh frames.
export default defineEventHandler(async (event) => {
  const { videoId, count = 50 } = await readBody(event);
  if (!videoId) throw createError({ statusCode: 400, message: 'videoId required' });
  await rm(`data/_frames/${videoId}`, { recursive: true, force: true });
  await run('node', ['scripts/extract-portrait-frames.mjs', videoId, String(count)]);
  return { ok: true, count };
});
