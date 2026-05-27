<script setup>
import { computed, reactive, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import episodesData from '@data/episodes.json';
import guestsData from '@data/guests.json';
import taxonomiesData from '@data/taxonomies.json';
import EpisodeCard from '@/components/EpisodeCard.vue';
import SiteHeader from '@/components/SiteHeader.vue';
import { useGridColumns } from '@/composables/useGridColumns.js';
import { useFilterContext } from '@/composables/useFilterContext.js';
import { useGuestPortrait } from '@/composables/useGuestPortrait.js';

const route = useRoute();
const slug = computed(() => route.params.slug);

// "Back to all episodes" links carry the last-seen cluster/topic filter
// from the shared composable so the user returns to the home/guests
// page with their filter context intact.
const { carryFilterQuery } = useFilterContext();
const homeLink = computed(() => ({ path: '/', query: carryFilterQuery() }));

const guestsById = Object.fromEntries(guestsData.map((g) => [g.id, g]));
const rolesById = Object.fromEntries(taxonomiesData.roles.map((r) => [r.id, r]));
const topicsById = Object.fromEntries(taxonomiesData.topics.map((t) => [t.id, t]));

// ---- TF-IDF guest vectors -----------------------------------------------
// Build once at module load (data is static JSON). Used by the similar-
// guests scoring further down. Steps:
//   1. Per-guest topic counts (TF) — how often each guest appears in an
//      episode tagged with a given topic.
//   2. Document frequency per topic — how many distinct guests cover it.
//   3. IDF = log(N / df). Common topics have low weight, rare ones high.
//   4. Final per-guest vector: topic → count × idf, plus pre-computed
//      magnitude (sqrt of sum of squares) for cheap cosine later.
function buildGuestVectors() {
  const guestCounts = new Map(); // guestId → Map<topicId, count>
  for (const ep of episodesData) {
    for (const gid of ep.guestIds) {
      if (!guestCounts.has(gid)) guestCounts.set(gid, new Map());
      const counts = guestCounts.get(gid);
      for (const t of ep.topics || []) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
  }
  const docFreq = new Map(); // topicId → number of guests covering it
  for (const counts of guestCounts.values()) {
    for (const topic of counts.keys()) {
      docFreq.set(topic, (docFreq.get(topic) || 0) + 1);
    }
  }
  const N = guestCounts.size;
  const idf = new Map();
  for (const [topic, df] of docFreq) idf.set(topic, Math.log(N / df));

  const vectors = new Map();
  for (const [gid, counts] of guestCounts) {
    const vec = new Map();
    let magSq = 0;
    for (const [topic, count] of counts) {
      const w = count * (idf.get(topic) || 0);
      if (w > 0) {
        vec.set(topic, w);
        magSq += w * w;
      }
    }
    vectors.set(gid, { vec, mag: Math.sqrt(magSq) });
  }
  return vectors;
}
const guestVectors = buildGuestVectors();

// Shared portrait resolution: primary-in-any-episode determines whether
// a guest has a showable portrait, and we use that episode's per-episode
// thumbnail in place of the canonical guest portrait.
const { guestsWithReliablePortrait, portraitOf, portrait2xOf } = useGuestPortrait();

function cosineSimilarity(a, b) {
  if (a.mag === 0 || b.mag === 0) return 0;
  // Iterate the smaller of the two maps to keep the loop tight.
  const [smaller, larger] = a.vec.size < b.vec.size ? [a.vec, b.vec] : [b.vec, a.vec];
  let dot = 0;
  for (const [topic, weight] of smaller) {
    const other = larger.get(topic);
    if (other) dot += weight * other;
  }
  return dot / (a.mag * b.mag);
}

const guest = computed(() => guestsById[slug.value] || null);

// Every episode that features this guest, sorted newest first to match
// the home grid's order. Same appearance-count math the home page does
// so the "Nth appearance" pill on each card reads correctly.
const guestEpisodes = computed(() => {
  if (!guest.value) return [];
  return episodesData
    .filter((ep) => ep.guestIds.includes(guest.value.id))
    .sort((a, b) => a.date.localeCompare(b.date)); // ascending for appearance counts
});

const displayedEpisodes = computed(() =>
  // Render newest-first, like the home grid. The asc sort above is just
  // a stable basis for the appearance index below.
  [...guestEpisodes.value].reverse()
);

function appearanceCountFor(episodeId) {
  return guestEpisodes.value.findIndex((e) => e.id === episodeId) + 1;
}

// Topic cloud: aggregate every topic across the guest's appearances
// and render in descending frequency. Pills give a quick read on what
// this person typically talks about across the catalog.
const topicCloud = computed(() => {
  const counts = {};
  for (const ep of guestEpisodes.value) {
    for (const t of ep.topics || []) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([id, count]) => ({ id, count, label: topicsById[id]?.label || id }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

// Similar guests: TF-IDF weighted cosine similarity over each guest's
// topic vector. Rare topics (covered by few guests in the catalog) carry
// more signal than common ones like "psychology", so a niche overlap
// outranks a generic one. Cosine normalizes for total appearance count,
// so prolific guests don't automatically rank higher than focused ones.
//
// The TF-IDF vectors only depend on the static JSON, so we precompute
// them once at module load and reuse across guest-page navigations.
const similarGuests = computed(() => {
  if (!guest.value) return [];
  const myVec = guestVectors.get(guest.value.id);
  if (!myVec || myVec.mag === 0) return [];
  const scores = [];
  for (const [otherId, otherVec] of guestVectors) {
    if (otherId === guest.value.id) continue;
    const sim = cosineSimilarity(myVec, otherVec);
    if (sim > 0) scores.push({ guest: guestsById[otherId], sim });
  }
  return scores
    .filter((x) => x.guest)
    .sort((a, b) => b.sim - a.sim || a.guest.name.localeCompare(b.guest.name))
    .slice(0, 5);
});

// Portrait paths in the JSON are root-absolute (`/portraits/...`); same
// BASE_URL prefix the EpisodeCard does so prod under /doac-episodes/
// resolves correctly. Used by the similar-guests strip below.
function withBase(path) {
  return path ? import.meta.env.BASE_URL + path.replace(/^\//, '') : null;
}
function relatedSrcsetJpg(g) {
  const oneX = withBase(portraitOf(g));
  const twoX = withBase(portrait2xOf(g));
  if (!oneX) return undefined;
  return twoX ? `${oneX} 1x, ${twoX} 2x` : oneX;
}

// Tracks per-guest portrait load failures (file referenced in JSON but
// missing on disk, etc.) so we can swap in the initials fallback once
// the browser surfaces an error. Reactive map keyed by guest id.
const portraitErrors = reactive({});

function initialsOf(name) {
  if (!name) return '';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const firstAppearance = computed(() => guestEpisodes.value[0]?.date);

// Total catalog size for the "Browse all episodes" CTA at the bottom of
// the page. Constant; computed once.
const totalEpisodeCount = episodesData.length;

// Sticky-header reveal once the user has scrolled past the profile block,
// same hook the home page uses.
// SiteHeader stays visible at all times on the guest page so the user
// always has a route-home shortcut and a visual anchor for where they
// are; no reveal-on-scroll behavior here (unlike HomePage where the big
// brand wordmark is the entry point).

// Filler tiles for the last grid row when the appearance count doesn't
// divide evenly into the current column count (the common case for
// recurring guests with odd appearance counts like Steven's 4 solos).
const { columns: gridColumns } = useGridColumns();
const fillerCount = computed(() => {
  if (gridColumns.value <= 1) return 0;
  const remainder = displayedEpisodes.value.length % gridColumns.value;
  return remainder === 0 ? 0 : gridColumns.value - remainder;
});
</script>

<template>
  <main>
    <SiteHeader :visible="true" />

    <div v-if="!guest" class="not-found">
      <p>No guest with id <code>{{ slug }}</code>.</p>
      <RouterLink to="/" class="back-link">← Back to all episodes</RouterLink>
    </div>

    <template v-else>
      <section class="profile">
        <div class="profile-col">
          <RouterLink :to="homeLink" class="back-pill">← All episodes</RouterLink>
          <h1 class="profile-name">{{ guest.name }}</h1>
          <p v-if="guest.credibilityLine" class="profile-bio">
            {{ guest.credibilityLine }}
          </p>
          <p class="profile-stats">
            <span class="profile-stat-count">{{ guestEpisodes.length }}</span>
            {{ guestEpisodes.length === 1 ? 'appearance' : 'appearances' }}
            <template v-if="firstAppearance">
              <span class="profile-stat-sep">·</span>
              first one {{ fmtDate(firstAppearance) }}
            </template>
          </p>
          <ul v-if="topicCloud.length" class="topic-cloud" aria-label="Topics this guest covers">
            <li v-for="t in topicCloud.slice(0, 5)" :key="t.id" class="topic-cloud-pill-wrap">
              <RouterLink :to="`/?topic=${t.id}`" class="topic-cloud-pill">
                {{ t.label }}<span v-if="t.count > 1" class="topic-cloud-count">{{ t.count }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="similarGuests.length" class="related">
        <h2 class="related-title">Similar guests</h2>
        <ul class="related-list">
          <li v-for="r in similarGuests" :key="r.guest.id" class="related-item">
            <RouterLink :to="`/guest/${r.guest.id}`" class="related-link">
              <img
                v-if="guestsWithReliablePortrait.has(r.guest.id) && !portraitErrors[r.guest.id]"
                :src="withBase(portraitOf(r.guest))"
                :srcset="relatedSrcsetJpg(r.guest)"
                :alt="r.guest.name"
                class="related-portrait"
                width="72"
                height="72"
                @error="portraitErrors[r.guest.id] = true"
              />
              <div v-else class="related-portrait related-portrait-fallback" aria-hidden="true">
                {{ initialsOf(r.guest.name) }}
              </div>
              <span class="related-name">{{ r.guest.name }}</span>
            </RouterLink>
          </li>
          <!-- "See all guests" sits at the end of the similar-guests
               strip like another guest, so the lateral motion stays
               aligned with the rest of the row. -->
          <li class="related-item related-item-all">
            <RouterLink to="/guests" class="related-all-pill">
              See all guests <span aria-hidden="true">→</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="grid">
        <div
          v-for="(ep, i) in displayedEpisodes"
          :key="ep.id"
          class="card-slot"
          :class="{ 'is-stagger-target': i < 8 }"
          :style="{ '--slot-index': i }"
        >
          <EpisodeCard
            :episode="ep"
            :guests="ep.guestIds.map((id) => guestsById[id])"
            :appearance-counts="ep.guestIds.map((id) =>
              id === guest.id ? appearanceCountFor(ep.id) : 1
            )"
            :roles-by-id="rolesById"
            :topics-by-id="topicsById"
          />
        </div>
        <!-- Round out the last row with placeholder tiles when the
             appearance count doesn't divide evenly into the column
             count (common for solo or 3-time recurring guests). -->
        <div
          v-for="n in fillerCount"
          :key="`filler-${n}`"
          class="card-slot filler-slot"
          aria-hidden="true"
        >
          <div class="filler-card"></div>
        </div>
      </section>

      <div class="back-to-all-wrapper">
        <RouterLink :to="homeLink" class="back-to-all-button">
          <span aria-hidden="true">←</span>
          Browse all episodes
          <span class="back-to-all-count">{{ totalEpisodeCount }} total</span>
        </RouterLink>
      </div>
    </template>
  </main>
</template>

<style scoped>
main {
  min-height: 100vh;
  /* Top padding has a higher floor than the home page (5rem vs 2.5rem)
     so the profile clears the always-visible SiteHeader (~3.5rem tall)
     with breathing room. Horizontal padding matches the home page. */
  padding: clamp(5rem, 5vw, 6rem) 4rem 4rem;
}

@media (max-width: 899px) {
  main {
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
}

.not-found {
  max-width: 30rem;
  margin: 6rem auto;
  text-align: center;
  color: #bcb29e;
}

.not-found code {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  background: rgba(245, 236, 214, 0.09);
  padding: 0.125rem 0.4rem;
  border-radius: 4px;
  color: #f5ecd6;
}

.back-link {
  display: inline-block;
  margin-top: 1rem;
  color: #c89968;
  text-decoration: none;
}

/* Profile block: mirrors the .grid layout below so .profile-col occupies
   exactly one grid column. That keeps the profile content's right edge
   in step with the card grid's left column, regardless of breakpoint
   (1-col mobile / 2-col 1200+ / 3-col 1921+). */
.profile {
  max-width: 110rem;
  margin: 1.5rem auto 3rem;
  padding-bottom: 3rem;
  border-bottom: 1px solid rgba(245, 236, 214, 0.1);
  display: grid;
  grid-template-columns: 1fr;
  column-gap: 4rem;
}

@media (min-width: 1200px) {
  .profile { grid-template-columns: 1fr 1fr; }
}

@media (min-width: 1921px) {
  .profile { grid-template-columns: 1fr 1fr 1fr; }
}

.profile-col {
  grid-column: 1;
}

/* Small pill link back to the home grid. Same visual family as the
   topic-pill/cluster-item style so it reads as part of the navigation
   vocabulary, not a one-off button. */
.back-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  background: transparent;
  border: 1px solid rgba(245, 236, 214, 0.22);
  color: #d4c9ad;
  padding: 0.45rem 0.875rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
  text-decoration: none;
  margin-bottom: 1.5rem;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.back-pill:hover {
  border-color: #c89968;
  color: #f5ecd6;
  background: rgba(245, 236, 214, 0.04);
}

.profile-name {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0 0 0.75rem;
  color: #f5ecd6;
  line-height: 1.1;
}

.profile-bio {
  font-size: 1rem;
  line-height: 1.55;
  color: #d4c9ad;
  margin: 0 0 1rem;
}

.profile-stats {
  font-size: 0.875rem;
  color: #8c8676;
  letter-spacing: 0.01em;
  margin: 0;
}

.profile-stat-count {
  color: #c89968;
  font-weight: 600;
}

.profile-stat-sep {
  margin: 0 0.5rem;
  opacity: 0.6;
}

/* Topic cloud: aggregated topic pills sorted by frequency. Same visual
   language as the home page's topic-pill on each card, but inert (these
   aren't filter triggers, just descriptive). A small count badge appears
   when a topic shows up more than once across the guest's appearances. */
.topic-cloud {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.topic-cloud-pill-wrap {
  /* RouterLinks default to inline; keep the inline-flex pill the same
     shape it had as a <li> so the wrap doesn't break the layout. */
  display: inline-block;
}

.topic-cloud-pill {
  background: transparent;
  border: 1px solid rgba(245, 236, 214, 0.22);
  color: #d4c9ad;
  padding: 0.35rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.01em;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  text-decoration: none;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.topic-cloud-pill:hover {
  border-color: #c89968;
  color: #f5ecd6;
}

.topic-cloud-count {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #c89968;
  background: rgba(200, 153, 104, 0.12);
  padding: 0 0.4rem;
  border-radius: 9999px;
  line-height: 1.35;
}

/* Similar guests strip: small circular portraits + names, sorted by
   topic overlap with the current guest. Sits between the profile and
   the episode grid, capped at the grid's max width so it lines up
   horizontally. */
.related {
  max-width: 110rem;
  margin: 0 auto 3rem;
  padding-bottom: 3rem;
  border-bottom: 1px solid rgba(245, 236, 214, 0.1);
}

.related-title {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #8c8676;
  margin: 0 0 1.25rem;
}

/* "See all guests" pill sits inline at the end of the similar-list
   strip. Centered against the portrait row (72px tall) rather than the
   full guest column (portrait + name), so it visually pairs with the
   round photos beside it. */
.related-item-all {
  display: flex;
  align-items: center;
  height: 72px;
  align-self: flex-start;
}

.related-all-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1.125rem;
  background: rgba(245, 236, 214, 0.07);
  border: 1px solid rgba(245, 236, 214, 0.12);
  border-radius: 9999px;
  color: #d4c9ad;
  text-decoration: none;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.related-all-pill:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.09);
  color: #f5ecd6;
}

.related-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem 2rem;
}

.related-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 88px;
  text-decoration: none;
  color: #d4c9ad;
  transition: color 0.15s ease;
}

.related-link:hover {
  color: #f5ecd6;
}

.related-portrait {
  display: block;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  background: #110e0b;
  /* Gold ring on hover via outline so it doesn't reflow neighbors. */
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition: outline-color 0.15s ease;
}

/* Fallback circle for guests with no portrait on disk: dim cream disk
   with their initials in the center so the row still reads coherently
   instead of dropping a blank spot or a broken-image icon. */
.related-portrait-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 236, 214, 0.07);
  color: #8c8676;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.related-link:hover .related-portrait {
  outline-color: #c89968;
}

.related-name {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-align: center;
  line-height: 1.25;
  /* Wrap long names onto a second line instead of overflowing. */
  word-break: break-word;
}

@media (max-width: 640px) {
  .profile {
    margin: 0.5rem auto 2.5rem;
  }
  .profile-name {
    font-size: 2rem;
  }
}

/* Grid: matches HomePage's grid layout so the card sizing/stagger feel
   consistent across the two pages. */
.grid {
  max-width: 110rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 4rem;
  position: relative;
}

.card-slot {
  position: relative;
  display: grid;
}

@keyframes card-stagger-in {
  from { transform: translateY(20px); }
  to { transform: translateY(0); }
}

.card-slot.is-stagger-target {
  animation: card-stagger-in 0.5s ease both;
  animation-delay: calc(var(--slot-index, 0) * 0.07s);
}

/* Placeholder tile for last-row gaps. See HomePage for the rationale;
   the filler matches the .card surface tint and adds faint horizontal
   lines so the row reads as visually complete instead of trailing off. */
.filler-card {
  height: 100%;
  min-height: 14rem;
  border-radius: 8px;
  background-color: rgba(245, 236, 214, 0.06);
  /* Thick diagonal stripes (45deg, 1.25rem stripe + 1.25rem gap, low
     alpha) — see HomePage for the design intent. */
  background-image: repeating-linear-gradient(
    45deg,
    rgba(245, 236, 214, 0.02) 0,
    rgba(245, 236, 214, 0.02) 1.25rem,
    transparent 1.25rem,
    transparent 2.5rem
  );
}

.card-slot:nth-child(n+2)::before {
  content: '';
  position: absolute;
  top: -2rem;
  left: 0;
  right: 0;
  border-top: 1px solid rgba(245, 236, 214, 0.1);
  pointer-events: none;
}

@media (min-width: 1200px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
  .card-slot:nth-child(2)::before {
    display: none;
  }
}

@media (min-width: 1921px) {
  .grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .card-slot:nth-child(3)::before {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card-slot.is-stagger-target {
    animation: none;
  }
}

/* "Browse all episodes" CTA below the grid. Mirrors the home page's
   load-more pill so the two pages share the same end-of-list visual
   pattern — a quiet pill, gold hover edge, secondary count badge. */
.back-to-all-wrapper {
  max-width: 110rem;
  margin: 4rem auto 0;
  display: flex;
  justify-content: center;
}

.back-to-all-button {
  background: rgba(245, 236, 214, 0.07);
  border: 1px solid rgba(245, 236, 214, 0.12);
  color: #f5ecd6;
  padding: 0.875rem 2rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.back-to-all-button:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.09);
}

.back-to-all-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

.back-to-all-count {
  font-size: 0.8125rem;
  font-weight: 400;
  color: #bcb29e;
}
</style>
