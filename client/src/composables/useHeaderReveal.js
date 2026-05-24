import { onMounted, onUnmounted, ref } from 'vue';

/**
 * Tracks whether the sticky `SiteHeader` should be visible: true once the
 * given sentinel element has scrolled fully above the viewport. The sentinel
 * is typically the results bar — past it, the brand + filters are no longer
 * in view and the mini-header takes over.
 *
 * Usage:
 *   const resultsBarEl = ref(null);
 *   const { showHeader } = useHeaderReveal(resultsBarEl);
 *   // bind ref to the element, pass showHeader to <SiteHeader :visible>.
 */
export function useHeaderReveal(sentinelRef) {
  const showHeader = ref(false);
  let observer = null;

  onMounted(() => {
    if (!sentinelRef.value) return;
    observer = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        // Header shows only when the sentinel is above the viewport
        // (not when it's below, e.g. on a very tall window).
        showHeader.value = !e.isIntersecting && e.boundingClientRect.bottom < 0;
      },
      { threshold: 0 }
    );
    observer.observe(sentinelRef.value);
  });

  onUnmounted(() => {
    observer?.disconnect();
  });

  return { showHeader };
}
