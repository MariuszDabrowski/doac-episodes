<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import episodesData from '@data/episodes.json';
import guestsData from '@data/guests.json';
import taxonomiesData from '@data/taxonomies.json';
import EpisodeCard from '@/components/EpisodeCard.vue';
import BaseModal from '@/components/BaseModal.vue';
import SiteHeader from '@/components/SiteHeader.vue';
import FilterBar from '@/components/FilterBar.vue';
import { useHeaderReveal } from '@/composables/useHeaderReveal.js';
import { usePagination } from '@/composables/usePagination.js';

const guestsById = Object.fromEntries(guestsData.map((g) => [g.id, g]));
const rolesById = Object.fromEntries(taxonomiesData.roles.map((r) => [r.id, r]));
const topicsById = Object.fromEntries(taxonomiesData.topics.map((t) => [t.id, t]));
const clusters = [
  { id: 'all', label: 'All' },
  ...taxonomiesData.clusters,
];

const topicsByCluster = Object.fromEntries(
  taxonomiesData.clusters.map((c) => [
    c.id,
    taxonomiesData.topics.filter((t) => t.cluster === c.id).map((t) => t.id),
  ])
);

function appearanceCountFor(guestId, episodeId) {
  const guestEpisodes = episodesData
    .filter((e) => e.guestIds.includes(guestId))
    .sort((a, b) => a.date.localeCompare(b.date));
  return guestEpisodes.findIndex((e) => e.id === episodeId) + 1;
}

// Filter state. UI (cluster pills + subtopic transitions) lives in FilterBar;
// this page owns the canonical values and the derived filtering logic.
const activeCluster = ref('all');
const activeSubtopic = ref(null);
const searchQuery = ref('');

const filteredEpisodes = computed(() => {
  let list = episodesData;

  if (activeCluster.value !== 'all') {
    const allowed = topicsByCluster[activeCluster.value] || [];
    list = list.filter((ep) => ep.topics.some((t) => allowed.includes(t)));
  }

  if (activeSubtopic.value) {
    list = list.filter((ep) => ep.topics.includes(activeSubtopic.value));
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((ep) => {
      if (ep.title.toLowerCase().includes(q)) return true;
      if (ep.description?.toLowerCase().includes(q)) return true;
      if (ep.originalTitle?.toLowerCase().includes(q)) return true;
      return ep.guestIds.some((id) => {
        const g = guestsById[id];
        if (!g) return false;
        if (g.name.toLowerCase().includes(q)) return true;
        if (g.credibilityLine?.toLowerCase().includes(q)) return true;
        return false;
      });
    });
  }

  return [...list].sort((a, b) => b.date.localeCompare(a.date));
});

// Key for the whole grid: changes whenever the filter changes, so Vue's
// Transition (mode="out-in") fades the old grid out and the new one in.
const filterStateKey = computed(() =>
  `${activeCluster.value}|${activeSubtopic.value ?? ''}|${searchQuery.value.trim()}`
);

// Paginate the result set. At ~500 episodes, rendering all of them up
// front would mean thousands of DOM nodes and a Vue diff for every filter
// change. The page size also acts as a UX nudge: if the user is hunting,
// they should be filtering, not scrolling.
const {
  displayed: displayedEpisodes,
  remaining: remainingCount,
  hasMore,
  staggerStart: staggerStartIndex,
  loadMore,
} = usePagination(filteredEpisodes, filterStateKey, 50);

const resultSummary = computed(() => {
  const n = filteredEpisodes.value.length;
  const word = n === 1 ? 'episode' : 'episodes';
  const parts = [
    { text: String(n), bold: true },
    { text: ` ${word}`, bold: false },
  ];
  if (activeCluster.value !== 'all') {
    const c = clusters.find((c) => c.id === activeCluster.value);
    if (c) {
      parts.push({ text: ' in ', bold: false });
      parts.push({ text: c.label, bold: true });
    }
  }
  if (activeSubtopic.value) {
    const t = taxonomiesData.topics.find((t) => t.id === activeSubtopic.value);
    if (t) {
      parts.push({ text: ' tagged ', bold: false });
      parts.push({ text: t.label, bold: true });
    }
  }
  const q = searchQuery.value.trim();
  if (q) {
    parts.push({ text: ' matching ', bold: false });
    parts.push({ text: `"${q}"`, bold: true });
  }
  return parts;
});

// When the result set changes while the user is scrolled deep, the page
// can suddenly become shorter than their scrollY, and the browser snaps
// them to the new max scroll. That feels jarring (especially for 0-result
// searches where the page collapses to viewport height). Pre-empt it by
// smooth-scrolling to the top ourselves, so the motion is controlled.
// Pagination reset is handled by usePagination's own watcher.
watch(filterStateKey, () => {
  if (typeof window === 'undefined') return;
  if (window.scrollY > 100) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// Modal state. Focus trap + Escape close live inside BaseModal.
const aboutOpen = ref(false);
const funFactsOpen = ref(false);

// Pre-compute catalog stats once, surfaced in the Fun facts modal.
const funFactsStats = computed(() => {
  const appearancesByGuest = {};
  const topicCounts = {};
  const clusterEpisodes = {};
  let totalSeconds = 0;

  for (const ep of episodesData) {
    totalSeconds += ep.duration || 0;
    for (const id of ep.guestIds) {
      appearancesByGuest[id] = (appearancesByGuest[id] || 0) + 1;
    }
    const seenClusters = new Set();
    for (const tid of ep.topics) {
      topicCounts[tid] = (topicCounts[tid] || 0) + 1;
      const cluster = topicsById[tid]?.cluster;
      if (cluster && !seenClusters.has(cluster)) {
        clusterEpisodes[cluster] = (clusterEpisodes[cluster] || 0) + 1;
        seenClusters.add(cluster);
      }
    }
  }

  const topGuest = Object.entries(appearancesByGuest)
    .sort((a, b) => b[1] - a[1])[0];
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, count]) => ({ label: topicsById[id]?.label || id, count }));
  const topCluster = Object.entries(clusterEpisodes)
    .sort((a, b) => b[1] - a[1])[0];
  const topClusterLabel = topCluster
    ? clusters.find((c) => c.id === topCluster[0])?.label
    : null;

  return {
    totalEpisodes: episodesData.length,
    totalGuests: Object.keys(appearancesByGuest).length,
    totalHours: Math.round(totalSeconds / 3600),
    topGuest: topGuest
      ? { name: guestsById[topGuest[0]]?.name || topGuest[0], count: topGuest[1] }
      : null,
    topTopics,
    topCluster: topCluster ? { label: topClusterLabel, count: topCluster[1] } : null,
  };
});

// Sticky mini-header appears once the results bar has scrolled past.
const resultsBarEl = ref(null);
const { showHeader } = useHeaderReveal(resultsBarEl);

// Tag <body> with .is-scrolling for a short window after each scroll.
// CSS uses this to suppress hover-triggered effects (e.g. credibility
// expand) while the cursor passes over cards involuntarily during scroll.
let scrollSuppressTimer = null;
function onScrollSuppress() {
  document.body.classList.add('is-scrolling');
  clearTimeout(scrollSuppressTimer);
  scrollSuppressTimer = setTimeout(() => {
    document.body.classList.remove('is-scrolling');
  }, 150);
}

onMounted(() => {
  window.addEventListener('scroll', onScrollSuppress, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScrollSuppress);
  clearTimeout(scrollSuppressTimer);
});
</script>

<template>
  <main>
    <SiteHeader :visible="showHeader" />

    <div class="page-corner-actions">
      <button
        type="button"
        class="page-corner-button"
        @click="funFactsOpen = true"
      >Fun facts</button>
      <button
        type="button"
        class="page-corner-button"
        @click="aboutOpen = true"
      >About</button>
    </div>

    <h1 class="site-brand">DOAC</h1>

    <FilterBar
      :clusters="taxonomiesData.clusters"
      :topics="taxonomiesData.topics"
      v-model:cluster="activeCluster"
      v-model:subtopic="activeSubtopic"
    />

    <div class="results-bar" ref="resultsBarEl">
      <Transition name="summary-fade" mode="out-in">
        <div :key="filterStateKey" class="result-summary">
          <span
            v-for="(part, i) in resultSummary"
            :key="i"
            :class="{ 'summary-bold': part.bold }"
          >{{ part.text }}</span>
        </div>
      </Transition>
      <div class="search-wrapper">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search guests, titles, descriptions…"
          class="search-input"
          aria-label="Search episodes"
        />
      </div>
    </div>

    <Transition name="grid-fade" mode="out-in">
      <section :key="filterStateKey" class="grid">
        <div
          v-for="(ep, i) in displayedEpisodes"
          :key="ep.id"
          class="card-slot"
          :class="{ 'is-stagger-target': i >= staggerStartIndex && i < staggerStartIndex + 8 }"
          :style="{ '--slot-index': i - staggerStartIndex }"
        >
          <EpisodeCard
            :episode="ep"
            :guests="ep.guestIds.map((id) => guestsById[id])"
            :appearance-counts="ep.guestIds.map((id) => appearanceCountFor(id, ep.id))"
            :roles-by-id="rolesById"
            :topics-by-id="topicsById"
          />
        </div>
      </section>
    </Transition>

    <div v-if="hasMore" class="load-more-wrapper">
      <button
        type="button"
        class="load-more-button"
        @click="loadMore"
      >
        Load more
        <span class="load-more-count">{{ remainingCount }} remaining</span>
      </button>
    </div>

    <BaseModal
      :open="aboutOpen"
      title="About this project"
      @close="aboutOpen = false"
    >
      <p>
        <em>The Diary of a CEO</em> has hundreds of long-form interviews,
        but YouTube's algorithm and loud thumbnails make it hard to find
        the ones that match what you actually want to learn about. This
        is a quieter way to browse and surface hidden gems from the
        catalog:
      </p>
      <ul>
        <li>Editorial titles and short summaries instead of clickbait.</li>
        <li>
          A credibility line for every guest (credentials, current role,
          notable books) so you can tell whether they fit the topic
          before committing ninety minutes.
        </li>
        <li>
          Filter by the topics you care about. Every episode equally
          visible, sorted only by date.
        </li>
      </ul>
      <p>
        Built by
        <a
          href="https://www.linkedin.com/in/mariuszpdabrowski/"
          target="_blank"
          rel="noopener"
        >Mariusz Dabrowski</a>.
      </p>
    </BaseModal>

    <BaseModal
      :open="funFactsOpen"
      title="Fun facts"
      @close="funFactsOpen = false"
    >
      <dl class="fun-facts">
        <dt>Catalog</dt>
        <dd>
          {{ funFactsStats.totalEpisodes }} episodes,
          {{ funFactsStats.totalGuests }} unique guests, roughly
          {{ funFactsStats.totalHours }} hours of total audio.
        </dd>
        <template v-if="funFactsStats.topGuest">
          <dt>Most frequent guest</dt>
          <dd>
            <strong>{{ funFactsStats.topGuest.name }}</strong>
            ({{ funFactsStats.topGuest.count }}
            appearance{{ funFactsStats.topGuest.count === 1 ? '' : 's' }}).
          </dd>
        </template>
        <template v-if="funFactsStats.topTopics.length">
          <dt>Most-tagged topics</dt>
          <dd>
            <span v-for="(t, i) in funFactsStats.topTopics" :key="t.label">
              <strong>{{ t.label }}</strong> ({{ t.count }}){{ i < funFactsStats.topTopics.length - 1 ? ', ' : '.' }}
            </span>
          </dd>
        </template>
        <template v-if="funFactsStats.topCluster">
          <dt>Most-discussed area</dt>
          <dd>
            <strong>{{ funFactsStats.topCluster.label }}</strong>,
            on {{ funFactsStats.topCluster.count }} episodes.
          </dd>
        </template>
      </dl>
    </BaseModal>

  </main>
</template>

<style scoped>
main {
  /* Page background, fonts, and the floating-speck atmosphere are global
     (see assets/css/main.css and components/AppAtmosphere.vue). main itself
     gets z-index: 1 from the global stylesheet so it sits above the
     atmosphere. Children stack naturally inside main's stacking context;
     no per-child z-index needed. */
  min-height: 100vh;
  padding: 4.5rem 4rem;
}

.site-brand {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 5.5rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-align: center;
  margin: 1.5rem 0 5.5rem;
  background: linear-gradient(135deg, #f5ecd6 0%, #c89968 50%, #f5ecd6 100%);
  background-size: 200% 200%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  line-height: 1;
  animation: gradient-shift 10s ease-in-out infinite;
}

.page-corner-actions {
  position: absolute;
  top: 1.5rem;
  right: 1.5rem;
  z-index: 2;
  display: flex;
  gap: 0.25rem;
}

.page-corner-button {
  background: transparent;
  border: none;
  color: #7a7468;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.75rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  padding: 0.4rem 0.875rem;
  border-radius: 9999px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.page-corner-button:hover {
  color: #f5ecd6;
  background: rgba(245, 236, 214, 0.04);
}

.page-corner-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

/* Fun facts <dl> styling — BaseModal handles backdrop/panel/typography. */
.fun-facts {
  margin: 0;
  padding: 0;
}

.fun-facts dt {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #c89968;
  margin-bottom: 0.25rem;
}

.fun-facts dd {
  margin: 0 0 1.25rem;
  color: #c4b89f;
}

.fun-facts dd:last-of-type {
  margin-bottom: 0;
}

.results-bar {
  max-width: 110rem;
  margin: 0 auto 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 0 0.5rem;
}

.result-summary {
  font-size: 0.9375rem;
  color: #a89e8c;
  letter-spacing: 0.01em;
  /* Pivot rotations from the left edge, like the text is nailed on the left */
  transform-origin: left center;
}

.summary-bold {
  font-weight: 600;
  color: #f5ecd6;
}

/* Summary line shares timing with the grid: leaves alongside the grid's
   300ms fade-out, then enters with the same 500ms duration as card 0's
   stagger animation. No delay needed because both leaves complete at the
   same moment, so both entries begin simultaneously. */
.summary-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.summary-fade-enter-active {
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.summary-fade-enter-from {
  opacity: 0;
  /* Starts below + tilted down on the right, then slides up + rotates back to level */
  transform: translateY(18px) rotate(3deg);
}

.summary-fade-leave-to {
  opacity: 0;
  /* Slides down + tilts down on the right, as if hinged on the left edge */
  transform: translateY(18px) rotate(3deg);
}

.search-wrapper {
  flex-shrink: 0;
}

.search-input {
  background: rgba(245, 236, 214, 0.04);
  border: 1px solid rgba(245, 236, 214, 0.12);
  border-radius: 9999px;
  padding: 0.5rem 1rem;
  width: 280px;
  font-family: inherit;
  font-size: 0.875rem;
  color: #f5ecd6;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.search-input::placeholder {
  color: #6e6859;
}

.search-input:focus {
  outline: none;
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.06);
}

.grid {
  max-width: 110rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 4rem;
  position: relative; /* anchor for absolutely-positioned leaving cards */
}

.card-slot {
  position: relative;
  display: grid; /* makes the inner .card stretch to the grid row height */
}

/* Fade the whole grid as a unit when filters change, out-in mode means
   the old result set finishes leaving before the new one enters, so cards
   never visually overlap. */
/* Whole-grid leave: slides down + fades out as a unit */
.grid-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.grid-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

/* No enter animation on the grid itself, cards stagger in individually
   via the card-stagger-in keyframe below */

@keyframes card-stagger-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Stagger only the first 8 cards of each "batch", the initial mount AND
   each load-more reveal. Cards outside the window render at full opacity
   instantly (otherwise `animation-fill-mode: both` would hide the 500th
   card for ~35s, and load-more would do nothing visually). */
.card-slot.is-stagger-target {
  animation: card-stagger-in 0.5s ease both;
  animation-delay: calc(var(--slot-index, 0) * 0.07s);
}

.load-more-wrapper {
  max-width: 110rem;
  margin: 4rem auto 0;
  display: flex;
  justify-content: center;
}

.load-more-button {
  background: rgba(245, 236, 214, 0.04);
  border: 1px solid rgba(245, 236, 214, 0.12);
  color: #f5ecd6;
  padding: 0.75rem 2rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.load-more-button:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.06);
}

.load-more-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

.load-more-count {
  font-size: 0.8125rem;
  font-weight: 400;
  color: #a89e8c;
}

@media (prefers-reduced-motion: reduce) {
  .card-slot {
    animation: none;
  }
  .grid-fade-leave-active {
    transition: opacity 0.15s ease;
  }
  .grid-fade-leave-to {
    transform: none;
  }
}

/* Row divider: subtle 1px line sits in the gap above every slot after
   row 1. Pseudo lives on the slot (no overflow:hidden) rather than the
   inner .card (which clips). Per-card line breaks at column gaps -
   reads as a row separator that respects columns. */
.card-slot:nth-child(n+2)::before {
  content: '';
  position: absolute;
  top: -2rem; /* halfway into the 4rem gap */
  left: 0;
  right: 0;
  border-top: 1px solid rgba(245, 236, 214, 0.1);
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.4s ease 0.2s; /* small delay so it appears after the card settles */
}

@media (min-width: 900px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
  /* 2-column layout: row 1 is children 1-2, suppress divider above child 2 */
  .card-slot:nth-child(2)::before {
    display: none;
  }
}

@media (min-width: 1920px) {
  .grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
  /* 3-column layout: row 1 is children 1-3, also suppress above child 3 */
  .card-slot:nth-child(3)::before {
    display: none;
  }
}
</style>
