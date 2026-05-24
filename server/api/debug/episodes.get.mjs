import { readFile } from 'node:fs/promises';
import { defineEventHandler } from 'h3';

export default defineEventHandler(async () => {
  const [episodesRaw, guestsRaw] = await Promise.all([
    readFile('data/episodes.json', 'utf8'),
    readFile('data/guests.json', 'utf8'),
  ]);
  const episodes = JSON.parse(episodesRaw);
  const guests = JSON.parse(guestsRaw);
  const guestsById = Object.fromEntries(guests.map((g) => [g.id, g]));

  let review = {};
  try {
    review = JSON.parse(await readFile('data/_portrait-review.json', 'utf8'));
  } catch {
    // file doesn't exist yet — treat as empty
  }

  return episodes
    .map((ep) => ({
      id: ep.id,
      videoId: ep.id.replace(/^doac-/, ''),
      title: ep.title,
      date: ep.date,
      thumbnail: ep.thumbnail,
      primaryGuest: guestsById[ep.guestIds[0]]?.name || ep.guestIds[0],
      status: review[ep.id] || 'pending',
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
});
