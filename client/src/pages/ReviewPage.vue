<script setup>
// Dev-only triage UI for editorial review. For each episode, shows the
// current portrait + editable title/description/bio, with controls to
// generate top-5 portrait alts and swap one in. Approval state is
// persisted to data/_portrait-review.json so you can come back to where
// you left off.
import { computed, reactive, ref, onMounted } from 'vue';

const episodes = ref([]);
const filter = ref('pending'); // 'all' | 'pending' | 'good'
const expanded = reactive({}); // videoId → { alts: [], loading: false }
// Page-load stamp: appended to every thumb URL so a reload after a swap
// can't serve a stale browser/Vite-cached copy. Post-swap stamps from the
// API override this per-episode.
const pageStamp = Date.now();

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
  episodes.value = await api('/api/review/episodes');
}

function cacheBustedThumb(ep) {
  // Always include a stamp so reloads also bust any cached copy.
  // After a swap, expanded[…].stamp is set from the API response and wins.
  const stamp = expanded[ep.videoId]?.stamp || pageStamp;
  return `${ep.thumbnail}?t=${stamp}`;
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
  await api('/api/review/approve', { method: 'POST', body: { id: ep.id, status } });
  ep.status = status;
}

async function loadAlts(ep) {
  if (!expanded[ep.videoId]) expanded[ep.videoId] = { alts: [], loading: false };
  expanded[ep.videoId].loading = true;
  try {
    const res = await api('/api/review/alts', { method: 'POST', body: { videoId: ep.videoId } });
    expanded[ep.videoId].alts = res.alts;
  } finally {
    expanded[ep.videoId].loading = false;
  }
}

async function pickAlt(ep, pick) {
  expanded[ep.videoId].loading = true;
  try {
    const res = await api('/api/review/swap', { method: 'POST', body: { videoId: ep.videoId, pick } });
    expanded[ep.videoId].stamp = res.stamp;
    expanded[ep.videoId].alts = []; // collapse the alts strip after picking
  } finally {
    expanded[ep.videoId].loading = false;
  }
}

async function reextract(ep) {
  if (!confirm(`Re-extract 50 frames for ${ep.primaryGuest?.name}? (takes ~1 min)`)) return;
  expanded[ep.videoId] = expanded[ep.videoId] || { alts: [], loading: false };
  expanded[ep.videoId].loading = true;
  try {
    await api('/api/review/reextract', { method: 'POST', body: { videoId: ep.videoId } });
    await loadAlts(ep);
  } finally {
    expanded[ep.videoId].loading = false;
  }
}

// Save handlers fire on blur. v-model keeps the local copy in sync; we POST
// only the fields that belong to this scope. For bios, since one guest can
// appear in many rows, we propagate the change to every row in local state
// so the UI doesn't lie about which value is "live" on the server.
const savedFields = reactive({}); // fieldKey → timestamp; used to flash "saved"

function markSaved(key) {
  savedFields[key] = Date.now();
  // Auto-clear after the visual flash finishes so subsequent saves can
  // re-trigger the animation cleanly.
  setTimeout(() => {
    if (savedFields[key] && Date.now() - savedFields[key] >= 1400) {
      delete savedFields[key];
    }
  }, 1500);
}

function isSaved(key) {
  return savedFields[key] && Date.now() - savedFields[key] < 1400;
}

async function saveEpisode(ep, field) {
  await api('/api/review/edit-episode', {
    method: 'POST',
    body: { id: ep.id, title: ep.title, description: ep.description },
  });
  markSaved(`${ep.id}:${field}`);
}

async function saveGuest(guestId, credibilityLine, fieldKey) {
  await api('/api/review/edit-guest', {
    method: 'POST',
    body: { id: guestId, credibilityLine },
  });
  for (const ep of episodes.value) {
    if (ep.primaryGuest?.id === guestId) ep.primaryGuest.credibilityLine = credibilityLine;
  }
  markSaved(fieldKey);
}

onMounted(fetchEpisodes);
</script>

<template>
  <main class="review">
    <header class="review-header">
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

    <Transition name="list-fade" mode="out-in">
      <ul :key="filter" class="ep-list">
        <li
          v-for="(ep, i) in filtered"
          :key="ep.id"
          class="ep-row"
          :class="[`status-${ep.status}`, { 'is-stagger-target': i < 8 }]"
          :style="{ '--slot-index': i }"
        >
        <div class="ep-name">{{ ep.primaryGuest?.name }}</div>
        <div class="ep-left">
          <img
            :src="cacheBustedThumb(ep)"
            :alt="ep.primaryGuest?.name"
            class="ep-thumb"
          />
          <div class="ep-actions">
            <button
              type="button"
              class="action-btn good"
              :class="{ active: ep.status === 'good' }"
              :title="ep.status === 'good' ? 'Click to unmark, return to Pending' : 'Mark this episode as reviewed'"
              @click="markStatus(ep, ep.status === 'good' ? 'pending' : 'good')"
            >{{ ep.status === 'good' ? 'Good' : 'Mark good' }}</button>
            <button
              type="button"
              class="action-btn"
              :disabled="expanded[ep.videoId]?.loading"
              title="Run auto-portrait on the existing frames and show the top 5 candidates. Click any to swap it in as the primary portrait."
              @click="loadAlts(ep)"
            >
              {{ expanded[ep.videoId]?.loading ? 'Working…' : 'Show portrait alts' }}
            </button>
            <button
              type="button"
              class="action-btn"
              :disabled="expanded[ep.videoId]?.loading"
              title="Wipe this video's cached frames and pull 50 fresh ones, then regenerate the top-5 alts. Use when the existing frames don't include any good shots of the guest. ~1 min."
              @click="reextract(ep)"
            >Re-extract frames</button>
          </div>
        </div>
        <div class="ep-meta">
          <div class="field">
            <input
              v-model="ep.title"
              type="text"
              class="ep-input ep-title-input"
              :class="{ 'just-saved': isSaved(`${ep.id}:title`) }"
              placeholder="Title"
              @blur="saveEpisode(ep, 'title')"
            />
            <span class="saved-flash" :class="{ visible: isSaved(`${ep.id}:title`) }">saved</span>
          </div>
          <div class="field">
            <textarea
              v-model="ep.description"
              class="ep-input ep-description-input"
              :class="{ 'just-saved': isSaved(`${ep.id}:description`) }"
              rows="2"
              placeholder="Description"
              @blur="saveEpisode(ep, 'description')"
            ></textarea>
            <span class="saved-flash" :class="{ visible: isSaved(`${ep.id}:description`) }">saved</span>
          </div>
          <div v-if="ep.primaryGuest" class="field field-bio">
            <textarea
              v-model="ep.primaryGuest.credibilityLine"
              class="ep-input ep-bio-input"
              :class="{ 'just-saved': isSaved(`bio:${ep.primaryGuest.id}`) }"
              rows="2"
              placeholder="Credibility line"
              @blur="saveGuest(ep.primaryGuest.id, ep.primaryGuest.credibilityLine, `bio:${ep.primaryGuest.id}`)"
            ></textarea>
            <span class="saved-flash" :class="{ visible: isSaved(`bio:${ep.primaryGuest.id}`) }">saved</span>
            <span class="ep-bio-hint">
              bio · applies to {{ ep.primaryGuest.appearanceCount }}
              appearance{{ ep.primaryGuest.appearanceCount === 1 ? '' : 's' }}
            </span>
          </div>
          <div class="ep-date">{{ ep.date.slice(0, 10) }} · {{ ep.videoId }}</div>
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
    </Transition>
  </main>
</template>

<style scoped>
.review {
  /* Sized to the row's natural width (200px thumb + gap + 38rem inputs +
     row padding) so the container hugs the content and centers via
     margin: 0 auto. Any wider and rows clung to the left edge. */
  max-width: 57rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  color: #f5ecd6;
  font-family: 'Barlow', sans-serif;
}

.review-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin: 0 0 2rem;
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
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.filter-btn:hover:not(.active) {
  background: rgba(245, 236, 214, 0.08);
  border-color: rgba(245, 236, 214, 0.22);
  color: #f5ecd6;
}

.filter-btn.active {
  background: #c89968;
  border-color: #c89968;
  color: #100e0c;
}

.filter-btn.active:hover {
  background: #d2a576;
  border-color: #d2a576;
}

.ep-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* The whole list fades out before the new (filtered) one mounts. Cards
   stagger themselves in via the keyframe below, so no enter transition
   on the <ul> itself. */
.list-fade-leave-active {
  transition: opacity 0.25s ease;
}

.list-fade-leave-to {
  opacity: 0;
}

@keyframes ep-row-stagger-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Only the first 8 rows animate (mirrors the home page). Anything past
   that pops in instantly so a filter that produces 50+ results doesn't
   spend three seconds revealing rows the user can't see yet. */
.ep-row.is-stagger-target {
  animation: ep-row-stagger-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--slot-index, 0) * 0.06s);
}

@media (prefers-reduced-motion: reduce) {
  .ep-row.is-stagger-target {
    animation: none;
  }
  .list-fade-leave-active {
    transition: opacity 0.15s ease;
  }
}

.ep-row {
  display: grid;
  /* Two columns: thumb+buttons on the left, fields on the right. Name
     spans the full width above; alts strip (when shown) spans below.
     Cap the row width so empty space doesn't trail off to the right on
     wide screens, the fields max out around 38rem anyway. */
  grid-template-columns: 200px minmax(0, 1fr);
  column-gap: 1.5rem;
  row-gap: 0.875rem;
  align-items: start;
  padding: 0.875rem;
  background: rgba(245, 236, 214, 0.03);
  border-radius: 8px;
}

.ep-name {
  grid-column: 1 / -1;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-weight: 600;
  font-size: 1.25rem;
  letter-spacing: 0.01em;
  color: #f5ecd6;
}

.ep-left {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.ep-thumb {
  width: 200px;
  height: 113px;
  object-fit: cover;
  border-radius: 4px;
  background: #100e0c;
}

.ep-input {
  display: block;
  /* Cap at a readable line length (~60 chars at this font size). Otherwise
     text stretches edge-to-edge and skimming is painful. */
  width: 100%;
  max-width: 38rem;
  background: rgba(245, 236, 214, 0.04);
  border: 1px solid rgba(245, 236, 214, 0.08);
  border-radius: 4px;
  color: #f5ecd6;
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.4;
  padding: 0.375rem 0.5rem;
  margin-top: 0.25rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  /* Auto-grow textareas to fit their content (Chrome/Edge 123+, Firefox
     137+, Safari 18+). With the rows attribute as a minimum height, this
     means short bios stay one-line tall and long bios expand fully, no
     internal scrollbars. */
  field-sizing: content;
  resize: none;
}

.ep-input::placeholder {
  color: #4d4a45;
}

.ep-input:focus {
  outline: none;
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.06);
}

.ep-title-input {
  font-weight: 500;
}

.ep-description-input {
  color: #c4b89f;
  line-height: 1.4;
}

.field {
  position: relative;
}

/* Stack subsequent fields with a small gap. The first .field has no top
   margin so its input lines up with the photo on the left. */
.field + .field {
  margin-top: 0.5rem;
}

/* Bio is a different concept from title/description (it's per-guest, not
   per-episode), so give it more visual separation. */
.field-bio {
  margin-top: 1.25rem;
}

.ep-bio-input {
  color: #c4b89f;
  line-height: 1.4;
}

.ep-bio-hint {
  display: block;
  font-size: 0.6875rem;
  color: #6e6859;
  margin-top: 0.5rem;
  letter-spacing: 0.02em;
}

/* Brief "saved" badge that fades in/out after each blur-save so the user
   knows the edit went through (otherwise auto-save-on-blur feels invisible). */
.saved-flash {
  position: absolute;
  top: 0.375rem;
  right: -3.5rem;
  font-size: 0.6875rem;
  color: #6fa86f;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}

.saved-flash.visible {
  opacity: 1;
}

/* Subtle border-color flash on the input itself to reinforce the save. */
.ep-input.just-saved {
  border-color: rgba(111, 168, 111, 0.5);
}

.ep-date {
  font-size: 0.75rem;
  color: #6e6859;
  margin-top: 0.375rem;
}

.ep-actions {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.action-btn {
  background: rgba(245, 236, 214, 0.08);
  border: none;
  color: #f5ecd6;
  padding: 0.5rem 1.125rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  white-space: nowrap;
  /* Softer transition with a slight lift on hover, picks up the warmth
     of the main site's button hovers instead of feeling mechanical. */
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: rgba(245, 236, 214, 0.16);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px -6px rgba(0, 0, 0, 0.4);
}

.action-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 6px -3px rgba(0, 0, 0, 0.3);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.action-btn.good.active {
  background: rgba(111, 168, 111, 0.22);
  color: #a8d6a8;
}

.action-btn.good.active:hover {
  background: rgba(111, 168, 111, 0.32);
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
