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

const episodes = [...episodesData].sort((a, b) => b.date.localeCompare(a.date));

function appearanceCountFor(guestId, episodeId) {
  const guestEpisodes = episodesData
    .filter((e) => e.guestIds.includes(guestId))
    .sort((a, b) => a.date.localeCompare(b.date));
  return guestEpisodes.findIndex((e) => e.id === episodeId) + 1;
}

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

    <section class="grid">
      <EpisodeCard
        v-for="ep in episodes"
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
  min-height: 100vh;
  padding: 4.5rem 4rem;
  background:
    radial-gradient(ellipse 90% 60% at 50% 0%, rgba(200, 153, 104, 0.07) 0%, transparent 55%),
    linear-gradient(180deg, #100e0c 0%, #0a0807 100%);
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
