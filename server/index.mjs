#!/usr/bin/env node
// Local-only API server for the /review page. Runs alongside Vite on
// port 3001; Vite's proxy forwards /api/* here. Not intended for
// deployment, the review tool needs filesystem write access to data/
// and public/. The public site is a static SPA built with `npm run build`.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Atomic JSON write: stream to a sibling temp file, then rename. Without
// this, Vite's vite:json watcher catches the file mid-write and throws
// "invalid JSON syntax at position N". rename is atomic on POSIX so the
// watcher only ever sees the old or new contents, never partial.
async function writeJsonAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, path);
}

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

app.get('/api/review/episodes', async (c) => {
  const [episodesRaw, guestsRaw] = await Promise.all([
    readFile('data/episodes.json', 'utf8'),
    readFile('data/guests.json', 'utf8'),
  ]);
  const episodes = JSON.parse(episodesRaw);
  const guests = JSON.parse(guestsRaw);
  const guestsById = Object.fromEntries(guests.map((g) => [g.id, g]));
  const review = await readReview();

  // Pre-compute how many episodes each guest appears in so the UI can warn
  // that editing a bio updates N cards.
  const appearancesByGuest = {};
  for (const ep of episodes) {
    for (const gid of ep.guestIds) {
      appearancesByGuest[gid] = (appearancesByGuest[gid] || 0) + 1;
    }
  }

  // For each episode, surface any pre-computed alts that the batch script
  // (scripts/portraits/generate-all-alts.mjs) has emitted into
  // public/_review-picks/<videoId>/. Saves the user from clicking "Show
  // portrait alts" and waiting ~5-13s for auto-portrait.py per episode.
  function existingAlts(videoId) {
    const dir = `public/_review-picks/${videoId}`;
    if (!existsSync(`${dir}/out.jpg`)) return [];
    const alts = [];
    for (let n = 1; n <= 5; n += 1) {
      const file = n === 1 ? 'out.jpg' : `out-${n}.jpg`;
      if (existsSync(`${dir}/${file}`)) {
        alts.push({ pick: n, url: `/_review-picks/${videoId}/${file}` });
      }
    }
    return alts;
  }

  return c.json(
    episodes
      .map((ep) => {
        const guest = guestsById[ep.guestIds[0]];
        const videoId = ep.id.replace(/^doac-/, '');
        return {
          id: ep.id,
          videoId,
          title: ep.title,
          description: ep.description,
          date: ep.date,
          thumbnail: ep.thumbnail,
          primaryGuest: guest
            ? {
                id: guest.id,
                name: guest.name,
                credibilityLine: guest.credibilityLine || '',
                appearanceCount: appearancesByGuest[guest.id] || 1,
              }
            : null,
          status: review[ep.id] || 'pending',
          alts: existingAlts(videoId),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  );
});

app.post('/api/review/edit-episode', async (c) => {
  const { id, title, description } = await c.req.json();
  if (!id) return c.json({ error: 'id required' }, 400);
  const episodes = JSON.parse(await readFile('data/episodes.json', 'utf8'));
  const ep = episodes.find((e) => e.id === id);
  if (!ep) return c.json({ error: 'episode not found' }, 404);
  if (typeof title === 'string') ep.title = title;
  if (typeof description === 'string') ep.description = description;
  await writeJsonAtomic('data/episodes.json', episodes);
  return c.json({ ok: true });
});

app.post('/api/review/edit-guest', async (c) => {
  const { id, credibilityLine } = await c.req.json();
  if (!id) return c.json({ error: 'id required' }, 400);
  const guests = JSON.parse(await readFile('data/guests.json', 'utf8'));
  const guest = guests.find((g) => g.id === id);
  if (!guest) return c.json({ error: 'guest not found' }, 404);
  if (typeof credibilityLine === 'string') guest.credibilityLine = credibilityLine;
  await writeJsonAtomic('data/guests.json', guests);
  return c.json({ ok: true });
});

app.post('/api/review/approve', async (c) => {
  const { id, status } = await c.req.json();
  if (!id || !['good', 'pending'].includes(status)) {
    return c.json({ error: 'invalid id/status' }, 400);
  }
  const review = await readReview();
  if (status === 'pending') delete review[id];
  else review[id] = status;
  await writeJsonAtomic(REVIEW_PATH, review);
  return c.json({ ok: true, status });
});

app.post('/api/review/alts', async (c) => {
  const { videoId } = await c.req.json();
  if (!videoId) return c.json({ error: 'videoId required' }, 400);
  const dir = `public/_review-picks/${videoId}`;
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
      alts.push({ pick: n, url: `/_review-picks/${videoId}/${file}?t=${stamp}` });
    }
  }
  return c.json({ ok: true, alts });
});

app.post('/api/review/swap', async (c) => {
  const { videoId, pick } = await c.req.json();
  if (!videoId || pick == null) {
    return c.json({ error: 'videoId and pick required' }, 400);
  }
  await run('.venv/bin/python', [
    'scripts/portraits/swap-portrait.py',
    videoId,
    String(pick),
    `public/_review-picks/${videoId}`,
  ]);
  return c.json({ ok: true, stamp: Date.now() });
});

app.post('/api/review/reextract', async (c) => {
  const { videoId, count = 50 } = await c.req.json();
  if (!videoId) return c.json({ error: 'videoId required' }, 400);
  await rm(`data/_frames/${videoId}`, { recursive: true, force: true });
  await run('node', ['scripts/portraits/extract-portrait-frames.mjs', videoId, String(count)]);
  return c.json({ ok: true, count });
});

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${port}`);
});
