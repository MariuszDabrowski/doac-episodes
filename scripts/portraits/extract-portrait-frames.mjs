import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const videoId = process.argv[2];
const FRAME_COUNT = parseInt(process.argv[3] || '20', 10);

if (!videoId) {
  console.error('Usage: extract-portrait-frames <youtube-video-id> [frame-count=20]');
  process.exit(1);
}

const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
const framesDir = `data/_frames/${videoId}`;
await mkdir(framesDir, { recursive: true });

// YouTube blocks unauthenticated yt-dlp on datacenter IPs (GitHub runners)
// with a "confirm you're not a bot" challenge. Even with cookies, the
// default `web` client gets silently downgraded to `tv_downgraded` which
// returns only storyboard images, no video streams. The fix is to
// explicitly request clients we know YouTube still serves real streams
// to, in priority order, so yt-dlp picks the first that works:
//   - ios: HLS streams; usually the most resilient on datacenter IPs
//   - web_safari: also HLS; Safari UA gets less bot-checked
//   - tv_embedded: legacy embedded player; sometimes works when others don't
//   - mweb: mobile web; reasonable last resort
// Cookies still go through when YT_COOKIES_FILE is set, on top of the
// client override (the two combine, they aren't alternatives).
const cookieArgs = process.env.YT_COOKIES_FILE
  ? ['--cookies', process.env.YT_COOKIES_FILE]
  : [];
const ytArgs = [
  ...cookieArgs,
  '--extractor-args',
  'youtube:player_client=ios,web_safari,tv_embedded,mweb',
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.capture ? ['ignore', 'pipe', opts.silent ? 'ignore' : 'inherit'] : 'inherit',
    });
    let stdout = '';
    if (opts.capture) child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${cmd} exited with code ${code}`))
    );
  });
}

// Pull the direct 1080p video-only stream URL (and duration) without
// downloading the file. ffmpeg later seeks into this URL via HTTP byte-range
// requests, so only the small chunk around each sample point gets fetched.
// Stream URLs expire in a few hours, plenty of headroom for a single
// episode's extraction (~1 minute total).
console.log(`Resolving stream URL for ${videoId}…`);
// MP4 is preferred (cleanest HTTP-range seeks for ffmpeg) but accept any
// container: the iOS/Safari clients we now request only return HLS
// streams, which ffmpeg can also seek into via the manifest. Cap at
// 1080p so we don't pull a 4K stream we'd just downscale anyway.
const formatSelector =
  'bestvideo[ext=mp4][height<=1080]/bestvideo[height<=1080]/best[height<=1080]/best';

let streamUrl;
try {
  streamUrl = (
    await run('yt-dlp', [...ytArgs, '-g', '-f', formatSelector, '--no-warnings', videoUrl], { capture: true })
  )
    .trim()
    .split('\n')[0]; // some formats return video + audio URLs on separate lines, we only need video
} catch (err) {
  // Common causes for "Requested format is not available" / "Video unavailable":
  // geo-restricted to a region the runner IP isn't in, age-gated requiring
  // additional consent beyond cookies, members-only, removed by uploader.
  // Dump availability + format count so the next reviewer can tell which.
  console.error(`\nFailed to resolve a stream for ${videoId}. Diagnostic:`);
  try {
    // --ignore-no-formats-error lets --print succeed even when format
    // selection would fail, so we actually see the metadata that the
    // extractor pulled before erroring.
    const diag = await run(
      'yt-dlp',
      [
        ...ytArgs,
        '--no-warnings',
        '--ignore-no-formats-error',
        '--print',
        'availability=%(availability)s age_limit=%(age_limit)s live=%(live_status)s formats=%(format_count)s title=%(title).80s',
        videoUrl,
      ],
      { capture: true }
    );
    console.error(`  ${diag.trim()}`);
  } catch (diagErr) {
    console.error(`  (diagnostic call also failed: ${diagErr.message})`);
  }
  // Also dump available formats so we can see what yt-dlp could see.
  try {
    const formats = await run(
      'yt-dlp',
      [...ytArgs, '--no-warnings', '--ignore-no-formats-error', '--list-formats', videoUrl],
      { capture: true }
    );
    const tail = formats.trim().split('\n').slice(-10).join('\n');
    console.error(`  formats (last 10 lines):\n${tail}`);
  } catch {}
  throw err;
}

const durationStr = await run('yt-dlp', [...ytArgs, '--print', 'duration', '--no-warnings', videoUrl], {
  capture: true,
});
const duration = parseFloat(durationStr.trim());

const startTime = duration * 0.05;
const endTime = duration * 0.95;
const interval = (endTime - startTime) / (FRAME_COUNT - 1);

console.log(
  `Duration ${(duration / 60).toFixed(1)} min · extracting ${FRAME_COUNT} frames between ${(startTime / 60).toFixed(1)}m and ${(endTime / 60).toFixed(1)}m`
);

async function grabFrame(seconds, outFile, attempt = 1) {
  try {
    // `-ss` *before* `-i` is the fast seek, ffmpeg uses HTTP Range requests
    // to skip directly to the nearest keyframe instead of reading from 0.
    await run(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        seconds.toString(),
        '-i',
        streamUrl,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        outFile,
      ],
      { capture: true, silent: true }
    );
  } catch (err) {
    if (attempt < 3) {
      // Brief backoff in case YouTube throttled the range request
      await new Promise((r) => setTimeout(r, 500 * attempt));
      return grabFrame(seconds, outFile, attempt + 1);
    }
    throw err;
  }
}

let succeeded = 0;
for (let i = 0; i < FRAME_COUNT; i++) {
  const t = startTime + i * interval;
  const m = String(Math.floor(t / 60)).padStart(3, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const outFile = `${framesDir}/${m}m${s}s.jpg`;
  try {
    await grabFrame(t, outFile);
    succeeded += 1;
  } catch (err) {
    process.stderr.write(`\n  [${m}m${s}s] failed after retries: ${err.message}\n`);
  }
  process.stderr.write(`  ${i + 1}/${FRAME_COUNT}\r`);
}
process.stderr.write('\n');

console.log(`\n${succeeded}/${FRAME_COUNT} frames written to ${framesDir}`);
console.log(`Next: .venv/bin/python scripts/portraits/auto-portrait.py ${framesDir} public/portraits/{guestId}.jpg`);
