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
});

onUnmounted(() => {
  window.removeEventListener('resize', updateIndicator);
  window.removeEventListener('scroll', onScrollSuppress);
  clearTimeout(scrollSuppressTimer);
});
</script>

<template>
  <main>
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

    <div class="results-bar">
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
          v-for="(ep, i) in filteredEpisodes"
          :key="ep.id"
          class="card-slot"
          :style="{ '--slot-index': i }"
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

main > :not(.atmosphere) {
  position: relative;
  z-index: 1;
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

/* Only stagger the first ~2 rows above the fold. Beyond that the user can't
   see the animation, but `animation-fill-mode: both` would still hide the
   card until its delay elapses — so e.g. the 500th card would be invisible
   for ~35s. Cards past the cap render immediately at full opacity. */
.card-slot:nth-child(-n+8) {
  animation: card-stagger-in 0.5s ease both;
  animation-delay: calc(var(--slot-index, 0) * 0.07s);
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
