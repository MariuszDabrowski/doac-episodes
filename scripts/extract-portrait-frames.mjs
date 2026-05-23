import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const videoId = process.argv[2];
const FRAME_COUNT = parseInt(process.argv[3] || '20', 10);

if (!videoId) {
  console.error('Usage: extract-portrait-frames <youtube-video-id> [frame-count=20]');
  process.exit(1);
}

const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
const videoDir = 'data/_videos';
const framesDir = `data/_frames/${videoId}`;
const videoPath = `${videoDir}/${videoId}.mp4`;

await mkdir(videoDir, { recursive: true });
await mkdir(framesDir, { recursive: true });

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    let stdout = '';
    if (opts.capture) child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${cmd} exited with code ${code}`))
    );
  });
}

if (!existsSync(videoPath)) {
  // Download only a 40-minute window from the middle of the episode. Skips
  // intro chatter (first 5 min) and tail content. We delete the file after
  // frame extraction; it's not used for anything else. Cuts download size
  // roughly 4x on a 2-hour episode.
  console.log(`Downloading ${videoId} at 1080p (00:05:00-00:45:00 section)…`);
  await run('yt-dlp', [
    '-f',
    'best[height<=1080]/best',
    '--download-sections',
    '*00:05:00-00:45:00',
    '-o',
    videoPath,
    '--no-warnings',
    videoUrl,
  ]);
} else {
  console.log(`Reusing existing ${videoPath}`);
}

const durationStr = await run(
  'ffprobe',
  [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ],
  { capture: true }
);
const duration = parseFloat(durationStr.trim());

// Skip first/last 5% (intros, outros) — those are rarely the guest framed well
const startTime = duration * 0.05;
const endTime = duration * 0.95;
const interval = (endTime - startTime) / (FRAME_COUNT - 1);

console.log(
  `Duration ${(duration / 60).toFixed(1)} min · extracting ${FRAME_COUNT} frames between ${(startTime / 60).toFixed(1)}m and ${(endTime / 60).toFixed(1)}m`
);

for (let i = 0; i < FRAME_COUNT; i++) {
  const t = startTime + i * interval;
  const m = String(Math.floor(t / 60)).padStart(3, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const outFile = `${framesDir}/${m}m${s}s.jpg`;
  await run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    t.toString(),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outFile,
  ]);
  process.stderr.write(`  ${i + 1}/${FRAME_COUNT}\r`);
}
process.stderr.write('\n');

console.log(`\nDone. Browse ${framesDir} and pick one.`);
console.log(`Save (and crop if needed) to public/portraits/{guest-id}.jpg`);
console.log(`When done, you can delete ${videoPath} to free space (~300-500 MB).`);
