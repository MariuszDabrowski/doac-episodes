<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import episodesData from '@data/episodes.json';
import guestsData from '@data/guests.json';
import taxonomiesData from '@data/taxonomies.json';
import SiteHeader from '@/components/SiteHeader.vue';
import FilterBar from '@/components/FilterBar.vue';
import { usePagination } from '@/composables/usePagination.js';
import { useFilterContext } from '@/composables/useFilterContext.js';
import { useGuestPortrait } from '@/composables/useGuestPortrait.js';

const topicsById = Object.fromEntries(taxonomiesData.topics.map((t) => [t.id, t]));
const clusterLabelById = Object.fromEntries(taxonomiesData.clusters.map((c) => [c.id, c.label]));

// Topic ids grouped by cluster, mirrors HomePage's helper. Used when the
// cluster filter is active without a specific subtopic, to scope guests
// to "anyone who covered any topic in this cluster."
const topicsByCluster = Object.fromEntries(
  taxonomiesData.clusters.map((c) => [
    c.id,
    taxonomiesData.topics.filter((t) => t.cluster === c.id).map((t) => t.id),
  ])
);

// Per-guest stats unique to this page: appearance count, first-appearance
// date, set of topic ids the guest covered. Portrait resolution is
// shared via useGuestPortrait below.
const guestStats = (() => {
  const counts = new Map();
  const firstSeen = new Map();
  const topicsByGuest = new Map();
  for (const ep of episodesData) {
    for (const gid of ep.guestIds) {
      counts.set(gid, (counts.get(gid) || 0) + 1);
      const prev = firstSeen.get(gid);
      if (!prev || ep.date < prev) firstSeen.set(gid, ep.date);
      if (!topicsByGuest.has(gid)) topicsByGuest.set(gid, new Set());
      const set = topicsByGuest.get(gid);
      for (const t of ep.topics || []) set.add(t);
    }
  }
  return { counts, firstSeen, topicsByGuest };
})();

const { bestEpByGuest, guestsWithReliablePortrait } = useGuestPortrait();

function withBase(path) {
  return path ? import.meta.env.BASE_URL + path.replace(/^\//, '') : null;
}

function asFormat(path, ext) {
  return path ? path.replace(/\.jpg$/, ext) : null;
}

function srcsetJpg(entry) {
  const oneX = withBase(entry.portrait);
  const twoX = withBase(entry.portrait2x);
  if (!oneX) return undefined;
  return twoX ? `${oneX} 1x, ${twoX} 2x` : oneX;
}

function srcsetForExt(entry, ext) {
  const oneX = withBase(asFormat(entry.portrait, ext));
  const twoX = withBase(asFormat(entry.portrait2x, ext));
  if (!oneX) return undefined;
  return twoX ? `${oneX} 1x, ${twoX} 2x` : oneX;
}

function initialsOf(name) {
  if (!name) return '';
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase();
}

// Best-effort last name: split on whitespace, take the last token. "Madonna"
// stays as itself; "James van der Beek" becomes "Beek" (we don't try to
// keep the surname particle, since the goal is just a sortable key, not
// a display label).
function lastNameOf(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || name;
}

// All guests with at least one appearance, annotated with appearance
// count, cached lastName, and a resolved portrait source. The resolved
// portrait prefers the guest's first solo episode's thumbnail (more
// reliable than the canonical guest.portrait when an older extraction
// got the wrong face); falls back to the canonical when no solo
// appearance exists.
const allGuests = guestsData
  .map((g) => {
    const ep = bestEpByGuest.get(g.id);
    return {
      guest: g,
      count: guestStats.counts.get(g.id) || 0,
      lastName: lastNameOf(g.name),
      portrait: ep?.thumbnail || g.portrait,
      portrait2x: ep?.thumbnail2x || g.portrait2x,
    };
  })
  .filter((entry) => entry.count > 0);

// ---- filter + sort state -----------------------------------------------

const searchQuery = ref('');

// Cluster + subtopic filter mirrors the HomePage FilterBar pattern: pick
// a broad cluster ('mind', 'business', etc) and optionally narrow further
// with a subtopic. 'all' is FilterBar's pseudo-cluster meaning no filter.
// "active" refs reflect the FilterBar/sort pills immediately for visual
// feedback; "applied" refs (below) are what the visibleGuests computed
// reads from, and they lag behind by one smooth scroll-to-top so the
// grid swap doesn't happen mid-scroll.
const activeCluster = ref('all');
const activeSubtopic = ref(null);
const appliedCluster = ref('all');
const appliedSubtopic = ref(null);
const appliedSortField = ref('count');
const appliedSortDir = ref('desc');

// Three sort fields. Each has a direction toggle: clicking the active
// field flips its direction; clicking another field switches to it at
// its natural default (count -> desc, first/last name -> asc).
const sortField = ref('count'); // 'count' | 'first' | 'last'
const sortDir = ref('desc'); // 'asc' | 'desc'

function selectSort(field) {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortDir.value = field === 'count' ? 'desc' : 'asc';
  }
}

// Search "wins" against the filter pills: typing into search clears the
// cluster/subtopic selection so the user can scan everyone by name
// without a stale filter sneakily narrowing the result set.
watch(searchQuery, (val) => {
  if (val.trim() && (activeCluster.value !== 'all' || activeSubtopic.value)) {
    activeCluster.value = 'all';
    activeSubtopic.value = null;
  }
});

// URL <-> filter state, same pattern HomePage uses, so the filter
// context carries across the Home <-> Guests links. ?topic=<id> or
// ?cluster=<id> seed active on mount; subsequent active changes
// replace the URL.
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
watch(() => [route.query.topic, route.query.cluster], applyQueryToState);

// Shared filter-context composable: the Home back-pill, header links,
// etc. all read from it so the user's filter persists across pages
// (even detail pages that don't have their own URL filter state).
const { setFilter: setFilterContext, carryFilterQuery } = useFilterContext();
const homeLink = computed(() => ({ path: '/', query: carryFilterQuery() }));

watch([activeCluster, activeSubtopic], () => {
  setFilterContext(activeCluster.value, activeSubtopic.value);
}, { immediate: true });

// Smooth-scroll to top, then commit active filters/sort into the
// "applied" refs that drive the visible result set. If the user is
// already at the top, commit immediately. Search updates immediately
// in its own watcher above (user is at the search input row anyway).
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
  appliedSortField.value = sortField.value;
  appliedSortDir.value = sortDir.value;
}

// Sync applied to active on initial mount (watch below only fires on
// subsequent changes; without this the page would render with applied
// all/all even when URL has ?cluster=X).
commitFilters();

watch([activeCluster, activeSubtopic, sortField, sortDir], () => {
  // Mirror filter changes to URL so the state carries across navigations.
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
    router.replace({ query: next });
  }
  scheduleCommit();
});

const visibleGuests = computed(() => {
  let list = allGuests;

  if (appliedSubtopic.value) {
    list = list.filter((entry) =>
      guestStats.topicsByGuest.get(entry.guest.id)?.has(appliedSubtopic.value)
    );
  } else if (appliedCluster.value !== 'all') {
    const allowed = topicsByCluster[appliedCluster.value] || [];
    list = list.filter((entry) => {
      const set = guestStats.topicsByGuest.get(entry.guest.id);
      if (!set) return false;
      return allowed.some((t) => set.has(t));
    });
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((entry) =>
      entry.guest.name.toLowerCase().includes(q)
    );
  }

  const sorted = [...list];
  const dirMul = appliedSortDir.value === 'asc' ? 1 : -1;
  if (appliedSortField.value === 'count') {
    sorted.sort((a, b) => {
      if (a.count !== b.count) return (a.count - b.count) * dirMul;
      return a.guest.name.localeCompare(b.guest.name);
    });
  } else if (appliedSortField.value === 'last') {
    sorted.sort((a, b) => {
      const cmp = a.lastName.localeCompare(b.lastName) * dirMul;
      if (cmp !== 0) return cmp;
      return a.guest.name.localeCompare(b.guest.name);
    });
  } else {
    // 'first'
    sorted.sort((a, b) => a.guest.name.localeCompare(b.guest.name) * dirMul);
  }
  return sorted;
});

// Pagination keeps the DOM small (~500 tiles at once stress scroll + the
// browser's lazy-load IntersectionObserver). Page resets to 1 whenever
// any filter or sort changes; the key string is a memo of relevant state.
const paginationKey = computed(() =>
  `${appliedSortField.value}|${appliedSortDir.value}|${appliedCluster.value}|${appliedSubtopic.value ?? ''}|${searchQuery.value.trim()}`
);

// Summary text depends only on what's shown in it (count, filter, search),
// not the sort order. Keying off this avoids a needless fade when only
// the sort changes.
const summaryKey = computed(() =>
  `${visibleGuests.value.length}|${appliedCluster.value}|${appliedSubtopic.value ?? ''}|${searchQuery.value.trim()}`
);

const {
  displayed: displayedGuests,
  remaining: remainingCount,
  hasMore,
  staggerStart: staggerStartIndex,
  loadMore,
} = usePagination(visibleGuests, paginationKey, 30);

// Column count for the responsive grid (1 / 2 / 3 / 4). Used to compute
// filler tile count so the last row stays balanced. matchMedia listeners
// only fire on breakpoint crossings, not every scrollbar reflow.
const GUEST_GRID_BREAKPOINTS = [
  { minWidth: 1200, columns: 3 },
  { minWidth: 720, columns: 2 },
  { minWidth: 0, columns: 1 },
];

function detectColumns() {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth;
  for (const b of GUEST_GRID_BREAKPOINTS) {
    if (w >= b.minWidth) return b.columns;
  }
  return 1;
}

const gridColumns = ref(detectColumns());

let mediaQueries = [];
onMounted(() => {
  gridColumns.value = detectColumns();
  mediaQueries = GUEST_GRID_BREAKPOINTS
    .filter((b) => b.minWidth > 0)
    .map((b) => {
      const mq = window.matchMedia(`(min-width: ${b.minWidth}px)`);
      const handler = () => { gridColumns.value = detectColumns(); };
      mq.addEventListener('change', handler);
      return { mq, handler };
    });
});

onUnmounted(() => {
  for (const { mq, handler } of mediaQueries) mq.removeEventListener('change', handler);
  mediaQueries = [];
});

// Filler tile count: round out the last row when displayed-guest count
// doesn't divide evenly into the column count. Skipped when there are
// still more guests to load (Load more button means the gap isn't
// permanent; fillers should only fire at the true end of the list) and
// on 1-col mobile (every row is a single tile, nothing to round out).
const fillerCount = computed(() => {
  if (hasMore.value) return 0;
  if (gridColumns.value <= 1) return 0;
  const remainder = displayedGuests.value.length % gridColumns.value;
  return remainder === 0 ? 0 : gridColumns.value - remainder;
});

const portraitErrors = reactive({});

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
  <main>
    <SiteHeader :visible="true" />

    <header class="page-header">
      <RouterLink :to="homeLink" class="back-pill">← All episodes</RouterLink>
      <h1 class="page-title">Guests</h1>
      <Transition name="summary-fade" mode="out-in">
        <p :key="summaryKey" class="page-stats">
          <span class="page-stat-count">{{ visibleGuests.length }}</span>
          <template v-if="visibleGuests.length === allGuests.length">
            people across the catalog
          </template>
          <template v-else>
            of {{ allGuests.length }} people
          </template>
          <template v-if="appliedCluster !== 'all'">
            in <span class="page-stat-context">{{ clusterLabelById[appliedCluster] || appliedCluster }}</span>
            <template v-if="appliedSubtopic">
              tagged <span class="page-stat-context">{{ topicsById[appliedSubtopic]?.label || appliedSubtopic }}</span>
            </template>
          </template>
          <template v-if="searchQuery.trim()">
            matching <span class="page-stat-context">&ldquo;{{ searchQuery.trim() }}&rdquo;</span>
          </template>
        </p>
      </Transition>

      <!-- Cluster + subtopic filter, same component the home page uses,
           so the visual + interaction vocabulary is consistent. -->
      <div class="filter-section">
        <FilterBar
          :clusters="taxonomiesData.clusters"
          :topics="taxonomiesData.topics"
          v-model:cluster="activeCluster"
          v-model:subtopic="activeSubtopic"
        />
      </div>

      <!-- Sort + search on a single row below the cloud, divider above. -->
      <div class="filter-bar">
        <div class="sort-group" role="radiogroup" aria-label="Sort guests">
          <button
            type="button"
            role="radio"
            :aria-checked="sortField === 'count'"
            class="sort-pill"
            :class="{ active: sortField === 'count' }"
            @click="selectSort('count')"
          >
            Appearance count
            <span class="sort-arrow" aria-hidden="true">{{
              sortField === 'count' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'
            }}</span>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="sortField === 'first'"
            class="sort-pill"
            :class="{ active: sortField === 'first' }"
            @click="selectSort('first')"
          >
            First name
            <span class="sort-arrow" aria-hidden="true">{{
              sortField === 'first' ? (sortDir === 'asc' ? 'A→Z' : 'Z→A') : 'A→Z'
            }}</span>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="sortField === 'last'"
            class="sort-pill"
            :class="{ active: sortField === 'last' }"
            @click="selectSort('last')"
          >
            Last name
            <span class="sort-arrow" aria-hidden="true">{{
              sortField === 'last' ? (sortDir === 'asc' ? 'A→Z' : 'Z→A') : 'A→Z'
            }}</span>
          </button>
        </div>

        <div class="search-wrap">
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search by name"
            class="search-input"
            aria-label="Search guests by name"
          />
        </div>
      </div>
    </header>

    <Transition name="grid-fade" mode="out-in">
      <section v-if="displayedGuests.length" :key="paginationKey" class="grid">
        <RouterLink
          v-for="(entry, i) in displayedGuests"
          :key="entry.guest.id"
          :to="`/guest/${entry.guest.id}`"
          class="tile-slot"
          :class="{ 'is-fade-target': i >= staggerStartIndex }"
        >
          <div class="tile">
            <picture
              v-if="entry.portrait && guestsWithReliablePortrait.has(entry.guest.id) && !portraitErrors[entry.guest.id]"
            >
              <source type="image/avif" :srcset="srcsetForExt(entry, '.avif')" />
              <source type="image/webp" :srcset="srcsetForExt(entry, '.webp')" />
              <img
                :src="withBase(entry.portrait)"
                :srcset="srcsetJpg(entry)"
                :alt="entry.guest.name"
                class="tile-portrait"
                decoding="async"
                @error="portraitErrors[entry.guest.id] = true"
              />
            </picture>
            <div v-else class="tile-portrait tile-portrait-fallback" aria-hidden="true">
              {{ initialsOf(entry.guest.name) }}
            </div>
            <div class="tile-info">
              <span class="tile-name">{{ entry.guest.name }}</span>
              <span class="tile-count">
                {{ entry.count }} {{ entry.count === 1 ? 'appearance' : 'appearances' }}
              </span>
            </div>
          </div>
        </RouterLink>
        <!-- Filler tiles so the last row stays balanced when the
             displayed count doesn't divide evenly into the column
             count. Same pattern as HomePage / GuestPage. -->
        <div
          v-for="n in fillerCount"
          :key="`filler-${n}`"
          class="tile-slot filler-slot"
          aria-hidden="true"
        >
          <div class="filler-tile"></div>
        </div>
      </section>

      <p v-else class="empty">
        No guests match the current filters.
      </p>
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
      v-else-if="displayedGuests.length > 6"
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
  min-height: 100vh;
  padding: clamp(5rem, 5vw, 6rem) 4rem 4rem;
}

@media (max-width: 899px) {
  main {
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
}

.page-header {
  max-width: 110rem;
  margin: 1.5rem auto 1.75rem;
}

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
  margin-bottom: 2.5rem;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.back-pill:hover {
  border-color: #c89968;
  color: #f5ecd6;
  background: rgba(245, 236, 214, 0.04);
}

.page-title {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0 0 0.5rem;
  color: #f5ecd6;
  line-height: 1.1;
}

.page-stats {
  font-size: 0.875rem;
  color: #8c8676;
  letter-spacing: 0.01em;
  margin: 0 0 1.75rem;
}

.page-stat-count {
  color: #c89968;
  font-weight: 600;
}

.page-stat-sep {
  margin: 0 0.4rem;
  opacity: 0.6;
}

.page-stat-match {
  color: #d4c9ad;
}

/* Context segments: cluster name, topic label, search term. Lifted in
   tone so they read as the "subject" of the summary while the
   connecting words ("in", "tagged", "matching") stay muted. */
.page-stat-context {
  color: #d4c9ad;
  font-weight: 500;
}

/* The cluster + subtopic FilterBar sits between two dividers, with
   generous vertical padding so it doesn't feel sandwiched. */
.filter-section {
  padding: 2.5rem 0 2rem;
  border-top: 1px solid rgba(245, 236, 214, 0.1);
  border-bottom: 1px solid rgba(245, 236, 214, 0.1);
}

/* FilterBar's .category-section has a 7rem bottom margin meant for the
   home page's big gap between filter and results. Collapse it here so
   the divider lines up tight. */
.filter-section :deep(.category-section) {
  margin: 0 auto;
}

.sort-pill {
  background: transparent;
  border: 1px solid rgba(245, 236, 214, 0.22);
  color: #d4c9ad;
  padding: 0.4rem 0.75rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.01em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  /* Slower transition so selecting / deselecting reads as a smooth
     state shift, not a flicker. */
  transition: border-color 0.3s ease, color 0.3s ease, background-color 0.3s ease;
}

.sort-pill:hover {
  border-color: rgba(200, 153, 104, 0.55);
  color: #f5ecd6;
}

.sort-pill.active {
  background: #c89968;
  border-color: #c89968;
  color: #100e0c;
}

.sort-arrow {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0;
  opacity: 0.8;
}

.clear-pill {
  border-style: dashed;
  border-color: rgba(245, 236, 214, 0.35);
}

.clear-pill:hover {
  border-color: #c89968;
  color: #f5ecd6;
}

.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 1.25rem;
  /* No border below — section divider duty is handled by the topic
     cloud's border-bottom above. */
}

.sort-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.search-wrap {
  flex: 0 1 22rem;
  min-width: 14rem;
}

.search-input {
  width: 100%;
  background: rgba(245, 236, 214, 0.06);
  border: 1px solid rgba(245, 236, 214, 0.12);
  border-radius: 9999px;
  color: #f5ecd6;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.875rem;
  letter-spacing: 0.01em;
  padding: 0.6rem 1rem;
  line-height: 1;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.search-input::placeholder {
  color: #6b6354;
}

.search-input:focus {
  outline: none;
  border-color: rgba(200, 153, 104, 0.7);
  background: rgba(245, 236, 214, 0.09);
}

/* Tile grid: 3 columns at desktop. Fewer, larger tiles per row keeps
   the page from feeling like a wall of faces and lets each guest read
   as a discrete item. Generous column gap so tiles breathe. */
.grid {
  max-width: 110rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2.5rem 3rem;
}

@media (max-width: 1199px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 719px) {
  .grid { grid-template-columns: 1fr; }
}

/* Each grid cell is a RouterLink (.tile-slot). The visual tile (.tile
   inside) is the styled flex container. Splitting them out lets us
   attach row-divider pseudo-elements + fade animations to the slot
   without disturbing the tile's own hover transitions. */
.tile-slot {
  position: relative;
  display: block;
  text-decoration: none;
  color: #d4c9ad;
}

/* Row divider: subtle 1px line in the gap above every slot after row 1.
   Same pattern as the episode grid, so the two pages feel like
   siblings. */
.tile-slot:nth-child(n+2)::before {
  content: '';
  position: absolute;
  top: -1.25rem; /* halfway into the 2.5rem row gap */
  left: 0;
  right: 0;
  border-top: 1px solid rgba(245, 236, 214, 0.1);
  pointer-events: none;
}

/* 3-col layout: row 1 is children 1-3. Suppress the divider above
   children 2 and 3 since they're row-mates of child 1, not below it. */
.tile-slot:nth-child(2)::before,
.tile-slot:nth-child(3)::before {
  display: none;
}

@media (max-width: 1199px) {
  /* 2-col layout: row 1 is children 1-2. Re-enable child 3's divider
     (it's now row 2 col 1). */
  .tile-slot:nth-child(3)::before {
    display: block;
  }
}

@media (max-width: 719px) {
  /* 1-col layout: every item is its own row. Re-enable child 2's
     divider (it's now below child 1). */
  .tile-slot:nth-child(2)::before {
    display: block;
  }
}

.tile {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0;
  min-height: 5rem;
  background: rgba(245, 236, 214, 0.04);
  /* Match the episode card's 8px radius so the two grids feel like
     siblings rather than two different visual systems. */
  border-radius: 8px;
  /* overflow: hidden keeps the portrait clipped to the tile's rounded
     corners on the left side. The portrait's own clip-path handles the
     diagonal cut on the right. */
  overflow: hidden;
  transition: background-color 0.3s ease, color 0.3s ease;
}

.tile-slot:hover .tile {
  background: rgba(245, 236, 214, 0.09);
  color: #f5ecd6;
}

/* Wider-than-tall portrait, edge-to-edge with the tile. Explicit width
   plus height: 100% (resolved against the parent flex item's stretched
   height) makes the photo fill the entire tile, not just sit centered.
   The shallow diagonal cut on the right reveals a thin wedge of tile
   bg before the info area. */
.tile-portrait {
  display: block;
  width: 8rem;
  height: 100%;
  object-fit: cover;
  background: #110e0b;
  flex-shrink: 0;
  align-self: stretch;
  clip-path: polygon(0 0, 100% 0, calc(100% - 0.875rem) 100%, 0 100%);
}

.tile-portrait-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  /* height: 100% on a div inside a flex container doesn't always resolve
     against the parent's min-height (only against a definite height).
     Match the tile's min-height directly so the fallback panel spans
     the full tile, with the initials centered via flex. */
  min-height: 5rem;
  background: rgba(245, 236, 214, 0.07);
  color: #8c8676;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.tile-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  justify-content: center;
  /* Left padding is tight so the text sits close to the diagonal cut
     without crowding it. */
  padding: 0.625rem 1rem 0.625rem 0.75rem;
  min-width: 0;
}


.tile-name {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.2;
  word-break: break-word;
}

.tile-count {
  font-size: 0.75rem;
  color: #8c8676;
  letter-spacing: 0.01em;
  line-height: 1;
}


/* Whole-grid fade on filter change. No per-tile stagger here because at
   500 guests the cascade would either feel laggy (slow stagger) or
   unreadable (fast stagger). A clean fade in/out reads as a single
   intentional swap of the whole result set. */
.grid-fade-enter-active,
.grid-fade-leave-active {
  transition: opacity 0.45s ease;
}

.grid-fade-enter-from,
.grid-fade-leave-to {
  opacity: 0;
}

/* New-batch fade-in: when loadMore appends 32 more tiles, the existing
   ones stay put and only the appended ones animate. Marked via the
   pagination composable's staggerStart (every slot at or above that
   index is part of the latest batch). No per-tile delay so the new
   batch fades in as one block. */
@keyframes tile-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.tile-slot.is-fade-target {
  animation: tile-fade-in 0.45s ease both;
}

/* Result-summary text fade. Same easing/duration as the grid so the
   header line and grid swap together. */
.summary-fade-enter-active,
.summary-fade-leave-active {
  transition: opacity 0.45s ease;
}

.summary-fade-enter-from,
.summary-fade-leave-to {
  opacity: 0;
}

/* Filler tile: same surface tint as a real tile with smaller diagonal
   stripes (1rem stripe + gap, vs HomePage's 1.25rem) so the lighter
   guest row reads as deliberate empty space rather than a missing card. */
.filler-slot {
  display: block;
}

.filler-tile {
  height: 100%;
  min-height: 5rem;
  border-radius: 8px;
  background-color: rgba(245, 236, 214, 0.04);
  background-image: repeating-linear-gradient(
    45deg,
    rgba(245, 236, 214, 0.025) 0,
    rgba(245, 236, 214, 0.025) 0.6rem,
    transparent 0.6rem,
    transparent 1.2rem
  );
}

.empty {
  text-align: center;
  color: #8c8676;
  margin: 4rem auto;
  max-width: 30rem;
}

.load-more-wrapper {
  max-width: 110rem;
  margin: 3rem auto 0;
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

.load-more-count {
  font-size: 0.8125rem;
  font-weight: 400;
  color: #bcb29e;
}

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

@media (max-width: 640px) {
  .page-title {
    font-size: 2rem;
  }
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .search-wrap {
    flex-basis: auto;
  }
}
</style>
