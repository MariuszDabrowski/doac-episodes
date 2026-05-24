#!/usr/bin/env node
/**
 * End-to-end episode ingestion: takes a YouTube video ID, produces a
 * complete episodes.json entry + guest entries + portrait files.
 *
 * Usage: node scripts/ingest-episode.mjs <videoId>
 *
 * Steps:
 *  1. Read raw metadata from data/_youtube-raw.json
 *  2. Run frame extraction + auto-portrait (top-3 candidates saved)
 *  3. Call Claude (Haiku) once with the description + transcript snippet:
 *     returns rewritten title, description, topics, chapters, promotions,
 *     sponsors, guest names, slug, episode number
 *  4. For each detected guest not already in guests.json:
 *     - Wikipedia search → Wikidata claims → Claude writes credibilityLine
 *     - Build a guests.json entry
 *  5. Save the picked portrait to public/portraits/{guestId}.{jpg,@2x.jpg}
 *  6. Write the episode into data/episodes.json (sorted by date desc)
 *
 * Editorial rules from specs/PROJECT_BRIEF.md are baked into the Claude
 * prompt so drafts hew to the brief without us reciting them every time.
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, appendFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const MODEL = 'claude-haiku-4-5-20251001';
const VIDEO_ID = process.argv[2];

if (!VIDEO_ID) {
  console.error('Usage: ingest-episode.mjs <videoId>');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY missing — set it in .env');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- helpers --------------------------------------------------------

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '';
    let stderr = '';
    if (opts.capture) {
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
    }
    child.on('close', (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr}`))
    );
  });
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function durationIsoToSeconds(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return parseInt(m[1] || 0) * 3600 + parseInt(m[2] || 0) * 60 + parseInt(m[3] || 0);
}

// Derive an episode number, preferring DOAC's actual published number
// (parsed from "| E###" in YouTube titles when present) and falling back
// to an offset-adjusted chronological estimate using the nearest
// anchored episode. Numbers are typically within ±2 of DOAC's real
// numbering since the offset (currently ~58) drifts very slowly.
const E_NUMBER_IN_TITLE = /\|\s*E(\d{1,4})\b/;

function episodeNumberFor(catalog, videoId, MIN_SECONDS = 1800) {
  const longform = catalog
    .filter((v) => durationIsoToSeconds(v.duration) >= MIN_SECONDS)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const target = longform.findIndex((v) => v.id === videoId);
  if (target === -1) return { number: null, source: null };

  // Canonical: parse from the title if DOAC put it there
  const direct = longform[target].title.match(E_NUMBER_IN_TITLE);
  if (direct) return { number: parseInt(direct[1], 10), source: 'title-parse' };

  // Otherwise, find the chronologically-nearest anchored episode and
  // apply its offset. Offset drifts slowly so the nearest anchor gives
  // the best estimate for any given era.
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

// --- stages ---------------------------------------------------------

async function ensurePortrait(videoId) {
  // Skip frame extraction if frames already exist (e.g. from earlier batch).
  const framesDir = `data/_frames/${videoId}`;
  if (!existsSync(framesDir)) {
    console.log(`[1/6] extracting frames…`);
    await run('node', ['scripts/extract-portrait-frames.mjs', videoId, '20']);
  } else {
    console.log(`[1/6] frames already extracted, skipping`);
  }

  console.log(`[2/6] auto-portrait scoring…`);
  const tmpOut = `data/_portrait-staging/${videoId}.jpg`;
  mkdirSync('data/_portrait-staging', { recursive: true });
  // Only the top pick — alts were never used in practice (host blacklist
  // + face_recognition make the default reliable), so we don't generate
  // -2/-3 candidates anymore.
  const { stdout } = await run(
    '.venv/bin/python',
    ['scripts/auto-portrait.py', framesDir, tmpOut, '1'],
    { capture: true }
  );

  // Parse the "[default] ... brightness 0.231 → out.jpg + @2x" line
  const m = stdout.match(/\[default\][^→]*brightness ([\d.]+)/);
  if (!m) throw new Error(`Could not parse auto-portrait output:\n${stdout}`);
  const brightness = parseFloat(m[1]);

  return {
    brightness,
    portraitPath: tmpOut,
    portrait2xPath: tmpOut.replace('.jpg', '@2x.jpg'),
  };
}

const EPISODE_TOOL = {
  name: 'submit_episode_draft',
  description: 'Submit the structured episode draft.',
  input_schema: {
    type: 'object',
    required: [
      'title',
      'description',
      'topics',
      'slug',
      'guests',
      'chapters',
      'promotions',
      'sponsors',
    ],
    properties: {
      title: {
        type: 'string',
        description:
          'A topical headline of 3-7 words. Says what the episode is ABOUT. Plain sentence case, no question marks, no clickbait, no exclamations.',
      },
      description: {
        type: 'string',
        description:
          '15-25 words. Says what gets COVERED (not who the guest is). Past-tense or descriptive, never promotional. Example: "Sinclair on his lab\'s gene-therapy trials, his daily supplement stack, and why fasting and \'good stress\' extend life."',
      },
      topics: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Pick 1-3 most representative topic IDs from this controlled vocabulary, sorted most-representative-first.',
      },
      slug: {
        type: 'string',
        description:
          'Kebab-case URL identifier. Pattern: {primary-guest-lastname}-{short-topic-phrase}. Example: "david-sinclair-aging-reversal"',
      },
      episodeNumber: {
        type: ['integer', 'null'],
        description:
          'Episode number if visible in the YouTube title (e.g. "| E108"), else null.',
      },
      guests: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'slug'],
          properties: {
            name: { type: 'string', description: 'Full proper name of the guest as commonly written.' },
            slug: {
              type: 'string',
              description:
                'Kebab-case guest ID. Example: "david-sinclair", "esther-perel". Skip Dr/Prof prefixes.',
            },
          },
        },
      },
      chapters: {
        type: 'array',
        items: {
          type: 'object',
          required: ['start', 'title'],
          properties: {
            start: { type: 'integer', description: 'Start time in seconds from beginning of episode.' },
            title: { type: 'string', description: 'Chapter title as written in the YouTube description.' },
          },
        },
        description:
          'Chapters from the YouTube description\'s timestamped TOC. Empty array if none.',
      },
      promotions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'title', 'by', 'link'],
          properties: {
            type: { type: 'string', enum: ['book', 'product', 'course', 'company', 'service'] },
            title: { type: 'string' },
            by: { type: 'string', enum: ['guest'] },
            link: { type: 'string' },
          },
        },
        description:
          'Items the GUEST is promoting (book, product, course, company, service). Skip generic "follow me on Twitter" links. Skip the host\'s own promotions (DOAC book, DOAC Circle, 1% Diary). Empty array if none.',
      },
      sponsors: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'url', 'topical'],
          properties: {
            name: { type: 'string' },
            url: { type: 'string' },
            topical: {
              type: 'boolean',
              description:
                'True if the sponsor\'s product overlaps the episode subject (e.g. a supplement company on a longevity episode). Editorial signal — be specific.',
            },
          },
        },
        description:
          'Paid sponsors from the description\'s "Sponsors:" block. Empty array if none.',
      },
      suggestedTopicGap: {
        type: ['string', 'null'],
        description:
          'OPTIONAL signal: if the controlled taxonomy is genuinely missing a topic that would fit this episode much better than any existing one, suggest a short kebab-case slug (e.g. "science", "history", "spirituality"). Be conservative — only fill when the existing list clearly does not cover the episode. Null otherwise. This is just an observation; the curator decides whether to promote it.',
      },
    },
  },
};

async function draftEpisode(raw, topicsTaxonomy) {
  console.log(`[3/6] drafting episode (Claude ${MODEL})…`);
  const topicList = topicsTaxonomy
    .map((t) => `${t.id} — ${t.label}: ${t.synonyms?.join(', ') || ''}`)
    .join('\n');

  // Clone the schema so we can patch the topics enum to the actual
  // taxonomy IDs — without this, Claude invents topics like "health" or
  // "technology" even when the prompt says to pick from the list.
  const tool = JSON.parse(JSON.stringify(EPISODE_TOOL));
  tool.input_schema.properties.topics.items.enum = topicsTaxonomy.map((t) => t.id);

  const systemPrompt = `You are drafting structured episode metadata for "The Diary of a CEO" podcast catalog. Follow these editorial rules from the project brief:

- TITLE: topical headline, 3-7 words. Says what the episode is *about*. Strip clickbait, exclamation, sensationalism. The original YouTube title goes into "originalTitle" — your "title" must be different and editorially clean.
- DESCRIPTION: 15-25 words. Says what gets *covered* in the episode. Mentions the guest by last name. Plain, factual, never promotional. No marketing voice.
- TOPICS: pick 1-3 from the controlled taxonomy. Most-representative first. Don't add new topics.
- SLUG: {guest-last-name}-{topic-phrase}, kebab-case.
- GUESTS: detect from the original title. For multi-guest episodes, include all.
- CHAPTERS: extract from the description's timestamped TOC if present.
- PROMOTIONS: the GUEST's books, products, courses, companies they're plugging — NOT generic social links (Twitter, Instagram follow) and NOT the host's own merch (DOAC book, DOAC Circle, 1% Diary, etc.).
- SPONSORS: from the description's "Sponsors:" block. Mark topical: true when the product overlaps the episode subject.

Available topics:
${topicList}`;

  const userPrompt = `YouTube video ID: ${raw.id}
Published: ${raw.publishedAt}
Duration: ${raw.duration}
Original title: ${raw.title}

Full YouTube description:
---
${raw.description}
---

Draft the structured episode entry now.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'submit_episode_draft' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return tool_use');
  return toolUse.input;
}

async function wikipediaFetch(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': 'doac-ingest/1.0 (contact wayrse@gmail.com)' } });
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return wikipediaFetch(url, attempt + 1);
  }
  if (!res.ok) return null;
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null; // non-JSON response (rate limit page, etc.)
  }
}

// Avoid trusting Wikipedia matches for someone with a totally different
// name (e.g. "Ben Felix" → "Ben Jochum"). Require the article title to
// contain at least one significant word from the search query, ignoring
// honorifics. Conservative on purpose — false negatives are fine (we
// just emit a guest entry without Wikipedia), false positives cost us
// wrong biographical facts.
function nameMatchesArticle(searchName, articleTitle) {
  const honorifics = ['dr', 'drs', 'prof', 'professor', 'mr', 'mrs', 'ms', 'mx', 'sir', 'dame'];
  const tokens = (s) =>
    s
      .toLowerCase()
      .replace(/\([^)]*\)/g, '') // strip disambiguation parentheticals
      .replace(/[^\w\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !honorifics.includes(w));

  const searchTokens = tokens(searchName);
  const articleTokens = tokens(articleTitle);
  if (!searchTokens.length || !articleTokens.length) return false;

  // The search's last token (likely surname) must appear in the article.
  const searchSurname = searchTokens[searchTokens.length - 1];
  if (!articleTokens.includes(searchSurname)) return false;

  // AND the article's last token must appear in the search — catches
  // "Ben Felix" → "Ben Felix Jochum" (article has an extra surname
  // "Jochum" that's not in our query, so it's about a different person).
  const articleSurname = articleTokens[articleTokens.length - 1];
  if (!searchTokens.includes(articleSurname)) return false;

  return true;
}

async function wikipediaLookup(name) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&namespace=0&format=json`;
    const searchRes = await wikipediaFetch(searchUrl);
    const articleTitle = searchRes?.[1]?.[0];
    if (!articleTitle) return null;
    if (!nameMatchesArticle(name, articleTitle)) {
      console.log(`    ↳ wikipedia returned "${articleTitle}" — surname mismatch with "${name}", skipping`);
      return null;
    }
    // First grab the short summary to check identity (its `type` field
    // catches disambiguations and we re-validate the canonical title
    // after redirects). Then fetch a richer extract via the MediaWiki
    // `extracts` API — the REST summary's first 3 sentences miss things
    // like "Pulitzer winner", which usually sits further into the article.
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle.replace(/ /g, '_'))}`;
    const summary = await wikipediaFetch(summaryUrl);
    if (!summary || summary.type === 'disambiguation') return null;
    if (!nameMatchesArticle(name, summary.title)) {
      console.log(`    ↳ wikipedia redirected to "${summary.title}" — surname mismatch, skipping`);
      return null;
    }
    const extractsUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exsentences=15&explaintext=1&format=json&titles=${encodeURIComponent(summary.title)}`;
    const extractsRes = await wikipediaFetch(extractsUrl);
    const pages = extractsRes?.query?.pages || {};
    const firstPage = Object.values(pages)[0];
    const longExtract = firstPage?.extract || summary.extract;
    return {
      title: summary.title,
      extract: longExtract,
      url: summary.content_urls?.desktop?.page,
      wikidataId: summary.wikibase_item,
    };
  } catch (err) {
    console.log(`    ↳ wikipedia lookup failed for "${name}": ${err.message}`);
    return null;
  }
}

const GUEST_TOOL = {
  name: 'submit_guest_draft',
  description: 'Submit the structured guest entry draft.',
  input_schema: {
    type: 'object',
    required: ['credibilityLine', 'currentRole', 'fields', 'roles', 'wikipediaUsable'],
    properties: {
      credibilityLine: {
        type: 'string',
        description:
          'One short fact-based line of credentials, semicolon-separated. Concrete (institution names, book titles) over abstract. No opinions. Example: "Harvard professor of genetics; author of Lifespan; founded multiple longevity biotech companies."',
      },
      currentRole: {
        type: 'string',
        description: 'One-liner of their current position. Example: "Professor of Genetics, Harvard Medical School"',
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Areas of expertise — short labels like "genetics", "neuroscience", "business", "psychology".',
      },
      roles: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['academic', 'researcher', 'clinician', 'author', 'practitioner', 'public-figure'],
        },
        description: 'Pick all applicable from this enum.',
      },
      wikipediaUsable: {
        type: 'boolean',
        description:
          'Set true if a Wikipedia summary was provided AND it describes the same person who appeared on this episode (cross-check against the episode context). Set false if Wikipedia was provided but is clearly about a different person with a similar name. Set false if no Wikipedia was provided. Be strict — a urologist guest with a Wikipedia article about an ambient music producer is NOT a match.',
      },
      books: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Books authored by the guest (titles only, no subtitle). These will be verified against Google Books before being kept in the final entry — feel free to include any you think are theirs.',
      },
      primaryAffiliation: {
        type: ['string', 'null'],
        description:
          'The single most specific organization the guest is currently affiliated with (e.g. "PWL Capital", "Stanford School of Medicine"). Used to search the org\'s site for their official bio. Null if independent / no clear org.',
      },
    },
  },
};

// --- factual verification for Claude-only entries ------------------

async function verifyBook(title, authorName) {
  // Open Library: free, no key, no aggressive rate limit. Title + author
  // match. Google Books has a 1000/day unauthenticated quota that runs out
  // fast in batches; Open Library handles bulk fine.
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(authorName)}&limit=3`;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const data = await res.json();
    return (data.numFound || 0) > 0;
  } catch {
    return false;
  }
}

async function braveSearch(query, count = 3) {
  if (!process.env.BRAVE_API_KEY) return null;
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.web?.results || [];
  } catch {
    return null;
  }
}

async function fetchBioText(url) {
  // Fetch the page HTML and strip tags. Crude but Claude's good at
  // extracting bio info from cluttered text.
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'doac-ingest/1.0 (contact wayrse@gmail.com)' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 8000); // cap so we don't blow Claude's context on huge pages
  } catch {
    return null;
  }
}

const REFINE_TOOL = {
  name: 'submit_refined_guest',
  description: 'Submit the refined guest entry using only verified evidence.',
  input_schema: {
    type: 'object',
    required: ['credibilityLine', 'currentRole', 'fields', 'roles', 'bioMatchesGuest', 'bioSourceUrl'],
    properties: {
      credibilityLine: {
        type: 'string',
        description:
          'Refined credibilityLine using ONLY claims that the verified evidence supports. Drop any unverified specific claims (books, awards, founded companies, positions). If almost nothing was verified, keep this short — better a 5-word credible line than 30 words of guesses.',
      },
      currentRole: { type: 'string' },
      fields: { type: 'array', items: { type: 'string' } },
      roles: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['academic', 'researcher', 'clinician', 'author', 'practitioner', 'public-figure'],
        },
      },
      bioMatchesGuest: {
        type: 'boolean',
        description:
          'Set true ONLY if the fetched bio clearly describes the same person who appeared on this episode (cross-check name + field against the episode context). Set false if the bio is about a different person with a similar name, or if no bio was provided. Common-name guests often get matched to the wrong professional — be strict.',
      },
      bioSourceUrl: {
        type: ['string', 'null'],
        description:
          'URL of the authoritative bio page used — ONLY set this if bioMatchesGuest is true. Null otherwise.',
      },
    },
  },
};

async function refineGuestWithEvidence(name, originalDraft, episodeContext, evidence) {
  const verifiedBooksText =
    evidence.verifiedBooks.length > 0
      ? `Verified via Open Library (title + author both confirmed):\n${evidence.verifiedBooks.map((b) => '  - ' + b).join('\n')}`
      : 'No books were verified via Open Library.';
  const rejectedBooksText =
    evidence.rejectedBooks.length > 0
      ? `\n\nBooks Claude originally claimed that Open Library did NOT confirm — DO NOT include these in the refined line:\n${evidence.rejectedBooks.map((b) => '  - ' + b).join('\n')}`
      : '';
  const bioSourcesText = evidence.bioSources?.length
    ? `\n\nCANDIDATE BIO SOURCES from web search (snippets are usually accurate mini-bios; full page text may contain more detail):\n\n` +
      evidence.bioSources
        .map((s, i) => {
          const parts = [`[${i + 1}] ${s.url}`, `SNIPPET: ${s.snippet}`];
          if (s.pageText) parts.push(`PAGE TEXT (first ~8KB): ${s.pageText.slice(0, 8000)}`);
          return parts.join('\n');
        })
        .join('\n\n---\n\n')
    : '\n\nNo bio sources from web search.';

  const systemPrompt = `You are refining a guest entry. The original draft was generated from the model's general knowledge and may contain fabricated specifics (especially book attributions). Your job: rewrite the credibilityLine using ONLY claims that the verified evidence below supports.

Rules:
- Books: the ONLY books you may mention by title in credibilityLine are those in the "verified via Open Library" list. If the verified list is empty, do not mention any specific book titles. This applies even if you "remember" the person wrote a book — without Open Library confirmation, do not name it.
- Bio sources: you have multiple candidate web search results. Look across ALL of them and combine corroborating details. Snippets (from search results) are often accurate mini-bios written about the person — treat them as reliable. Page text may be richer but messier; extract relevant facts.
- Identity check: at least one source must clearly describe the SAME person from the episode context (matching field, plausible affiliation given the episode topic). If every source looks like a different person with a similar name, set bioMatchesGuest=false and refine using only verified books + your most certain general knowledge.
- Include notable credentials: degrees, fellowships, professional designations (CFA, board certifications), major awards (Pulitzer, Nobel, etc.), current and former significant positions. Don't leave these out if they're in the evidence.
- bioSourceUrl: cite the single most authoritative source you used (faculty page > org bio > LinkedIn > YouTube about > Doximity > Substack > etc.).
- If almost nothing is verified, credibilityLine should be short and general rather than full of guesses.`;

  const userPrompt = `Guest: ${name}

EPISODE CONTEXT (for identity verification):
- Title: ${episodeContext.title}
- Topics: ${episodeContext.topics.join(', ')}
- Episode summary: ${episodeContext.description}

ORIGINAL DRAFT (may contain hallucinations):
  credibilityLine: "${originalDraft.credibilityLine}"
  currentRole: "${originalDraft.currentRole}"

VERIFIED EVIDENCE:
${verifiedBooksText}${rejectedBooksText}${bioSourcesText}

Rewrite the entry using everything supported across the sources.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [REFINE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_refined_guest' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return tool_use for refinement');
  return toolUse.input;
}

async function verifyClaudeOnlyGuest(name, draft, episodeContext) {
  const verifiedBooks = [];
  const rejectedBooks = [];
  for (const book of draft.books || []) {
    const ok = await verifyBook(book, name);
    (ok ? verifiedBooks : rejectedBooks).push(book);
  }
  if (verifiedBooks.length) console.log(`    ✓ books verified: ${verifiedBooks.join(', ')}`);
  if (rejectedBooks.length) console.log(`    ✗ books NOT in Open Library: ${rejectedBooks.join(', ')}`);

  // Collect bio evidence from the top 3 Brave results. Each result has a
  // snippet (Brave's auto-extract — often already a usable mini-bio); we
  // also fetch the page text for the top 2. Claude sees everything and
  // picks the best source (with identity check).
  //
  // Always run a search even without primaryAffiliation — otherwise an
  // entry with no books and no affiliation skips refinement entirely and
  // the unverified Claude draft (which may hallucinate inline book titles
  // or credentials) goes to disk.
  const bioSources = [];
  const query = draft.primaryAffiliation
    ? `"${name}" ${draft.primaryAffiliation} biography`
    : `"${name}" biography profile`;
  const results = await braveSearch(query, 5);
  if (results === null) {
    console.log(`    · skipping bio search (no BRAVE_API_KEY)`);
  } else {
    for (let i = 0; i < Math.min(results.length, 3); i++) {
      const r = results[i];
      const source = { url: r.url, snippet: r.description || '', pageText: null };
      if (i < 2) {
        source.pageText = await fetchBioText(r.url);
      }
      bioSources.push(source);
    }
    if (bioSources.length) {
      console.log(`    ✓ collected ${bioSources.length} candidate bio source(s) (Claude will pick + verify)`);
    }
  }

  if (!verifiedBooks.length && !rejectedBooks.length && !bioSources.length) {
    // Nothing to refine — keep the original.
    return null;
  }

  return refineGuestWithEvidence(name, draft, episodeContext, {
    verifiedBooks,
    rejectedBooks,
    bioSources,
  });
}

async function draftGuest(name, wiki, episodeContext) {
  const systemPrompt = `You are drafting a structured guest entry for a podcast catalog. Editorial rules:
- credibilityLine: concrete facts, semicolon-separated, starting with a capital letter. No opinions, plain English.
  - INCLUDE: degrees, professional designations (CFA, board certifications, fellowships), major awards (Pulitzer, Nobel, MacArthur, etc.), current significant position with institution, notable books/works, founded companies.
  - Don't drop a major award just because it's not the episode's topic — a Pulitzer-winning historian is a Pulitzer winner regardless of which book we're discussing.
  - Don't include the host or the show.
- currentRole: their primary current role/title with institution.
- fields: short expertise labels (1-3, not more).
- roles: from the enum — academic (university faculty), researcher (working scientist/researcher), clinician (treating patients), author (published books), practitioner (industry expert without academic role), public-figure (media presence/commentator).

PRIMARY SOURCES IN ORDER OF TRUST:
1. Wikipedia summary (if provided and identity-verified) — for established public figures. Read all of it; awards and notable works are often in later sentences.
2. The YouTube description's bio paragraph — DOAC's producer wrote this, often introduces the guest with their actual credentials (employer, books, channels, Substack, etc.).
3. Your own knowledge — when 1 and 2 don't cover something AND you're confident.

WIKIPEDIA VERIFICATION:
If a Wikipedia summary is provided, FIRST verify it's about the same person who appeared in the episode context. If the summary clearly describes someone in a different field with a similar name, set wikipediaUsable=false and use the YouTube description + your knowledge instead.`;

  const contextLine = `EPISODE CONTEXT:
- Original YouTube title: "${episodeContext.originalTitle}"
- Topics: ${episodeContext.topics.join(', ')}
- Editorial summary: ${episodeContext.description}

FULL YOUTUBE DESCRIPTION (often contains the guest's actual credentials, employer, books, channels):
---
${episodeContext.youtubeDescription.slice(0, 3000)}
---`;

  const userPrompt = wiki
    ? `Draft an entry for: ${name}\n\n${contextLine}\n\nCANDIDATE WIKIPEDIA SUMMARY (verify identity match before using):\n${wiki.extract}`
    : `Draft an entry for: ${name}\n\n${contextLine}\n\nNo Wikipedia article was found. Pull credentials primarily from the YouTube description above. Set wikipediaUsable=false.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [GUEST_TOOL],
    tool_choice: { type: 'tool', name: 'submit_guest_draft' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return tool_use for guest draft');
  return toolUse.input;
}

// --- main -----------------------------------------------------------

const raw = loadJson('data/_youtube-raw.json').find((v) => v.id === VIDEO_ID);
if (!raw) throw new Error(`${VIDEO_ID} not in data/_youtube-raw.json — refresh with npm run fetch:channel?`);

const episodes = loadJson('data/episodes.json');
const guests = loadJson('data/guests.json');
const taxonomies = loadJson('data/taxonomies.json');

if (episodes.some((ep) => ep.id === `doac-${VIDEO_ID}`)) {
  console.error(`doac-${VIDEO_ID} already in episodes.json. Refusing to overwrite.`);
  process.exit(1);
}

const portrait = await ensurePortrait(VIDEO_ID);
const draft = await draftEpisode(raw, taxonomies.topics);

// Topic post-processing: Haiku occasionally violates the enum constraint
// and emits topics not in the taxonomy. Strip those out and log them as
// gap signals (alongside the explicit suggestedTopicGap field), so we
// still capture editorial intent without polluting the data.
const validTopicIds = new Set(taxonomies.topics.map((t) => t.id));
const invalidTopics = draft.topics.filter((t) => !validTopicIds.has(t));
const candidateSuggestions = [
  ...invalidTopics.map((t) => ({ source: 'hallucinated', value: t })),
  ...(draft.suggestedTopicGap ? [{ source: 'gap-field', value: draft.suggestedTopicGap }] : []),
];
for (const c of candidateSuggestions) {
  appendFileSync(
    'data/_topic-candidates.jsonl',
    JSON.stringify({
      episodeId: `doac-${VIDEO_ID}`,
      title: raw.title,
      picked: draft.topics.filter((t) => validTopicIds.has(t)),
      suggested: c.value,
      source: c.source,
      date: raw.publishedAt.slice(0, 10),
    }) + '\n'
  );
  console.log(`  ↳ topic candidate (${c.source}): "${c.value}"`);
}
draft.topics = draft.topics.filter((t) => validTopicIds.has(t));

// --- resolve guests --------------------------------------------------

console.log(`[4/6] resolving ${draft.guests.length} guest(s)…`);
const guestIdMap = {};
const episodeContext = {
  title: draft.title,
  originalTitle: raw.title,
  topics: draft.topics,
  description: draft.description,
  youtubeDescription: raw.description, // raw description has the producer-written guest bio paragraph
};
for (const g of draft.guests) {
  const existing = guests.find(
    (existing) => existing.name.toLowerCase() === g.name.toLowerCase() || existing.id === g.slug
  );
  if (existing) {
    console.log(`  ${g.name} → existing (${existing.id})`);
    guestIdMap[g.name] = existing.id;
    continue;
  }
  console.log(`  ${g.name} → looking up Wikipedia…`);
  const wiki = await wikipediaLookup(g.name);
  const guestDraft = await draftGuest(g.name, wiki, episodeContext);
  // Claude cross-checks the Wikipedia summary against the episode context;
  // if it rejects the match (similar name, different person), drop the
  // link so we don't cite a wrong article.
  const wikiLinked = wiki && guestDraft.wikipediaUsable !== false ? wiki : null;

  // For Claude-only entries (no usable Wikipedia), run external-evidence
  // verification: Open Library for book attributions, Brave Search + bio
  // page fetch for the rest. Claude does an identity re-check on the
  // fetched bio (common-name guests get matched to the wrong professional
  // — happened to Rena Malik when we hit a different Rena Malik on
  // Google Scholar). Only link bios that pass that check.
  let finalDraft = guestDraft;
  let bioLink = null;
  if (!wikiLinked) {
    console.log(`    · verifying via Open Library / org bio…`);
    const refined = await verifyClaudeOnlyGuest(g.name, guestDraft, episodeContext);
    if (refined) {
      finalDraft = { ...guestDraft, ...refined };
      // bioSourceUrl is only populated when Claude confirmed the bio is
      // about the right person.
      bioLink = refined.bioMatchesGuest && refined.bioSourceUrl ? refined.bioSourceUrl : null;
      if (refined.bioMatchesGuest === false) {
        console.log(`    ↳ Claude rejected the bio match — not linking`);
      }
    }
  }
  // Fall back to a name-derived slug if Claude omitted one despite the
  // schema requirement — defensive, in case the model regresses.
  const guestId = g.slug || slugify(g.name);
  const links = {};
  if (wikiLinked) links.wikipedia = wikiLinked.url;
  if (bioLink) links.bio = bioLink;

  // Defensive: ensure credibilityLine starts with a capital letter even if
  // the LLM forgot. Cheaper than a re-prompt.
  const credLine = finalDraft.credibilityLine || '';
  const capitalized = credLine.charAt(0).toUpperCase() + credLine.slice(1);

  const newGuest = {
    id: guestId,
    name: g.name,
    portrait: `/portraits/${guestId}.jpg`,
    portrait2x: `/portraits/${guestId}@2x.jpg`,
    portraitBrightness: portrait.brightness,
    credibilityLine: capitalized,
    fields: finalDraft.fields,
    roles: finalDraft.roles,
    credentials: [],
    currentRole: finalDraft.currentRole,
    links,
  };
  guests.push(newGuest);
  guestIdMap[g.name] = guestId;
  const wikiStatus = wikiLinked
    ? `Wikipedia: ${wikiLinked.title}`
    : wiki
      ? `Wikipedia rejected by Claude (was: ${wiki.title})`
      : 'no Wikipedia match';
  console.log(`    + ${guestId} (${wikiStatus})`);
}

// --- write portrait under the primary guest's id ---------------------

console.log(`[5/6] saving portrait files…`);
const primaryGuestId = guestIdMap[draft.guests[0].name];
mkdirSync('public/portraits', { recursive: true });
copyFileSync(portrait.portraitPath, `public/portraits/${primaryGuestId}.jpg`);
copyFileSync(portrait.portrait2xPath, `public/portraits/${primaryGuestId}@2x.jpg`);

// --- assemble episode entry -----------------------------------------

console.log(`[6/6] writing episodes.json + guests.json…`);
const fullCatalog = loadJson('data/_youtube-raw.json');
const epNum = episodeNumberFor(fullCatalog, VIDEO_ID);
const episodeEntry = {
  id: `doac-${VIDEO_ID}`,
  episodeNumber: epNum.number,
  episodeNumberSource: epNum.source,
  title: draft.title,
  originalTitle: raw.title,
  slug: draft.slug,
  date: raw.publishedAt.slice(0, 10),
  duration: durationIsoToSeconds(raw.duration),
  guestIds: draft.guests.map((g) => guestIdMap[g.name]),
  topics: draft.topics,
  description: draft.description,
  links: { youtube: `https://www.youtube.com/watch?v=${VIDEO_ID}` },
  thumbnail: `/portraits/${primaryGuestId}.jpg`,
  promotions: draft.promotions,
  sponsors: draft.sponsors,
  chapters: draft.chapters,
};

episodes.push(episodeEntry);
episodes.sort((a, b) => b.date.localeCompare(a.date));
saveJson('data/episodes.json', episodes);
saveJson('data/guests.json', guests);

console.log(`\n✓ ingested ${VIDEO_ID} as "${draft.title}" — guest(s): ${draft.guests.map((g) => g.name).join(', ')}`);
console.log(`  Review with: git diff data/episodes.json data/guests.json public/portraits/`);
