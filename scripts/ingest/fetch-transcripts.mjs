import { readFile, mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const CANDIDATES = 'data/_curated-candidates.json';
const OUT_DIR = 'data/_transcripts';

const candidates = JSON.parse(await readFile(CANDIDATES, 'utf8'));
await mkdir(OUT_DIR, { recursive: true });

// See extract-portrait-frames.mjs for the YT_COOKIES_FILE rationale.
const cookieArgs = process.env.YT_COOKIES_FILE
  ? ['--cookies', process.env.YT_COOKIES_FILE]
  : [];

const runYtDlp = (videoId) =>
  new Promise((resolve, reject) => {
    const args = [
      ...cookieArgs,
      '--skip-download',
      '--write-auto-subs',
      '--write-subs',
      '--sub-langs',
      'en.*',
      '--convert-subs',
      'srt',
      '--output',
      `${OUT_DIR}/%(id)s.%(ext)s`,
      `https://www.youtube.com/watch?v=${videoId}`,
    ];
    const child = spawn('yt-dlp', args, { stdio: 'inherit' });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`yt-dlp exited with code ${code}`))
    );
    child.on('error', reject);
  });

const existingFiles = new Set(await readdir(OUT_DIR));
const hasTranscript = (id) => [...existingFiles].some((f) => f.startsWith(`${id}.`) && f.endsWith('.srt'));

const failures = [];
for (const [i, v] of candidates.entries()) {
  console.log(`\n[${i + 1}/${candidates.length}] ${v.id}, ${v.title.slice(0, 70)}`);
  if (hasTranscript(v.id)) {
    console.log('  (already downloaded, skipping)');
    continue;
  }
  try {
    await runYtDlp(v.id);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    failures.push({ id: v.id, title: v.title, error: e.message });
  }
}

console.log(`\nDone. ${candidates.length - failures.length}/${candidates.length} succeeded.`);
if (failures.length) {
  console.log('Failures:');
  failures.forEach((f) => console.log(`  ${f.id}, ${f.title.slice(0, 60)}, ${f.error}`));
}
