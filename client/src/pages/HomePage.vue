<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import episodesData from '@data/episodes.json';
import guestsData from '@data/guests.json';
import taxonomiesData from '@data/taxonomies.json';
import EpisodeCard from '@/components/EpisodeCard.vue';
import SiteHeader from '@/components/SiteHeader.vue';
import FilterBar from '@/components/FilterBar.vue';
import { useHeaderReveal } from '@/composables/useHeaderReveal.js';
import { usePagination } from '@/composables/usePagination.js';
import { useGridColumns } from '@/composables/useGridColumns.js';
import { useAboutModal } from '@/composables/useAboutModal.js';
import { useFilterContext } from '@/composables/useFilterContext.js';

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
// "active" refs are the user-facing values (FilterBar pills update them
// immediately so clicks have instant visual feedback). "applied" refs
// are what the filter computed reads from, and they lag by one smooth
// scroll-to-top so the grid doesn't change mid-scroll.
const activeCluster = ref('all');
const activeSubtopic = ref(null);
const searchQuery = ref('');
const appliedCluster = ref('all');
const appliedSubtopic = ref(null);

// Scroll smoothly to the top, then commit the active filter to applied.
// If the user is already at the top, commit immediately. The timeout
// (380ms) covers a typical smooth-scroll duration; the grid Transition
// kicks in once applied changes, so users see: scroll up, then tiles
// fade in/out at the top. Search is excluded - typing already keeps
// the user at the search input row, no scroll needed.
let commitTimer = null;
function scheduleCommit() {
  clearTimeout(commitTimer);
  if (window.scrollY <= 1) {
    commitFilters();
    return;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  commitTimer = setTimeout(commitFilters, 380);
}
function commitFilters() {
  appliedCluster.value = activeCluster.value;
  appliedSubtopic.value = activeSubtopic.value;
}

// Search "wins" against the filter pills: typing into search means the
// user wants to scan everyone, not the current cluster. Auto-clear the
// cluster + subtopic the moment search becomes non-empty so the result
// set isn't sneakily narrowed by a stale filter the user forgot about.
watch(searchQuery, (val) => {
  if (val.trim() && (activeCluster.value !== 'all' || activeSubtopic.value)) {
    activeCluster.value = 'all';
    activeSubtopic.value = null;
  }
});

// URL <-> filter state, two-way. EpisodeCard's topic pills link here with
// ?topic=<id>; cluster pills emit ?cluster=<id>. A topic implies its cluster,
// so they're mutually exclusive on the URL.
const route = useRoute();
const router = useRouter();

function applyQueryToState() {
  const { topic, cluster } = route.query;
  if (topic) {
    const t = taxonomiesData.topics.find((x) => x.id === topic);
    if (t) {
      activeCluster.value = t.cluster;
      activeSubtopic.value = t.id;
      return;
    }
  }
  if (cluster) {
    activeCluster.value = cluster;
    activeSubtopic.value = null;
    return;
  }
  activeCluster.value = 'all';
  activeSubtopic.value = null;
}
applyQueryToState();
// Sync applied to active on initial mount: the (active) filter watch
// below only fires on subsequent changes, so without this the page
// would render with applied='all' even when URL has ?cluster=mind.
commitFilters();
watch(() => [route.query.topic, route.query.cluster], applyQueryToState);

watch([activeCluster, activeSubtopic], () => {
  const desiredTopic = activeSubtopic.value || '';
  const desiredCluster = !activeSubtopic.value && activeCluster.value !== 'all'
    ? activeCluster.value
    : '';
  const currentTopic = route.query.topic || '';
  const currentCluster = route.query.cluster || '';
  if (desiredTopic !== currentTopic || desiredCluster !== currentCluster) {
    const next = { ...route.query };
    delete next.topic;
    delete next.cluster;
    if (desiredTopic) next.topic = desiredTopic;
    else if (desiredCluster) next.cluster = desiredCluster;
    // replace, not push: filter changes shouldn't pile up browser history.
    router.replace({ query: next });
  }
  // Smooth-scroll to top, then commit the new filter so the grid swap
  // doesn't visibly happen while the user is still scrolling.
  scheduleCommit();
});

const filteredEpisodes = computed(() => {
  let list = episodesData;

  if (appliedCluster.value !== 'all') {
    const allowed = topicsByCluster[appliedCluster.value] || [];
    list = list.filter((ep) => ep.topics.some((t) => allowed.includes(t)));
  }

  if (appliedSubtopic.value) {
    list = list.filter((ep) => ep.topics.includes(appliedSubtopic.value));
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    // "roundtable" as a virtual searchable keyword: a >=4-char prefix
    // of "roundtable" returns every multi-guest episode (matching the
    // Roundtable badge in the cards). Shorter prefixes like "r"/"ro"
    // would match too broadly, so we require enough specificity.
    const isRoundtableQuery = q.length >= 4 && 'roundtable'.startsWith(q);
    list = list.filter((ep) => {
      if (isRoundtableQuery && ep.guestIds.length > 1) return true;
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

// Key for the whole grid: changes whenever the APPLIED filter changes
// (lags one smooth-scroll behind the active filter), so Vue's
// Transition (mode="out-in") fades the old grid out and the new one
// in only after the page has finished scrolling to the top.
const filterStateKey = computed(() =>
  `${appliedCluster.value}|${appliedSubtopic.value ?? ''}|${searchQuery.value.trim()}`
);

// Paginate the result set. At ~500 episodes, rendering all of them up
// front would mean thousands of DOM nodes and a Vue diff for every filter
// change. The page size also acts as a UX nudge: if the user is hunting,
// they should be filtering, not scrolling.
// Smaller initial batch on single-column viewports: 50 cards is a lot of
// portraits to keep scrolling past on a phone, and the long DOM list makes
// scroll feel jittery. Detected once at setup time (no reactivity needed,
// the count grows via loadMore() from there).
const initialPageSize = typeof window !== 'undefined' && window.innerWidth < 900 ? 20 : 50;
const {
  displayed: displayedEpisodes,
  remaining: remainingCount,
  hasMore,
  staggerStart: staggerStartIndex,
  loadMore,
} = usePagination(filteredEpisodes, filterStateKey, initialPageSize);

const resultSummary = computed(() => {
  const n = filteredEpisodes.value.length;
  const word = n === 1 ? 'episode' : 'episodes';
  const parts = [
    { text: String(n), bold: true },
    { text: ` ${word}`, bold: false },
  ];
  if (appliedCluster.value !== 'all') {
    const c = clusters.find((c) => c.id === appliedCluster.value);
    if (c) {
      parts.push({ text: ' in ', bold: false });
      parts.push({ text: c.label, bold: true });
    }
  }
  if (appliedSubtopic.value) {
    const t = taxonomiesData.topics.find((t) => t.id === appliedSubtopic.value);
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

// About modal lives at App.vue so it's reachable from the header on every
// route. This page's hero corner button just opens the shared singleton.
const { openAbout } = useAboutModal();

// Filter context is shared across all pages via the composable so the
// Home/Guests links in the header (and the corner Guests link here)
// carry the user's filter even after navigating to detail pages that
// don't have their own filter URL state.
const { setFilter: setFilterContext, carryFilterQuery } = useFilterContext();
const guestsLink = computed(() => ({ path: '/guests', query: carryFilterQuery() }));

watch([activeCluster, activeSubtopic], () => {
  setFilterContext(activeCluster.value, activeSubtopic.value);
}, { immediate: true });

// Sticky mini-header appears once the results bar has scrolled past.
const resultsBarEl = ref(null);
const { showHeader } = useHeaderReveal(resultsBarEl);

// Filler tiles to round out the last row when the displayed-episode count
// doesn't fit evenly into the current column count (e.g. 5 episodes in a
// 2-column grid leaves 1 empty slot). Re-computes on breakpoint change.
const { columns: gridColumns } = useGridColumns();
const fillerCount = computed(() => {
  if (gridColumns.value <= 1) return 0;
  const remainder = displayedEpisodes.value.length % gridColumns.value;
  return remainder === 0 ? 0 : gridColumns.value - remainder;
});

// Tag <body> with .is-scrolling for a short window after each scroll.
// CSS uses this to suppress hover-triggered effects (e.g. credibility
// expand) while the cursor passes over cards involuntarily during scroll.
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

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
      <RouterLink :to="guestsLink" class="page-corner-button">Guests</RouterLink>
      <button
        type="button"
        class="page-corner-button"
        @click="openAbout"
      >About</button>
    </div>

    <div class="brand-block">
      <h1 class="site-brand">DOAC</h1>
      <p class="site-brand-sub">episodes</p>
    </div>

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
        <!-- Round out the last grid row with placeholder tiles when the
             displayed-episode count doesn't divide evenly into the
             current column count (only triggers at 2- and 3-col widths). -->
        <div
          v-for="n in fillerCount"
          :key="`filler-${n}`"
          class="card-slot filler-slot"
          aria-hidden="true"
        >
          <div class="filler-card"></div>
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
    <div
      v-else-if="displayedEpisodes.length > 6"
      class="load-more-wrapper"
    >
      <button
        type="button"
        class="back-to-top-button"
        @click="scrollToTop"
      >
        <span aria-hidden="true">↑</span>
        Back to top
      </button>
    </div>

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
  /* Vertical padding scales smoothly with viewport; horizontal padding
     flips to a tight value at <=1100px (see media query below). */
  padding: clamp(2.5rem, 5vw, 4.5rem) 4rem;
}

@media (max-width: 899px) {
  /* Tighten horizontal padding once we drop below the multi-column /
     desktop-card breakpoint, so single-stack mobile cards get
     near-edge breathing room. */
  main {
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
}

.brand-block {
  text-align: center;
  margin: 1.5rem 0 5.5rem;
}

.site-brand {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 5.5rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  /* letter-spacing adds 0.18em after every letter including the last,
     which shifts the optical center off when text-align: center sees the
     widened box. Matching text-indent absorbs the asymmetry. */
  text-indent: 0.18em;
  margin: 0;
  background: linear-gradient(135deg, #f5ecd6 0%, #c89968 50%, #f5ecd6 100%);
  background-size: 200% 200%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  line-height: 1;
  animation: gradient-shift 10s ease-in-out infinite;
}

.site-brand-sub {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 400;
  letter-spacing: 0.42em;
  /* Tracking pushes the last letter past the optical center; pull it
     back with a left margin equal to the letter-spacing value. */
  text-indent: 0.42em;
  text-transform: lowercase;
  color: #bcb29e;
  margin: 0.625rem 0 0;
}

.page-corner-actions {
  position: absolute;
  top: 1.5rem;
  /* Align the corner actions with the body content's right edge on
     wide screens. The grid + filter bar are clamped to max-width 110rem
     and centered, so on viewports past that the content sits inside an
     empty margin. max() falls back to 1.5rem on narrow screens where
     (50% - 55rem + 1.5rem) is negative. */
  right: max(1.5rem, calc(50% - 55rem + 1.5rem));
  z-index: 2;
  display: flex;
  gap: 0.25rem;
}

.page-corner-button {
  background: transparent;
  border: none;
  color: #8c8676;
  text-decoration: none;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  padding: 0.5rem 0.875rem;
  border-radius: 9999px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.page-corner-button:hover {
  color: #f5ecd6;
  background: rgba(245, 236, 214, 0.07);
}

.page-corner-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
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
  color: #bcb29e;
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
  background: rgba(245, 236, 214, 0.07);
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
  color: #807a6a;
}

.search-input:focus {
  outline: none;
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.09);
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
  /* Transform-only (no opacity). Earlier versions used opacity 0 → 1 with
     animation-fill-mode: both, but the pre-animation `from` state could
     flicker into view during a layout pass at the breakpoint (the
     reported "invisible card on resize" bug), since `both` pins the
     element to the from-state during animation-delay. Keeping cards
     opaque the whole time and just sliding them in avoids that. */
  from { transform: translateY(20px); }
  to { transform: translateY(0); }
}

/* Stagger only the first 8 cards of each "batch", the initial mount AND
   each load-more reveal. Cards outside the window render at full opacity
   instantly (otherwise `animation-fill-mode: both` would hide the 500th
   card for ~35s, and load-more would do nothing visually). */
.card-slot.is-stagger-target {
  animation: card-stagger-in 0.5s ease both;
  animation-delay: calc(var(--slot-index, 0) * 0.07s);
}

/* Placeholder filler tile for empty grid slots in the last row (when
   episode count doesn't divide evenly into the column count). Matches
   the .card surface color so the row reads as visually complete instead
   of trailing off, with faint horizontal lines as a "this is intentional
   empty space" cue. The lines are repeating-linear-gradient so they
   scale with whatever row height the real cards establish. */
.filler-slot {
  /* card-slot already does display:grid for stretching; the filler-card
     inside will fill the row height. */
}

.filler-card {
  height: 100%;
  min-height: 14rem;
  border-radius: 8px;
  background-color: rgba(245, 236, 214, 0.06);
  /* Thick diagonal stripes so the slot reads as deliberate "no episode
     here" placeholder rather than a missing card. Stripe + gap are both
     1.25rem; alpha stays low enough that the pattern is calm against the
     surrounding cards. */
  background-image: repeating-linear-gradient(
    45deg,
    rgba(245, 236, 214, 0.02) 0,
    rgba(245, 236, 214, 0.02) 1.25rem,
    transparent 1.25rem,
    transparent 2.5rem
  );
}

.load-more-wrapper {
  max-width: 110rem;
  margin: 4rem auto 0;
  display: flex;
  justify-content: center;
}

.load-more-button {
  background: rgba(245, 236, 214, 0.07);
  border: 1px solid rgba(245, 236, 214, 0.12);
  color: #f5ecd6;
  padding: 0.875rem 2rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.load-more-button:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.09);
}

.load-more-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

/* End-of-list state: when the user has exhausted the list (hasMore is
   false) the Load more pill is replaced by a filled-gold "Back to top"
   pill. Mirrors the Watch button's solid treatment so it reads as a
   different *action* than the translucent Load more — completion, not
   continuation. */
.back-to-top-button {
  background: #c89968;
  border: none;
  color: #100e0c;
  padding: 0.875rem 2rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: background-color 0.2s ease;
}

.back-to-top-button:hover {
  background: #d4a575;
}

.back-to-top-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 3px;
}

.load-more-count {
  font-size: 0.8125rem;
  font-weight: 400;
  color: #bcb29e;
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

@media (min-width: 1200px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
  /* 2-column layout: row 1 is children 1-2, suppress divider above child 2 */
  .card-slot:nth-child(2)::before {
    display: none;
  }
}

/* No 3-column tier: episode cards carry enough info (title, description,
   bio, topics, actions) that a third column made each tile too narrow
   to read comfortably even on ultrawide screens. Cap at 2 columns. */

@media (max-width: 640px) {
  /* About link is taking corner space that mobile can't spare. */
  .page-corner-actions {
    display: none;
  }

  /* The site brand at 5.5rem is also too big on a phone. */
  .brand-block {
    margin: 1rem 0 3rem;
  }
  .site-brand {
    font-size: 4rem;
  }
  .site-brand-sub {
    font-size: 0.8125rem;
    letter-spacing: 0.36em;
    text-indent: 0.36em;
    margin-top: 0.5rem;
  }

  /* Search bar and result-count text were sharing a row and forcing the
     count to wrap. On mobile the filters above handle discovery, so the
     search bar is removed entirely and the count gets the full row. */
  .results-bar {
    justify-content: flex-start;
  }
  .search-wrapper {
    display: none;
  }
}
</style>
