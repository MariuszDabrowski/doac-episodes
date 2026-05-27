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
  let attachTimeout = null;

  onMounted(() => {
    if (!sentinelRef.value) return;
    // Defer the observer attach so the router's async scrollBehavior
    // has time to scroll us to the top after a forward navigation.
    // Without this delay, the first observation can read the previous
    // page's scroll position and flash the mini-header on during the
    // entry fade. 500ms covers the 420ms scroll delay plus a buffer.
    attachTimeout = setTimeout(() => {
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
    }, 500);
  });

  onUnmounted(() => {
    clearTimeout(attachTimeout);
    observer?.disconnect();
  });

  return { showHeader };
}
