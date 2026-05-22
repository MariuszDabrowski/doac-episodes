import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = 'UCGq-a57w-aPwyi3pW7XLiHw'; // DOAC
const UPLOADS_PLAYLIST_ID = 'UU' + CHANNEL_ID.slice(2);
const OUT = 'data/_youtube-raw.json';

if (!API_KEY) {
  console.error('Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}

async function fetchAllPlaylistItems(playlistId) {
  const items = [];
  let pageToken;
  do {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('key', API_KEY);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`playlistItems ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    items.push(...data.items);
    pageToken = data.nextPageToken;
    process.stderr.write(`  Listed ${items.length} videos\r`);
  } while (pageToken);
  process.stderr.write('\n');
  return items;
}

async function fetchVideoDetails(videoIds) {
  const out = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,statistics');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', API_KEY);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`videos ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    out.push(...data.items);
    process.stderr.write(`  Fetched details for ${out.length}/${videoIds.length}\r`);
  }
  process.stderr.write('\n');
  return out;
}

console.log(`Fetching DOAC channel uploads (${UPLOADS_PLAYLIST_ID})...`);
const playlistItems = await fetchAllPlaylistItems(UPLOADS_PLAYLIST_ID);

console.log(`Fetching video details...`);
const videoIds = playlistItems.map((i) => i.contentDetails.videoId);
const videos = await fetchVideoDetails(videoIds);

const simplified = videos.map((v) => ({
  id: v.id,
  title: v.snippet.title,
  description: v.snippet.description,
  publishedAt: v.snippet.publishedAt,
  duration: v.contentDetails.duration, // ISO 8601 like PT1H23M45S
  thumbnails: v.snippet.thumbnails,
  tags: v.snippet.tags,
  viewCount: v.statistics?.viewCount,
}));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(simplified, null, 2));
console.log(`Wrote ${simplified.length} videos to ${OUT}`);
