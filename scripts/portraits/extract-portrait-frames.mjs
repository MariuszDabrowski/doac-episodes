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
// Stream URLs expire in a few hours — plenty of headroom for a single
// episode's extraction (~1 minute total).
console.log(`Resolving stream URL for ${videoId}…`);
const formatSelector =
  'bestvideo[ext=mp4][height<=1080]/bestvideo[height<=1080]/best[height<=1080]/best';
const streamUrl = (
  await run('yt-dlp', ['-g', '-f', formatSelector, '--no-warnings', videoUrl], { capture: true })
)
  .trim()
  .split('\n')[0]; // some formats return video + audio URLs on separate lines — we only need video

const durationStr = await run('yt-dlp', ['--print', 'duration', '--no-warnings', videoUrl], {
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
    // `-ss` *before* `-i` is the fast seek — ffmpeg uses HTTP Range requests
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
