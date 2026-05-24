import { computed, ref, watch } from 'vue';

/**
 * Paginates a reactive list and tracks which "batch" should stagger-animate
 * on mount or load-more. `resetKey` is any watchable expression (typically
 * the filter state) — when it changes, the page resets to the first batch.
 *
 * Returns:
 *   displayed     — sliced source up to visibleCount
 *   remaining     — items past visibleCount that the user hasn't seen yet
 *   hasMore       — convenience boolean
 *   staggerStart  — index where the current batch begins (use to drive the
 *                   stagger animation: cards i ∈ [staggerStart, +8) animate)
 *   loadMore      — appends the next page and shifts the stagger window
 */
export function usePagination(source, resetKey, pageSize = 50) {
  const visibleCount = ref(pageSize);
  const staggerStart = ref(0);

  const displayed = computed(() => source.value.slice(0, visibleCount.value));
  const remaining = computed(() => Math.max(0, source.value.length - visibleCount.value));
  const hasMore = computed(() => remaining.value > 0);

  function loadMore() {
    staggerStart.value = visibleCount.value;
    visibleCount.value += pageSize;
  }

  // Reset both pagination cursor and stagger window when the upstream key
  // changes (e.g. on filter change). Otherwise "X remaining" goes stale and
  // a result set that shrunk below pageSize would still show page-2.
  watch(resetKey, () => {
    visibleCount.value = pageSize;
    staggerStart.value = 0;
  });

  return { displayed, remaining, hasMore, staggerStart, loadMore };
}
