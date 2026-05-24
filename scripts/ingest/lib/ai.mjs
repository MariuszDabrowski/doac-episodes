// Claude calls used by the ingestion pipeline. Three drafting stages:
//   1. draftEpisode    - rewritten title/description/topics/chapters/etc.
//   2. draftGuest      - guest credibilityLine from Wikipedia + YouTube blurb
//   3. verifyClaudeOnlyGuest - for guests without a Wikipedia match, refine
//      using Open Library + Brave-fetched bio pages to scrub hallucinations
//
// Each stage uses tool_use with an enforced JSON schema, so the response is
// always structured.
//
// dotenv runs first so the module-level ANTHROPIC_API_KEY check below sees
// the value. ESM hoists imports above statements like `dotenv.config()` in
// the entry script, so loading dotenv here is the safe place.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { braveSearch, fetchBioText, verifyBook } from './enrichment.mjs';

const MODEL = 'claude-haiku-4-5-20251001';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY missing, set it in .env');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- episode draft --------------------------------------------------

const EPISODE_TOOL = {
  name: 'submit_episode_draft',
  description: 'Submit the structured episode draft.',
  input_schema: {
    type: 'object',
    required: ['title', 'description', 'topics', 'slug', 'guests', 'chapters', 'promotions', 'sponsors'],
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
        description: 'Chapters from the YouTube description\'s timestamped TOC. Empty array if none.',
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
                'True if the sponsor\'s product overlaps the episode subject (e.g. a supplement company on a longevity episode). Editorial signal, be specific.',
            },
          },
        },
        description: 'Paid sponsors from the description\'s "Sponsors:" block. Empty array if none.',
      },
      suggestedTopicGap: {
        type: ['string', 'null'],
        description:
          'OPTIONAL signal: if the controlled taxonomy is genuinely missing a topic that would fit this episode much better than any existing one, suggest a short kebab-case slug (e.g. "science", "history", "spirituality"). Be conservative, only fill when the existing list clearly does not cover the episode. Null otherwise.',
      },
    },
  },
};

export async function draftEpisode(raw, topicsTaxonomy) {
  console.log(`[3/6] drafting episode (Claude ${MODEL})…`);
  const topicList = topicsTaxonomy
    .map((t) => `${t.id}, ${t.label}: ${t.synonyms?.join(', ') || ''}`)
    .join('\n');

  // Clone the schema so we can patch the topics enum to the actual taxonomy
  // IDs. Without this, Claude invents topics like "health" or "technology"
  // even when the prompt says to pick from the list.
  const tool = JSON.parse(JSON.stringify(EPISODE_TOOL));
  tool.input_schema.properties.topics.items.enum = topicsTaxonomy.map((t) => t.id);

  const systemPrompt = `You are drafting structured episode metadata for "The Diary of a CEO" podcast catalog. Follow these editorial rules from the project brief:

- TITLE: topical headline, 3-7 words. Says what the episode is *about*. Strip clickbait, exclamation, sensationalism. The original YouTube title goes into "originalTitle", your "title" must be different and editorially clean.
- DESCRIPTION: 15-25 words. Says what gets *covered* in the episode. Mentions the guest by last name. Plain, factual, never promotional. No marketing voice.
- TOPICS: pick 1-3 from the controlled taxonomy. Most-representative first. Don't add new topics.
- SLUG: {guest-last-name}-{topic-phrase}, kebab-case.
- GUESTS: detect from the original title. For multi-guest episodes, include all.
- CHAPTERS: extract from the description's timestamped TOC if present.
- PROMOTIONS: the GUEST's books, products, courses, companies they're plugging, NOT generic social links (Twitter, Instagram follow) and NOT the host's own merch (DOAC book, DOAC Circle, 1% Diary, etc.).
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

// --- guest draft ----------------------------------------------------

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
        description: 'Areas of expertise, short labels like "genetics", "neuroscience", "business", "psychology".',
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
          'Set true if a Wikipedia summary was provided AND it describes the same person who appeared on this episode (cross-check against the episode context). Set false if Wikipedia was provided but is clearly about a different person with a similar name. Set false if no Wikipedia was provided. Be strict, a urologist guest with a Wikipedia article about an ambient music producer is NOT a match.',
      },
      books: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Books authored by the guest (titles only, no subtitle). These will be verified against Open Library before being kept in the final entry, feel free to include any you think are theirs.',
      },
      primaryAffiliation: {
        type: ['string', 'null'],
        description:
          'The single most specific organization the guest is currently affiliated with (e.g. "PWL Capital", "Stanford School of Medicine"). Used to search the org\'s site for their official bio. Null if independent / no clear org.',
      },
    },
  },
};

export async function draftGuest(name, wiki, episodeContext) {
  const systemPrompt = `You are drafting a structured guest entry for a podcast catalog. Editorial rules:
- credibilityLine: concrete facts, semicolon-separated, starting with a capital letter. No opinions, plain English.
  - INCLUDE: degrees, professional designations (CFA, board certifications, fellowships), major awards (Pulitzer, Nobel, MacArthur, etc.), current significant position with institution, notable books/works, founded companies.
  - Don't drop a major award just because it's not the episode's topic, a Pulitzer-winning historian is a Pulitzer winner regardless of which book we're discussing.
  - Don't include the host or the show.
- currentRole: their primary current role/title with institution.
- fields: short expertise labels (1-3, not more).
- roles: from the enum, academic (university faculty), researcher (working scientist/researcher), clinician (treating patients), author (published books), practitioner (industry expert without academic role), public-figure (media presence/commentator).

PRIMARY SOURCES IN ORDER OF TRUST:
1. Wikipedia summary (if provided and identity-verified), for established public figures. Read all of it; awards and notable works are often in later sentences.
2. The YouTube description's bio paragraph, DOAC's producer wrote this, often introduces the guest with their actual credentials (employer, books, channels, Substack, etc.).
3. Your own knowledge, when 1 and 2 don't cover something AND you're confident.

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

// --- guest refinement (no-Wikipedia path) ---------------------------

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
          'Refined credibilityLine using ONLY claims that the verified evidence supports. Drop any unverified specific claims (books, awards, founded companies, positions). If almost nothing was verified, keep this short, better a 5-word credible line than 30 words of guesses.',
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
          'Set true ONLY if the fetched bio clearly describes the same person who appeared on this episode (cross-check name + field against the episode context). Set false if the bio is about a different person with a similar name, or if no bio was provided. Common-name guests often get matched to the wrong professional, be strict.',
      },
      bioSourceUrl: {
        type: ['string', 'null'],
        description:
          'URL of the authoritative bio page used, ONLY set this if bioMatchesGuest is true. Null otherwise.',
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
      ? `\n\nBooks Claude originally claimed that Open Library did NOT confirm, DO NOT include these in the refined line:\n${evidence.rejectedBooks.map((b) => '  - ' + b).join('\n')}`
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
- Books: the ONLY books you may mention by title in credibilityLine are those in the "verified via Open Library" list. If the verified list is empty, do not mention any specific book titles. This applies even if you "remember" the person wrote a book, without Open Library confirmation, do not name it.
- Bio sources: you have multiple candidate web search results. Look across ALL of them and combine corroborating details. Snippets (from search results) are often accurate mini-bios written about the person, treat them as reliable. Page text may be richer but messier; extract relevant facts.
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

/**
 * For guests without a usable Wikipedia match, do external-evidence
 * verification: Open Library for book attributions, Brave Search + bio-page
 * fetch for the rest. Claude does an identity re-check on the fetched bio.
 * Returns refined fields to merge into the draft, or null if there's nothing
 * to verify against (no books and no Brave key).
 */
export async function verifyClaudeOnlyGuest(name, draft, episodeContext) {
  const verifiedBooks = [];
  const rejectedBooks = [];
  for (const book of draft.books || []) {
    const ok = await verifyBook(book, name);
    (ok ? verifiedBooks : rejectedBooks).push(book);
  }
  if (verifiedBooks.length) console.log(`    ✓ books verified: ${verifiedBooks.join(', ')}`);
  if (rejectedBooks.length) console.log(`    ✗ books NOT in Open Library: ${rejectedBooks.join(', ')}`);

  // Collect bio evidence from the top Brave results. Each result has a
  // snippet (often a usable mini-bio); we also fetch full page text for the
  // top 2. Claude picks the best source and does an identity re-check.
  //
  // Always run a search even without primaryAffiliation. Otherwise a guest
  // with no books and no affiliation skips refinement entirely and the
  // unverified Claude draft (which may hallucinate book titles or
  // credentials) goes to disk.
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
      if (i < 2) source.pageText = await fetchBioText(r.url);
      bioSources.push(source);
    }
    if (bioSources.length) {
      console.log(`    ✓ collected ${bioSources.length} candidate bio source(s) (Claude will pick + verify)`);
    }
  }

  if (!verifiedBooks.length && !rejectedBooks.length && !bioSources.length) {
    // Nothing to refine, keep the original.
    return null;
  }

  return refineGuestWithEvidence(name, draft, episodeContext, {
    verifiedBooks,
    rejectedBooks,
    bioSources,
  });
}
