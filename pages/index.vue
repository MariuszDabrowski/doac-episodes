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

const resultSummary = computed(() => {
  const n = filteredEpisodes.value.length;
  const word = n === 1 ? 'episode' : 'episodes';
  const parts = [`${n} ${word}`];
  if (activeCluster.value !== 'all') {
    const c = clusters.find((c) => c.id === activeCluster.value);
    if (c) parts.push(`in ${c.label}`);
  }
  if (activeSubtopic.value) {
    const t = taxonomiesData.topics.find((t) => t.id === activeSubtopic.value);
    if (t) parts.push(`tagged ${t.label}`);
  }
  if (searchQuery.value.trim()) {
    parts.push(`matching "${searchQuery.value.trim()}"`);
  }
  return parts.join(' ');
});

watch(activeCluster, () => nextTick(updateIndicator));

onMounted(() => {
  nextTick(updateIndicator);
  window.addEventListener('resize', updateIndicator);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateIndicator);
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
          <div class="cluster-indicator" :style="indicatorStyle"></div>
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

      <div class="subtopic-bar">
        <button
          v-for="t in subtopics"
          :key="t.id"
          class="subtopic-pill"
          :class="{ active: activeSubtopic === t.id }"
          @click="selectSubtopic(t.id)"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <div class="results-bar">
      <div class="result-summary">{{ resultSummary }}</div>
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

    <section class="grid">
      <EpisodeCard
        v-for="ep in filteredEpisodes"
        :key="ep.id"
        :episode="ep"
        :guests="ep.guestIds.map((id) => guestsById[id])"
        :appearance-counts="ep.guestIds.map((id) => appearanceCountFor(id, ep.id))"
        :roles-by-id="rolesById"
        :topics-by-id="topicsById"
      />
    </section>
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
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 0;
  will-change: transform, width;
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
  gap: 1.5rem;
}

@media (min-width: 900px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (min-width: 1920px) {
  .grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
}
</style>
