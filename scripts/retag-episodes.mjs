#!/usr/bin/env node
/**
 * Re-pick `topics` for existing episodes using the current taxonomy.
 * Useful after promoting new topics from data/_topic-candidates.jsonl:
 * the new options become available and previously-stretched picks can be
 * refined.
 *
 * Touches ONLY the `topics` field. Title, description, guests, chapters,
 * promotions, sponsors, etc. are left as-is. Re-runs ~$0.005/episode in
 * Claude API costs.
 *
 * Usage:
 *   node scripts/retag-episodes.mjs              # all episodes
 *   node scripts/retag-episodes.mjs --dry-run    # show diff without writing
 *   node scripts/retag-episodes.mjs <videoId>... # only specified IDs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const MODEL = 'claude-haiku-4-5-20251001';
const DRY_RUN = process.argv.includes('--dry-run');
const targetIds = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY missing — set it in .env');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const episodes = JSON.parse(readFileSync('data/episodes.json', 'utf8'));
const catalog = JSON.parse(readFileSync('data/_youtube-raw.json', 'utf8'));
const taxonomies = JSON.parse(readFileSync('data/taxonomies.json', 'utf8'));
const validTopicIds = new Set(taxonomies.topics.map((t) => t.id));

const TOPIC_TOOL = {
  name: 'submit_topics',
  description: 'Submit the picked topic IDs (1-3) plus an optional gap suggestion.',
  input_schema: {
    type: 'object',
    required: ['topics'],
    properties: {
      topics: {
        type: 'array',
        items: { type: 'string', enum: taxonomies.topics.map((t) => t.id) },
        description: 'Pick 1-3 most representative topic IDs from the controlled taxonomy.',
      },
      suggestedTopicGap: {
        type: ['string', 'null'],
        description:
          'OPTIONAL: if the taxonomy is still missing a clearly-better topic, suggest a kebab-case slug. Null otherwise.',
      },
    },
  },
};

async function pickTopics(ep, raw) {
  const topicList = taxonomies.topics.map((t) => `${t.id} — ${t.label}`).join('\n');
  const systemPrompt = `You are picking topics for a podcast episode from a controlled taxonomy. Pick 1-3 most representative IDs, most-representative first. If a clearly-better topic is missing, fill suggestedTopicGap.

Available topics:
${topicList}`;
  const userPrompt = `Episode: ${ep.title}
Original YouTube title: ${raw?.title || ep.originalTitle}
Description: ${ep.description}
Guests: ${ep.guestIds.join(', ')}

YouTube description (first 2KB for context):
---
${(raw?.description || '').slice(0, 2000)}
---

Pick the topics.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [TOPIC_TOOL],
    tool_choice: { type: 'tool', name: 'submit_topics' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return tool_use');
  return toolUse.input;
}

const toProcess = targetIds.length
  ? episodes.filter((e) => targetIds.some((id) => e.id.endsWith(id)))
  : episodes;

console.log(`Re-tagging ${toProcess.length} episode(s)…\n`);

let changed = 0;
for (const ep of toProcess) {
  const vid = ep.id.replace(/^doac-/, '');
  const raw = catalog.find((v) => v.id === vid);
  try {
    const { topics, suggestedTopicGap } = await pickTopics(ep, raw);
    const cleaned = topics.filter((t) => validTopicIds.has(t));
    if (JSON.stringify(cleaned) !== JSON.stringify(ep.topics)) {
      console.log(`  ${vid}  was=${JSON.stringify(ep.topics)}  now=${JSON.stringify(cleaned)}  · ${ep.title.slice(0, 50)}`);
      if (!DRY_RUN) ep.topics = cleaned;
      changed += 1;
    }
    if (suggestedTopicGap) {
      console.log(`    ↳ still wants: "${suggestedTopicGap}"`);
      if (!DRY_RUN) {
        appendFileSync(
          'data/_topic-candidates.jsonl',
          JSON.stringify({
            episodeId: ep.id,
            title: ep.title,
            picked: cleaned,
            suggested: suggestedTopicGap,
            source: 'retag',
            date: ep.date,
          }) + '\n'
        );
      }
    }
  } catch (err) {
    console.log(`  ${vid}  FAILED: ${err.message}`);
  }
}

if (DRY_RUN) {
  console.log(`\n${changed} episode(s) would be updated (dry-run).`);
} else if (changed) {
  episodes.sort((a, b) => b.date.localeCompare(a.date));
  writeFileSync('data/episodes.json', JSON.stringify(episodes, null, 2) + '\n');
  console.log(`\n${changed} episode(s) updated in data/episodes.json.`);
} else {
  console.log('\nNo changes needed.');
}
