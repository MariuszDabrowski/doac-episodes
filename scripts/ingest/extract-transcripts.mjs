import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'data/_transcripts';

function parseVtt(content) {
  const cues = [];
  const blocks = content.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((l) => /^\d{2}:\d{2}:\d{2}\.\d{3} --> /.test(l));
    if (timingIdx === -1) continue; // header or note block

    const m = lines[timingIdx].match(
      /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})/
    );
    if (!m) continue;
    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;

    const textLines = lines.slice(timingIdx + 1);
    // Prefer the line that carries inline word-level timing, that's the
    // "active" line where new speech is being transcribed.
    let chosen = textLines.find((l) => /<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(l));
    if (!chosen) chosen = textLines.find((l) => l.trim());
    if (!chosen) continue;

    const text = chosen
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
      .replace(/<\/?c[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  // Dedupe consecutive identical text, extending the time range.
  const out = [];
  for (const cue of cues) {
    const last = out[out.length - 1];
    if (last && last.text === cue.text) {
      last.end = Math.max(last.end, cue.end);
    } else {
      out.push(cue);
    }
  }
  return out;
}

const files = await readdir(DIR);
// Prefer .en-orig.vtt (auto-generated original) where it exists.
const vttFiles = files.filter((f) => f.endsWith('.vtt'));
const byId = new Map();
for (const f of vttFiles) {
  const id = f.split('.')[0];
  const prev = byId.get(id);
  if (!prev || (!prev.includes('en-orig') && f.includes('en-orig'))) {
    byId.set(id, f);
  }
}

let total = 0;
for (const [id, file] of byId) {
  const content = await readFile(join(DIR, file), 'utf8');
  const cues = parseVtt(content);
  const outPath = join(DIR, `${id}.json`);
  await writeFile(outPath, JSON.stringify(cues));
  const lastEnd = cues.length ? cues[cues.length - 1].end : 0;
  const mins = Math.floor(lastEnd / 60);
  console.log(`  ${id}.json, ${cues.length} cues, ~${mins} min`);
  total += cues.length;
}

console.log(`\nExtracted ${total} cues across ${byId.size} transcripts.`);
