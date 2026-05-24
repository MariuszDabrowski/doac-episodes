// External-data lookups used to enrich guest entries:
//   - Wikipedia (article summary + extracts) for established public figures
//   - Open Library for book attribution verification
//   - Brave Search for org/personal bio pages
//   - HTML-stripped page fetcher feeding bio text into Claude refinement

const WIKI_UA = 'doac-ingest/1.0 (contact wayrse@gmail.com)';

async function wikipediaFetch(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': WIKI_UA } });
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

/**
 * Avoid trusting Wikipedia matches for someone with a totally different name
 * (e.g. "Ben Felix" → "Ben Jochum"). Require the article title to contain at
 * least one significant word from the search query, ignoring honorifics.
 * Conservative on purpose: false negatives are fine (we just skip Wikipedia
 * for that guest), false positives would cite wrong biographical facts.
 */
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

  // AND the article's last token must appear in the search. Catches
  // "Ben Felix" → "Ben Felix Jochum" (article has an extra surname
  // "Jochum" that's not in the query, so it's about a different person).
  const articleSurname = articleTokens[articleTokens.length - 1];
  if (!searchTokens.includes(articleSurname)) return false;

  return true;
}

/**
 * Look up a guest on Wikipedia. Returns `{ title, extract, url, wikidataId }`
 * on a confident match, or `null` if no article exists, the article is a
 * disambiguation page, or the title surname mismatches the search.
 */
export async function wikipediaLookup(name) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&namespace=0&format=json`;
    const searchRes = await wikipediaFetch(searchUrl);
    const articleTitle = searchRes?.[1]?.[0];
    if (!articleTitle) return null;
    if (!nameMatchesArticle(name, articleTitle)) {
      console.log(`    ↳ wikipedia returned "${articleTitle}", surname mismatch with "${name}", skipping`);
      return null;
    }
    // First grab the short summary to check identity (its `type` field
    // catches disambiguations) and re-validate after any redirect. Then
    // fetch a richer extract via the MediaWiki `extracts` API; the REST
    // summary's first 3 sentences miss things like "Pulitzer winner",
    // which usually sit further into the article.
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle.replace(/ /g, '_'))}`;
    const summary = await wikipediaFetch(summaryUrl);
    if (!summary || summary.type === 'disambiguation') return null;
    if (!nameMatchesArticle(name, summary.title)) {
      console.log(`    ↳ wikipedia redirected to "${summary.title}", surname mismatch, skipping`);
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

/**
 * Open Library check for a (title, author) pair. Free, no key, no aggressive
 * rate limit. Google Books has a 1000/day unauthenticated quota that runs
 * out fast in batches; Open Library handles bulk fine.
 */
export async function verifyBook(title, authorName) {
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

/**
 * Brave web search wrapper. Returns the result array or null if the API key
 * is missing or the request fails.
 */
export async function braveSearch(query, count = 3) {
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

/**
 * Fetch a candidate bio page and strip HTML. Crude but Claude's good at
 * pulling structured info from cluttered text. Capped at 8KB so it doesn't
 * blow Claude's context on huge pages.
 */
export async function fetchBioText(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': WIKI_UA } });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 8000);
  } catch {
    return null;
  }
}
