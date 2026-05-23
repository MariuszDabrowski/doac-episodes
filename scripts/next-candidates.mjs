import { readFileSync } from 'node:fs';

const count = parseInt(process.argv[2] || '6', 10);
const minMinutes = parseInt(process.argv[3] || '30', 10);

const catalog = JSON.parse(readFileSync('data/_youtube-raw.json', 'utf8'));
const episodes = JSON.parse(readFileSync('data/episodes.json', 'utf8'));
const haveIds = new Set(episodes.map((ep) => ep.id.replace(/^doac-/, '')));

// Parse ISO 8601 PT#H#M#S → seconds
function durationToSeconds(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

const minSeconds = minMinutes * 60;
const next = catalog
  .filter((v) => !haveIds.has(v.id))
  .filter((v) => durationToSeconds(v.duration) >= minSeconds)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  .slice(0, count);

console.log(`Next ${next.length} uningested episodes (≥ ${minMinutes} min):\n`);
for (const v of next) {
  const mins = Math.round(durationToSeconds(v.duration) / 60);
  console.log(`${v.id}  ${v.publishedAt.slice(0, 10)}  ${String(mins).padStart(3, ' ')}m  ${v.title.slice(0, 80)}`);
}
