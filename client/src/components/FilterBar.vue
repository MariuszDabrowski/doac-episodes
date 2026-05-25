<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

// Cluster pills (with sliding active indicator) + subtopic sub-row. Parent
// owns the canonical filter values via v-model; this component handles all
// the measurement, transition, and pill-stagger choreography internally.
//
// Cluster value is a string id (e.g. "mind") or "all" for the no-filter
// pseudo-cluster, which is prepended internally and never appears in the
// `clusters` prop.

const props = defineProps({
  clusters: { type: Array, required: true },
  topics: { type: Array, required: true },
  cluster: { type: String, required: true },
  subtopic: { type: [String, null], default: null },
});

const emit = defineEmits(['update:cluster', 'update:subtopic']);

const allClusters = computed(() => [{ id: 'all', label: 'All' }, ...props.clusters]);

const subtopics = computed(() => {
  if (props.cluster === 'all') return [];
  return props.topics.filter((t) => t.cluster === props.cluster);
});

function selectCluster(id) {
  emit('update:cluster', id);
  emit('update:subtopic', null);
}

function selectSubtopic(id) {
  emit('update:subtopic', props.subtopic === id ? null : id);
}

// --- sliding cluster indicator --------------------------------------

const clusterBar = ref(null);
const clusterButtons = ref([]);
const indicatorStyle = ref({ transform: 'translateX(0)', width: '0px' });
const indicatorReady = ref(false); // skip transition until first measurement lands

function updateIndicator() {
  const idx = allClusters.value.findIndex((c) => c.id === props.cluster);
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

watch(() => props.cluster, () => nextTick(updateIndicator));

// --- subtopic transition timing -------------------------------------

// Track the previous cluster's subtopic count so we can skip the leave
// wait entirely when the outgoing bar is empty (e.g., switching from "All").
// Captured synchronously before the watcher chain triggers the Transition.
const previousSubtopicCount = ref(0);

watch(
  () => props.cluster,
  (_, oldVal) => {
    // "all" now renders the hint instead of being truly empty, so treat it
    // as one element so the bar's leave duration stays non-zero and the
    // hint has time to fade out.
    previousSubtopicCount.value =
      oldVal === 'all' ? 1 : props.topics.filter((t) => t.cluster === oldVal).length;
  },
  { flush: 'sync' }
);

const subtopicBarDuration = computed(() => ({
  enter: 800,
  leave: previousSubtopicCount.value > 0 ? 450 : 0,
}));

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
});

onUnmounted(() => {
  window.removeEventListener('resize', updateIndicator);
});
</script>

<template>
  <div class="category-section">
    <div class="cluster-bar-wrapper">
      <div class="cluster-bar" ref="clusterBar">
        <div
          class="cluster-indicator"
          :class="{ 'no-transition': !indicatorReady }"
          :style="indicatorStyle"
        ></div>
        <button
          v-for="c in allClusters"
          :key="c.id"
          ref="clusterButtons"
          class="cluster-item"
          :class="{ active: cluster === c.id }"
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
      <div :key="cluster" class="subtopic-bar">
        <!-- When "All" is selected there are no subtopic pills to render,
             so the bar is otherwise empty. Drop in a hand-drawn nudge
             pointing back up at the category bar instead, since first-time
             visitors won't know the pills are interactive. -->
        <div v-if="cluster === 'all'" class="all-hint" aria-hidden="true">
          <span class="hint-text">pick something you're into</span>
          <svg class="hint-arrow" viewBox="0 0 70 56" fill="none">
            <!-- Single graceful curve sweeping from lower-left up to the
                 arrowhead at top-center. End tangent points upward so the
                 arrowhead reads as "up", aimed at the cluster bar above. -->
            <path
              d="M 4 50 C 22 52, 46 40, 50 7"
              stroke="#c89968"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <!-- Slightly asymmetric chevron so it reads as hand-drawn
                 rather than a perfectly-mirrored triangle. -->
            <path
              d="M 44 13 L 50 7 L 56 14"
              stroke="#c89968"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <button
          v-for="(t, i) in subtopics"
          :key="t.id"
          class="subtopic-pill"
          :class="{ active: subtopic === t.id }"
          :style="{ '--pill-index': i }"
          @click="selectSubtopic(t.id)"
        >
          {{ t.label }}
        </button>
      </div>
    </Transition>

    <!-- Narrow-viewport replacement: two native selects (cluster, then
         optional subtopic). Display flips via CSS at <=1100px. Native
         selects give us free a11y + the right mobile picker on iOS/Android. -->
    <div class="dropdown-filters">
      <select
        class="filter-select"
        :value="cluster"
        @change="(e) => selectCluster(e.target.value)"
        aria-label="Category"
      >
        <option v-for="c in allClusters" :key="c.id" :value="c.id">
          {{ c.label }}
        </option>
      </select>
      <select
        v-if="subtopics.length"
        class="filter-select"
        :value="subtopic || ''"
        @change="(e) => emit('update:subtopic', e.target.value || null)"
        aria-label="Subtopic"
      >
        <option value="">All subtopics</option>
        <option v-for="t in subtopics" :key="t.id" :value="t.id">
          {{ t.label }}
        </option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.category-section {
  max-width: 110rem;
  margin: 0 auto 7rem;
}

.cluster-bar-wrapper {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
}

.cluster-bar {
  position: relative;
  display: inline-flex;
  align-items: center;
  background: #252019;
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
  /* Apple "default" curve: smoother glide than Material's standard. */
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
  color: #d4c9ad;
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

.subtopic-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.25rem;
}

/* "All" state hint: handwritten caption + curved arrow pointing back up
   at the cluster bar. Lives in the same slot as the subtopic pills so
   the FilterBar's bar-swap transition picks it up automatically when
   the cluster changes. */
.all-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
  /* Pivot from the right so the arrow stays anchored to the text as the
     subtopic-bar's leave/enter rotation plays out. */
  transform-origin: right center;
}

.hint-arrow {
  width: 3rem;
  height: 2.5rem;
  /* Lift the SVG so the arrowhead sits closer to the cluster bar above
     instead of hanging level with the text baseline. */
  margin-top: calc(-1rem - 8px);
  opacity: 0.85;
}

.hint-text {
  font-family: 'Caveat', 'Comic Sans MS', cursive;
  font-size: 22px;
  font-weight: 500;
  color: #c89968;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .hint-arrow {
    width: 2.5rem;
    height: 2.25rem;
    margin-top: -0.875rem;
  }
  .hint-text {
    font-size: 1.125rem;
  }
}

.subtopic-pill {
  background: transparent;
  border: 1px solid rgba(245, 236, 214, 0.22);
  color: #d4c9ad;
  padding: 0.4rem 1rem;
  border-radius: 9999px;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  /* Pivot rotation from the left edge: same hinged-on-a-nail feel as the
     result summary text */
  transform-origin: left center;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.subtopic-pill:hover {
  background: rgba(245, 236, 214, 0.09);
  border-color: rgba(245, 236, 214, 0.4);
  color: #f5ecd6;
}

.subtopic-pill.active {
  background: #c89968;
  border-color: #c89968;
  color: #100e0c;
}

/* Atomic bar swap on cluster change. mode="out-in" guarantees the old bar
   finishes leaving before the new one mounts, so there's no layout overlap. */
@keyframes pill-stagger-enter {
  from { opacity: 0; transform: translateY(-28px) rotate(10deg); }
  to { opacity: 1; transform: translateY(0) rotate(0deg); }
}

@keyframes pill-stagger-leave {
  to { opacity: 0; transform: translateY(14px) rotate(-10deg); }
}

.subtopic-bar-enter-active .subtopic-pill {
  /* Strong deceleration: the pill flies in then settles, inertia-like */
  animation: pill-stagger-enter 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--pill-index, 0) * 0.05s);
}

.subtopic-bar-leave-active .subtopic-pill {
  /* Fast start, gentle decel: pill is pushed out rather than dropping slowly */
  animation: pill-stagger-leave 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--pill-index, 0) * 0.05s);
  /* Override the default left-edge pivot: leaving pills hinge on the right */
  transform-origin: right center;
}

/* Fade the "all" hint in/out alongside the subtopic-bar transition. The
   enter delay matches the first pill's stagger delay so the hint feels
   like a sibling of the pills, not a separate layer popping in early. */
@keyframes hint-fade-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes hint-fade-leave {
  to { opacity: 0; transform: translateY(4px); }
}

.subtopic-bar-enter-active .all-hint {
  animation: hint-fade-enter 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.subtopic-bar-leave-active .all-hint {
  animation: hint-fade-leave 0.3s ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .subtopic-bar-enter-active .subtopic-pill,
  .subtopic-bar-leave-active .subtopic-pill,
  .subtopic-bar-enter-active .all-hint,
  .subtopic-bar-leave-active .all-hint {
    animation: none;
  }
}

/* Dropdown alternative for narrow viewports. Hidden by default; CSS
   below swaps it in at <=1100px and hides the desktop pill bars. */
.dropdown-filters {
  display: none;
}

.filter-select {
  appearance: none;
  -webkit-appearance: none;
  background-color: rgba(245, 236, 214, 0.07);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none' stroke='%23c89968' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1.5l5 5 5-5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 1rem center;
  background-size: 12px 8px;
  border: 1px solid rgba(245, 236, 214, 0.12);
  border-radius: 9999px;
  color: #f5ecd6;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  padding: 0.75rem 2.75rem 0.75rem 1.125rem;
  cursor: pointer;
  width: 100%;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.filter-select:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background-color: rgba(245, 236, 214, 0.09);
}

.filter-select:focus {
  outline: none;
  border-color: rgba(200, 153, 104, 0.7);
  background-color: rgba(245, 236, 214, 0.12);
}

/* Native option list comes from the browser; we can only style its
   colors. Keep them on-brand for desktop browsers that show the
   custom-menu (Chrome on macOS, etc.). */
.filter-select option {
  background: #252019;
  color: #f5ecd6;
}

@media (max-width: 899px) {
  /* Narrow widths: swap the pill bars for two compact selects. */
  .cluster-bar-wrapper,
  .subtopic-bar {
    display: none;
  }

  .dropdown-filters {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    max-width: 30rem;
    margin: 0 auto;
  }

  .category-section {
    margin-bottom: 3rem;
  }
}
</style>
