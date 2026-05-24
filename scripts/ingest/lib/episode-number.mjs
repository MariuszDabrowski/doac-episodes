// Episode-number heuristic. DOAC's actual published number ("| E###" in
// the YouTube title) is the canonical source when present. When it isn't,
// fall back to a chronological estimate adjusted by the offset of the
// nearest anchored episode. The offset (currently ~58) drifts slowly, so
// the nearest anchor gives the best estimate for any given era. Numbers
// derived this way are typically within ±2 of DOAC's real numbering.
import { durationIsoToSeconds } from './utils.mjs';

const E_NUMBER_IN_TITLE = /\|\s*E(\d{1,4})\b/;

export function episodeNumberFor(catalog, videoId, MIN_SECONDS = 1800) {
  const longform = catalog
    .filter((v) => durationIsoToSeconds(v.duration) >= MIN_SECONDS)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const target = longform.findIndex((v) => v.id === videoId);
  if (target === -1) return { number: null, source: null };

  // Canonical: parse from the title if DOAC put it there
  const direct = longform[target].title.match(E_NUMBER_IN_TITLE);
  if (direct) return { number: parseInt(direct[1], 10), source: 'title-parse' };

  // Otherwise, find the chronologically-nearest anchored episode and
  // apply its offset.
  let nearest = null;
  let minDist = Infinity;
  for (let i = 0; i < longform.length; i++) {
    const m = longform[i].title.match(E_NUMBER_IN_TITLE);
    if (!m) continue;
    const dist = Math.abs(i - target);
    if (dist < minDist) {
      minDist = dist;
      nearest = { chrono: i + 1, ep: parseInt(m[1], 10) };
    }
  }
  if (!nearest) return { number: target + 1, source: 'estimate' };
  const offset = nearest.ep - nearest.chrono;
  return { number: target + 1 + offset, source: 'estimate' };
}
