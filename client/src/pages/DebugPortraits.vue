<script setup>
// Dev-only triage UI for the portrait pipeline. Loads every episode,
// shows the current portrait, and lets you mark it Good or generate the
// top-5 alts to swap one in. Approval state is persisted to
// data/_portrait-review.json so you can come back to where you left off.
import { computed, reactive, ref, onMounted } from 'vue';

const episodes = ref([]);
const filter = ref('pending'); // 'all' | 'pending' | 'good'
const expanded = reactive({}); // videoId → { alts: [], loading: false }

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function fetchEpisodes() {
  episodes.value = await api('/api/debug/episodes');
}

function cacheBustedThumb(ep) {
  const stamp = expanded[ep.videoId]?.stamp || 0;
  return stamp ? `${ep.thumbnail}?t=${stamp}` : ep.thumbnail;
}

const filtered = computed(() =>
  filter.value === 'all'
    ? episodes.value
    : episodes.value.filter((e) => e.status === filter.value)
);

const counts = computed(() => {
  const c = { all: 0, pending: 0, good: 0 };
  for (const e of episodes.value) {
    c.all += 1;
    c[e.status] = (c[e.status] || 0) + 1;
  }
  return c;
});

async function markStatus(ep, status) {
  await api('/api/debug/approve', { method: 'POST', body: { id: ep.id, status } });
  ep.status = status;
}

async function loadAlts(ep) {
  if (!expanded[ep.videoId]) expanded[ep.videoId] = { alts: [], loading: false };
  expanded[ep.videoId].loading = true;
  try {
    const res = await api('/api/debug/alts', { method: 'POST', body: { videoId: ep.videoId } });
    expanded[ep.videoId].alts = res.alts;
  } finally {
    expanded[ep.videoId].loading = false;
  }
}

async function pickAlt(ep, pick) {
  expanded[ep.videoId].loading = true;
  try {
    const res = await api('/api/debug/swap', { method: 'POST', body: { videoId: ep.videoId, pick } });
    expanded[ep.videoId].stamp = res.stamp;
    expanded[ep.videoId].alts = []; // collapse the alts strip after picking
  } finally {
    expanded[ep.videoId].loading = false;
  }
}

async function reextract(ep) {
  if (!confirm(`Re-extract 50 frames for ${ep.primaryGuest}? (takes ~1 min)`)) return;
  expanded[ep.videoId] = expanded[ep.videoId] || { alts: [], loading: false };
  expanded[ep.videoId].loading = true;
  try {
    await api('/api/debug/reextract', { method: 'POST', body: { videoId: ep.videoId } });
    await loadAlts(ep);
  } finally {
    expanded[ep.videoId].loading = false;
  }
}

onMounted(fetchEpisodes);
</script>

<template>
  <main class="debug">
    <header class="debug-header">
      <h1>Portrait review</h1>
      <div class="filter-bar">
        <button
          v-for="f in ['pending', 'good', 'all']"
          :key="f"
          type="button"
          class="filter-btn"
          :class="{ active: filter === f }"
          @click="filter = f"
        >
          {{ f }} ({{ counts[f] || 0 }})
        </button>
      </div>
    </header>

    <ul class="ep-list">
      <li
        v-for="ep in filtered"
        :key="ep.id"
        class="ep-row"
        :class="`status-${ep.status}`"
      >
        <img
          :src="cacheBustedThumb(ep)"
          :alt="ep.primaryGuest"
          class="ep-thumb"
        />
        <div class="ep-meta">
          <div class="ep-guest">{{ ep.primaryGuest }}</div>
          <div class="ep-title">{{ ep.title }}</div>
          <div class="ep-date">{{ ep.date.slice(0, 10) }} · {{ ep.videoId }}</div>
        </div>
        <div class="ep-actions">
          <button
            type="button"
            class="action-btn good"
            :class="{ active: ep.status === 'good' }"
            @click="markStatus(ep, ep.status === 'good' ? 'pending' : 'good')"
          >{{ ep.status === 'good' ? '✓ Good' : 'Mark good' }}</button>
          <button
            type="button"
            class="action-btn"
            :disabled="expanded[ep.videoId]?.loading"
            @click="loadAlts(ep)"
          >
            {{ expanded[ep.videoId]?.loading ? 'Working…' : 'Show alts' }}
          </button>
          <button
            type="button"
            class="action-btn"
            :disabled="expanded[ep.videoId]?.loading"
            @click="reextract(ep)"
          >Re-extract</button>
        </div>
        <div v-if="expanded[ep.videoId]?.alts?.length" class="alts">
          <button
            v-for="alt in expanded[ep.videoId].alts"
            :key="alt.pick"
            type="button"
            class="alt-tile"
            :disabled="expanded[ep.videoId].loading"
            @click="pickAlt(ep, alt.pick)"
          >
            <img :src="alt.url" :alt="`pick ${alt.pick}`" />
            <span class="alt-num">{{ alt.pick }}</span>
          </button>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.debug {
  max-width: 80rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  color: #f5ecd6;
  font-family: 'Barlow', sans-serif;
}

.debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2rem;
}

h1 {
  font-family: 'Barlow Semi Condensed', sans-serif;
  font-size: 1.5rem;
  margin: 0;
}

.filter-bar {
  display: flex;
  gap: 0.5rem;
}

.filter-btn {
  background: rgba(245, 236, 214, 0.04);
  border: 1px solid rgba(245, 236, 214, 0.12);
  color: #c4b89f;
  padding: 0.4rem 0.875rem;
  border-radius: 9999px;
  font-family: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  text-transform: capitalize;
}

.filter-btn.active {
  background: #c89968;
  border-color: #c89968;
  color: #100e0c;
}

.ep-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.ep-row {
  display: grid;
  grid-template-columns: 200px 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem;
  background: rgba(245, 236, 214, 0.03);
  border-radius: 8px;
  border-left: 3px solid transparent;
}

.ep-row.status-good {
  border-left-color: #6fa86f;
}

.ep-thumb {
  width: 200px;
  height: 113px;
  object-fit: cover;
  border-radius: 4px;
  background: #100e0c;
}

.ep-guest {
  font-weight: 600;
  font-size: 1rem;
}

.ep-title {
  font-size: 0.875rem;
  color: #c4b89f;
  margin-top: 0.125rem;
}

.ep-date {
  font-size: 0.75rem;
  color: #6e6859;
  margin-top: 0.25rem;
}

.ep-actions {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.action-btn {
  background: rgba(245, 236, 214, 0.06);
  border: 1px solid rgba(245, 236, 214, 0.1);
  color: #c4b89f;
  padding: 0.4rem 0.875rem;
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  white-space: nowrap;
}

.action-btn:hover:not(:disabled) {
  background: rgba(245, 236, 214, 0.1);
  color: #f5ecd6;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.action-btn.good.active {
  background: rgba(111, 168, 111, 0.2);
  border-color: #6fa86f;
  color: #a8d6a8;
}

.alts {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.alt-tile {
  position: relative;
  background: transparent;
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
}

.alt-tile:hover:not(:disabled) {
  border-color: #c89968;
}

.alt-tile img {
  display: block;
  width: 220px;
  height: 124px;
  object-fit: cover;
}

.alt-num {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(16, 14, 12, 0.8);
  color: #f5ecd6;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.4rem;
  border-radius: 4px;
}
</style>
