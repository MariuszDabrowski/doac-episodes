import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
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

export default defineEventHandler(async (event) => {
  const { videoId } = await readBody(event);
  if (!videoId) throw createError({ statusCode: 400, message: 'videoId required' });
  const dir = `public/_debug-picks/${videoId}`;
  await mkdir(dir, { recursive: true });

  await run('.venv/bin/python', [
    'scripts/auto-portrait.py',
    `data/_frames/${videoId}`,
    `${dir}/out.jpg`,
    '5',
  ]);

  // The script writes out.jpg, out-2.jpg ... out-5.jpg (plus webp/avif/@2x
  // siblings). Some may not exist if fewer than 5 candidates survived
  // the eye-state / clustering filters; return what's present.
  const { existsSync } = await import('node:fs');
  const stamp = Date.now(); // cache-bust the <img> on the client
  const alts = [];
  for (let n = 1; n <= 5; n += 1) {
    const file = n === 1 ? 'out.jpg' : `out-${n}.jpg`;
    if (existsSync(`${dir}/${file}`)) {
      alts.push({ pick: n, url: `/_debug-picks/${videoId}/${file}?t=${stamp}` });
    }
  }
  return { ok: true, alts };
});
