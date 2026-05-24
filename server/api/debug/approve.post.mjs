import { readFile, writeFile } from 'node:fs/promises';
import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const { id, status } = await readBody(event);
  if (!id || !['good', 'pending'].includes(status)) {
    throw createError({ statusCode: 400, message: 'invalid id/status' });
  }
  let review = {};
  try {
    review = JSON.parse(await readFile('data/_portrait-review.json', 'utf8'));
  } catch {}
  if (status === 'pending') {
    delete review[id];
  } else {
    review[id] = status;
  }
  await writeFile('data/_portrait-review.json', JSON.stringify(review, null, 2) + '\n');
  return { ok: true, status };
});
