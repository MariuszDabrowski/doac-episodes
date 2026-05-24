#!/usr/bin/env node
// API server for the debug-portraits page. In dev, runs alongside Vite on
// port 3001; Vite's proxy forwards /api/* here. In prod, the same server
// can also serve the built static output from dist/ (run with NODE_ENV=production).
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const PORT = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3001;
const REVIEW_PATH = 'data/_portrait-review.json';

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

async function readReview() {
  try {
    return JSON.parse(await readFile(REVIEW_PATH, 'utf8'));
  } catch {
    return {};
  }
}

const app = new Hono();

app.get('/api/debug/episodes', async (c) => {
  const [episodesRaw, guestsRaw] = await Promise.all([
    readFile('data/episodes.json', 'utf8'),
    readFile('data/guests.json', 'utf8'),
  ]);
  const episodes = JSON.parse(episodesRaw);
  const guests = JSON.parse(guestsRaw);
  const guestsById = Object.fromEntries(guests.map((g) => [g.id, g]));
  const review = await readReview();

  return c.json(
    episodes
      .map((ep) => ({
        id: ep.id,
        videoId: ep.id.replace(/^doac-/, ''),
        title: ep.title,
        date: ep.date,
        thumbnail: ep.thumbnail,
        primaryGuest: guestsById[ep.guestIds[0]]?.name || ep.guestIds[0],
        status: review[ep.id] || 'pending',
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  );
});

app.post('/api/debug/approve', async (c) => {
  const { id, status } = await c.req.json();
  if (!id || !['good', 'pending'].includes(status)) {
    return c.json({ error: 'invalid id/status' }, 400);
  }
  const review = await readReview();
  if (status === 'pending') delete review[id];
  else review[id] = status;
  await writeFile(REVIEW_PATH, JSON.stringify(review, null, 2) + '\n');
  return c.json({ ok: true, status });
});

app.post('/api/debug/alts', async (c) => {
  const { videoId } = await c.req.json();
  if (!videoId) return c.json({ error: 'videoId required' }, 400);
  const dir = `public/_debug-picks/${videoId}`;
  await mkdir(dir, { recursive: true });

  await run('.venv/bin/python', [
    'scripts/portraits/auto-portrait.py',
    `data/_frames/${videoId}`,
    `${dir}/out.jpg`,
    '5',
  ]);

  const stamp = Date.now();
  const alts = [];
  for (let n = 1; n <= 5; n += 1) {
    const file = n === 1 ? 'out.jpg' : `out-${n}.jpg`;
    if (existsSync(`${dir}/${file}`)) {
      alts.push({ pick: n, url: `/_debug-picks/${videoId}/${file}?t=${stamp}` });
    }
  }
  return c.json({ ok: true, alts });
});

app.post('/api/debug/swap', async (c) => {
  const { videoId, pick } = await c.req.json();
  if (!videoId || pick == null) {
    return c.json({ error: 'videoId and pick required' }, 400);
  }
  await run('.venv/bin/python', [
    'scripts/portraits/swap-portrait.py',
    videoId,
    String(pick),
    `public/_debug-picks/${videoId}`,
  ]);
  return c.json({ ok: true, stamp: Date.now() });
});

app.post('/api/debug/reextract', async (c) => {
  const { videoId, count = 50 } = await c.req.json();
  if (!videoId) return c.json({ error: 'videoId required' }, 400);
  await rm(`data/_frames/${videoId}`, { recursive: true, force: true });
  await run('node', ['scripts/portraits/extract-portrait-frames.mjs', videoId, String(count)]);
  return c.json({ ok: true, count });
});

// Production: also serve the Vite-built static output and fall back to
// index.html for SPA routes. In dev, Vite serves these and proxies /api here.
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', async (c) => {
    const html = await readFile('dist/index.html', 'utf8');
    return c.html(html);
  });
}

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${port}`);
});
