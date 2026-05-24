import { spawn } from 'node:child_process';
import { defineEventHandler, readBody, createError } from 'h3';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

export default defineEventHandler(async (event) => {
  const { videoId, pick } = await readBody(event);
  if (!videoId || pick == null) {
    throw createError({ statusCode: 400, message: 'videoId and pick required' });
  }

  await run('.venv/bin/python', [
    'scripts/swap-portrait.py',
    videoId,
    String(pick),
    `public/_debug-picks/${videoId}`,
  ]);

  return { ok: true, stamp: Date.now() };
});
