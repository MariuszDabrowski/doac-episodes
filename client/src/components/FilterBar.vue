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
    previousSubtopicCount.value =
      oldVal === 'all' ? 0 : props.topics.filter((t) => t.cluster === oldVal).length;
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
  /* Pivot rotation from the left edge: same hinged-on-a-nail feel as the
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

@media (prefers-reduced-motion: reduce) {
  .subtopic-bar-enter-active .subtopic-pill,
  .subtopic-bar-leave-active .subtopic-pill {
    animation: none;
  }
}
</style>
