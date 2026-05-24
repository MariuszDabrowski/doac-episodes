<script setup>
import episodesData from '~/data/episodes.json';
import guestsData from '~/data/guests.json';
import taxonomiesData from '~/data/taxonomies.json';

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

// Three depth layers: far (slow, small, dim, blurred), mid, close (fast, large, bright, sharp).
const SPECK_LAYERS = [
  { sizeBase: 1.2, durationBase: 42, driftRange: 8, opacityBase: 0.2, blur: 1.2 }, // far
  { sizeBase: 2.0, durationBase: 30, driftRange: 14, opacityBase: 0.4, blur: 0.5 }, // mid
  { sizeBase: 3.4, durationBase: 20, driftRange: 22, opacityBase: 0.6, blur: 0 }, // close
];

// More saturated to survive blending with the dark warm background.
const SPECK_COLORS = [
  '#fff4d4', // bright pale cream
  '#fde68a', // cream-yellow
  '#fcd34d', // gold
  '#fbbf24', // warm gold
  '#f59e0b', // amber
  '#d97706', // deep amber
];

const specks = Array.from({ length: 42 }, (_, i) => {
  const layer = SPECK_LAYERS[i % 3];
  return {
    left: (i * 37 + 13) % 100,
    top: (i * 71 + 7) % 100,
    delay: ((i * 1.7) % 30) - 15,
    duration: layer.durationBase + ((i * 1.3) % 10),
    size: layer.sizeBase + ((i * 0.2) % 0.7),
    driftX: ((i * 7) % (layer.driftRange * 2)) - layer.driftRange,
    peakOpacity: layer.opacityBase + ((i % 4) * 0.02),
    blur: layer.blur,
    color: SPECK_COLORS[(i * 5 + 1) % SPECK_COLORS.length],
    pulseDuration: 2.5 + ((i * 0.7) % 4),
    pulseDelay: ((i * 0.9) % 5) - 2,
  };
});

const clusterBar = ref(null);
const clusterButtons = ref([]);
const activeCluster = ref('all');
const activeSubtopic = ref(null);
const indicatorStyle = ref({ transform: 'translateX(0)', width: '0px' });
const indicatorReady = ref(false); // skip transition until first measurement lands

const subtopics = computed(() => {
  if (activeCluster.value === 'all') return [];
  return taxonomiesData.topics.filter((t) => t.cluster === activeCluster.value);
});

function updateIndicator() {
  const idx = clusters.findIndex((c) => c.id === activeCluster.value);
  if (idx === -1) return;
  const btn = clusterButtons.value[idx];
  if (!btn || !clusterBar.value) return;
  const barRect = clusterBar.value.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  indicatorStyle.value = {
    transform: `translateX(${btnRect.left - barRect.left}px)`,
    width: `${btnRect.width}px`,
  };
}

function selectCluster(id) {
  activeCluster.value = id;
  activeSubtopic.value = null;
}

function selectSubtopic(id) {
  activeSubtopic.value = activeSubtopic.value === id ? null : id;
}

// Track the previous cluster's subtopic count so we can skip the leave
// wait entirely when the outgoing bar is empty (e.g., switching from "All").
// Captured synchronously before the watcher chain triggers the Transition.
const previousSubtopicCount = ref(0);

watch(activeCluster, (newVal, oldVal) => {
  previousSubtopicCount.value = oldVal === 'all'
    ? 0
    : taxonomiesData.topics.filter((t) => t.cluster === oldVal).length;
}, { flush: 'sync' });

const subtopicBarDuration = computed(() => ({
  enter: 800,
  leave: previousSubtopicCount.value > 0 ? 450 : 0,
}));

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

// Paginate the result set so we render at most PAGE_SIZE cards at a time.
// Catalog will eventually hit ~500 episodes — rendering all of them up
// front means thousands of DOM nodes and per-filter-change Vue diffs.
// Pagination is both a perf cap and a UX nudge: if the user is hunting,
// they should be filtering, not scrolling 500 cards.
const PAGE_SIZE = 50;
const STAGGER_COUNT = 8;
const visibleCount = ref(PAGE_SIZE);
// The index where the most-recent batch begins. Cards [staggerStart,
// staggerStart + STAGGER_COUNT) get the entry animation: initial mount
// staggers cards 0-7, and each "load more" then staggers the first 8 of
// the new batch. Cards outside this window render at full opacity instantly.
const staggerStartIndex = ref(0);

const displayedEpisodes = computed(() => filteredEpisodes.value.slice(0, visibleCount.value));
const remainingCount = computed(() => Math.max(0, filteredEpisodes.value.length - visibleCount.value));
const hasMore = computed(() => remainingCount.value > 0);

function loadMore() {
  staggerStartIndex.value = visibleCount.value;
  visibleCount.value += PAGE_SIZE;
}

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

watch(activeCluster, () => nextTick(updateIndicator));

// When the result set changes while the user is scrolled deep, the page can
// suddenly become shorter than their scrollY — the browser then snaps them
// to the new max scroll, which feels jarring (especially for 0-result
// searches where the page collapses to viewport height). Pre-empt that by
// smooth-scrolling back to the top ourselves, so the motion is controlled.
watch(filterStateKey, () => {
  // Any new filter resets pagination — otherwise the "X remaining" count
  // gets stale and we'd potentially be showing page-2 of a result set
  // that shrunk to fewer than PAGE_SIZE total.
  visibleCount.value = PAGE_SIZE;
  staggerStartIndex.value = 0;
  if (typeof window === 'undefined') return;
  if (window.scrollY > 100) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// About modal state. Escape closes; click outside the panel also closes.
const aboutOpen = ref(false);
function openAbout() {
  aboutOpen.value = true;
}
function closeAbout() {
  aboutOpen.value = false;
}
function onAboutEscape(e) {
  if (e.key === 'Escape' && aboutOpen.value) closeAbout();
}

// Fixed mini-header revealed after the results-bar scrolls past the top.
// Uses IntersectionObserver so we don't run anything on every scroll event.
const resultsBarEl = ref(null);
const showHeader = ref(false);
let headerObserver = null;

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Tag <body> with .is-scrolling for a short window after each scroll.
// CSS uses this to suppress hover-triggered effects (e.g. credibility
// expand) while the cursor is passing over cards involuntarily.
let scrollSuppressTimer = null;
function onScrollSuppress() {
  document.body.classList.add('is-scrolling');
  clearTimeout(scrollSuppressTimer);
  scrollSuppressTimer = setTimeout(() => {
    document.body.classList.remove('is-scrolling');
  }, 150);
}

onMounted(() => {
  nextTick(() => {
    updateIndicator();
    // Re-enable the transition only after the indicator's correct position
    // has actually painted, so the first appearance isn't an animation.
    requestAnimationFrame(() => {
      indicatorReady.value = true;
    });
  });
  window.addEventListener('resize', updateIndicator);
  window.addEventListener('scroll', onScrollSuppress, { passive: true });
  window.addEventListener('keydown', onAboutEscape);

  if (resultsBarEl.value) {
    headerObserver = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        // Show header only when results-bar has scrolled fully above the
        // viewport (not when it's below, e.g. on a very tall window).
        showHeader.value = !e.isIntersecting && e.boundingClientRect.bottom < 0;
      },
      { threshold: 0 }
    );
    headerObserver.observe(resultsBarEl.value);
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', updateIndicator);
  window.removeEventListener('scroll', onScrollSuppress);
  window.removeEventListener('keydown', onAboutEscape);
  clearTimeout(scrollSuppressTimer);
  if (headerObserver) headerObserver.disconnect();
});
</script>

<template>
  <main>
    <header class="site-header" :class="{ 'is-visible': showHeader }">
      <button
        type="button"
        class="header-brand"
        @click="scrollToTop"
        aria-label="Back to top"
      >DOAC</button>
      <button
        type="button"
        class="header-browse-button"
        @click="scrollToTop"
      >
        <span aria-hidden="true">↑</span>
        Browse categories
      </button>
      <button
        type="button"
        class="header-top-button"
        @click="scrollToTop"
        aria-label="Back to top"
      >
        <span aria-hidden="true">↑</span>
        Top
      </button>
    </header>

    <div class="atmosphere" aria-hidden="true">
      <div
        v-for="(s, i) in specks"
        :key="i"
        class="speck"
        :style="{
          left: `${s.left}%`,
          top: `${s.top}%`,
          width: `${s.size}px`,
          height: `${s.size}px`,
          background: s.color,
          boxShadow: `0 0 ${Math.max(2, s.size * 1.5)}px ${s.color}`,
          '--drift-x': `${s.driftX}vw`,
          '--peak': s.peakOpacity,
          '--blur': `${s.blur}px`,
          '--drift-dur': `${s.duration}s`,
          '--drift-delay': `${s.delay}s`,
          '--pulse-dur': `${s.pulseDuration}s`,
          '--pulse-delay': `${s.pulseDelay}s`,
        }"
      ></div>
    </div>

    <button
      type="button"
      class="page-about-button"
      @click="openAbout"
    >About</button>

    <h1 class="site-brand">DOAC</h1>

    <div class="category-section">
      <div class="cluster-bar-wrapper">
        <div class="cluster-bar" ref="clusterBar">
          <div
            class="cluster-indicator"
            :class="{ 'no-transition': !indicatorReady }"
            :style="indicatorStyle"
          ></div>
          <button
            v-for="c in clusters"
            :key="c.id"
            ref="clusterButtons"
            class="cluster-item"
            :class="{ active: activeCluster === c.id }"
            @click="selectCluster(c.id)"
          >
            {{ c.label }}
          </button>
        </div>
      </div>

      <Transition
        name="subtopic-bar"
        mode="out-in"
        :duration="subtopicBarDuration"
      >
        <div :key="activeCluster" class="subtopic-bar">
          <button
            v-for="(t, i) in subtopics"
            :key="t.id"
            class="subtopic-pill"
            :class="{ active: activeSubtopic === t.id }"
            :style="{ '--pill-index': i }"
            @click="selectSubtopic(t.id)"
          >
            {{ t.label }}
          </button>
        </div>
      </Transition>
    </div>

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

    <Transition name="about-fade">
      <div
        v-if="aboutOpen"
        class="about-backdrop"
        @click.self="closeAbout"
      >
        <div
          class="about-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-title"
        >
          <button
            type="button"
            class="about-close"
            @click="closeAbout"
            aria-label="Close"
          >×</button>
          <h2 id="about-title" class="about-title">About this project</h2>
          <p>
            A curated, browsable index of every long-form
            <em>Diary of a CEO</em> episode — rewritten titles, editorial
            summaries, guest credibility lines, and topic tags. Built as
            an experiment in what an AI-assisted editorial pipeline can
            produce when paired with manual review.
          </p>
          <p>
            Built by
            <a
              href="https://www.linkedin.com/in/mariuszpdabrowski/"
              target="_blank"
              rel="noopener"
            >Mariusz Dabrowski</a>.
          </p>
          <p>
            <a
              class="about-link-cta"
              href="https://github.com/MariuszDabrowski/doac-episodes"
              target="_blank"
              rel="noopener"
            >Source on GitHub →</a>
          </p>
        </div>
      </div>
    </Transition>

  </main>
</template>

<style scoped>
main {
  position: relative;
  min-height: 100vh;
  padding: 4.5rem 4rem;
  background:
    radial-gradient(ellipse 90% 60% at 50% 0%, rgba(200, 153, 104, 0.07) 0%, transparent 55%),
    linear-gradient(180deg, #100e0c 0%, #0a0807 100%);
  /* Anchor the gradient to the viewport so it doesn't stretch/compress as
     filters change the page height. */
  background-attachment: fixed;
}

.atmosphere {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.speck {
  position: absolute;
  background: #f5ecd6;
  border-radius: 50%;
  opacity: 0;
  filter: blur(var(--blur, 0px)) brightness(1);
  will-change: transform, opacity, filter;
  /* GPU layer for smooth animation across refresh rates */
  transform: translate3d(0, 30vh, 0);
  backface-visibility: hidden;
  animation:
    drift var(--drift-dur, 30s) ease-in-out var(--drift-delay, 0s) infinite,
    pulse var(--pulse-dur, 4s) ease-in-out var(--pulse-delay, 0s) infinite;
}

@keyframes drift {
  0% {
    opacity: 0;
    transform: translate3d(0, 30vh, 0);
  }
  20% {
    opacity: var(--peak, 0.18);
  }
  80% {
    opacity: var(--peak, 0.18);
  }
  100% {
    opacity: 0;
    transform: translate3d(var(--drift-x, 0), -50vh, 0);
  }
}

@keyframes pulse {
  0%,
  100% {
    filter: blur(var(--blur, 0px)) brightness(0.55);
  }
  50% {
    filter: blur(var(--blur, 0px)) brightness(1.35);
  }
}

/* Respect users who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
  .speck {
    animation: none;
    opacity: var(--peak, 0.18);
  }
}

main > :not(.atmosphere):not(.site-header):not(.page-about-button) {
  position: relative;
  z-index: 1;
}

.site-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1.5rem;
  padding: 0.625rem 1.5rem;
  background: rgba(16, 14, 12, 0.78);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border-bottom: 1px solid rgba(245, 236, 214, 0.06);
  transform: translateY(-100%);
  /* Strong ease-out: feels weighted/inertial on the way in without
     overshooting top:0 (which would briefly create a gap above the bar). */
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

.site-header.is-visible {
  transform: translateY(0);
  pointer-events: auto;
}

.header-brand {
  background: transparent;
  border: none;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #f5ecd6;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  transition: color 0.15s ease;
}

.header-brand:hover {
  color: #c89968;
}

.header-browse-button {
  justify-self: center;
  background: rgba(245, 236, 214, 0.04);
  border: 1px solid rgba(245, 236, 214, 0.12);
  border-radius: 9999px;
  padding: 0.4rem 1.125rem;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #c4b89f;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.header-browse-button:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.06);
  color: #f5ecd6;
}

.header-browse-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

.header-top-button {
  background: rgba(245, 236, 214, 0.06);
  border: none;
  color: #c4b89f;
  padding: 0.4rem 0.875rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.header-top-button:hover {
  background: rgba(245, 236, 214, 0.12);
  color: #f5ecd6;
}

.header-top-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
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

.page-about-button {
  position: absolute;
  top: 1.5rem;
  right: 1.5rem;
  z-index: 2;
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

.page-about-button:hover {
  color: #f5ecd6;
  background: rgba(245, 236, 214, 0.04);
}

.about-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(8, 7, 6, 0.7);
  backdrop-filter: blur(8px) saturate(120%);
  -webkit-backdrop-filter: blur(8px) saturate(120%);
}

.about-panel {
  position: relative;
  max-width: 32rem;
  width: 100%;
  padding: 2.25rem 2rem 1.75rem;
  background: #1c1916;
  border: 1px solid rgba(245, 236, 214, 0.08);
  border-radius: 12px;
  box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.6);
  color: #c4b89f;
  font-size: 0.9375rem;
  line-height: 1.6;
}

.about-panel p {
  margin: 0 0 1rem;
}

.about-panel p:last-child {
  margin-bottom: 0;
}

.about-panel a {
  color: #f5ecd6;
  text-decoration: underline;
  text-decoration-color: rgba(200, 153, 104, 0.5);
  text-underline-offset: 3px;
  transition: text-decoration-color 0.15s ease;
}

.about-panel a:hover {
  text-decoration-color: #c89968;
}

.about-title {
  margin: 0 0 1rem;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: #f5ecd6;
  letter-spacing: 0.02em;
}

.about-link-cta {
  display: inline-block;
  font-weight: 600;
}

.about-close {
  position: absolute;
  top: 0.625rem;
  right: 0.875rem;
  background: transparent;
  border: none;
  color: #a89e8c;
  font-size: 1.75rem;
  line-height: 1;
  width: 2rem;
  height: 2rem;
  cursor: pointer;
  border-radius: 9999px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.about-close:hover {
  color: #f5ecd6;
  background: rgba(245, 236, 214, 0.06);
}

.about-close:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

/* Backdrop fades; the panel scales up subtly for entry. */
.about-fade-enter-active,
.about-fade-leave-active {
  transition: opacity 0.2s ease;
}

.about-fade-enter-active .about-panel,
.about-fade-leave-active .about-panel {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}

.about-fade-enter-from,
.about-fade-leave-to {
  opacity: 0;
}

.about-fade-enter-from .about-panel,
.about-fade-leave-to .about-panel {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

.page-about-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

.category-section {
  max-width: 110rem;
  margin: 0 auto 7rem;
}

.cluster-bar-wrapper {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
}

.subtopic-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.25rem;
}

.subtopic-pill {
  background: transparent;
  border: 1px solid rgba(245, 236, 214, 0.22);
  color: #c4b89f;
  padding: 0.4rem 1rem;
  border-radius: 9999px;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  /* Pivot rotation from the left edge — same hinged-on-a-nail feel as the
     result summary text */
  transform-origin: left center;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.subtopic-pill:hover {
  background: rgba(245, 236, 214, 0.06);
  border-color: rgba(245, 236, 214, 0.4);
  color: #f5ecd6;
}

.subtopic-pill.active {
  background: #c89968;
  border-color: #c89968;
  color: #100e0c;
}

/* Atomic bar swap on cluster change. mode="out-in" guarantees old bar
   finishes leaving before new bar mounts, so there's no layout overlap.
   Stagger animations on pills run via parent enter/leave-active class.  */
@keyframes pill-stagger-enter {
  from { opacity: 0; transform: translateY(-28px) rotate(10deg); }
  to { opacity: 1; transform: translateY(0) rotate(0deg); }
}

@keyframes pill-stagger-leave {
  to { opacity: 0; transform: translateY(14px) rotate(-10deg); }
}

.subtopic-bar-enter-active .subtopic-pill {
  /* Strong deceleration — the pill flies in then settles, inertia-like */
  animation: pill-stagger-enter 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--pill-index, 0) * 0.05s);
}

.subtopic-bar-leave-active .subtopic-pill {
  /* Fast start, gentle decel — pill is pushed out rather than dropping slowly */
  animation: pill-stagger-leave 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--pill-index, 0) * 0.05s);
  /* Override the default left-edge pivot — leaving pills hinge on the right */
  transform-origin: right center;
}

@media (prefers-reduced-motion: reduce) {
  .subtopic-bar-enter-active .subtopic-pill,
  .subtopic-bar-leave-active .subtopic-pill {
    animation: none;
  }
}

.cluster-bar {
  position: relative;
  display: inline-flex;
  align-items: center;
  background: #1c1916;
  border-radius: 9999px;
  padding: 0.375rem;
}

.cluster-indicator {
  position: absolute;
  top: 0.375rem;
  bottom: 0.375rem;
  left: 0;
  background: #c89968;
  border-radius: 9999px;
  /* Apple "default" curve — smoother glide than Material's standard. */
  transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1), width 0.5s cubic-bezier(0.32, 0.72, 0, 1);
  z-index: 0;
  will-change: transform, width;
}

.cluster-indicator.no-transition {
  transition: none;
}

.cluster-item {
  position: relative;
  z-index: 1;
  background: transparent;
  border: none;
  color: #c4b89f;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 500;
  padding: 0.5rem 1.25rem;
  border-radius: 9999px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.2s ease;
}

.cluster-item.active {
  color: #100e0c;
}

.cluster-item:hover:not(.active) {
  color: #f5ecd6;
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

/* Fade the whole grid as a unit when filters change — out-in mode means
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

/* No enter animation on the grid itself — cards stagger in individually
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

/* Stagger only the first 8 cards of each "batch" — the initial mount AND
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
   inner .card (which clips). Per-card line breaks at column gaps —
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
