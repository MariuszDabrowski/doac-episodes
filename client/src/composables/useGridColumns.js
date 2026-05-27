import { onMounted, onUnmounted, ref } from 'vue';

// Track the active grid column count (1 / 2 / 3) based on viewport width.
// Mirrors the breakpoints in HomePage.vue and GuestPage.vue so callers
// can compute things like "how many filler tiles do I need to round the
// last row out?" without hard-coding the same thresholds in template logic.
//
// Update via matchMedia listeners (not resize) so we only react when the
// breakpoint actually crosses, not on every pixel of scroll-bar reflow.

const BREAKPOINTS = [
  { minWidth: 1200, columns: 2 },
  { minWidth: 0, columns: 1 },
];

function detect() {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth;
  for (const b of BREAKPOINTS) {
    if (w >= b.minWidth) return b.columns;
  }
  return 1;
}

export function useGridColumns() {
  const columns = ref(detect());

  const queries = BREAKPOINTS.filter((b) => b.minWidth > 0).map((b) =>
    window.matchMedia(`(min-width: ${b.minWidth}px)`)
  );

  function update() {
    columns.value = detect();
  }

  onMounted(() => {
    update();
    queries.forEach((q) => q.addEventListener('change', update));
  });

  onUnmounted(() => {
    queries.forEach((q) => q.removeEventListener('change', update));
  });

  return { columns };
}
