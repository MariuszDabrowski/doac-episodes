<script setup>
// Floating dust / speck atmosphere shared across every page. Three depth
// layers (far: slow + small + dim + blurred, mid, close: fast + large +
// bright + sharp) drift upward and pulse independently. Deterministic
// values from index math instead of Math.random() so the SSR output and
// client hydration agree and the scene doesn't reseed on every reload.

const SPECK_LAYERS = [
  { sizeBase: 1.2, durationBase: 42, driftRange: 8, opacityBase: 0.2, blur: 1.2 },
  { sizeBase: 2.0, durationBase: 30, driftRange: 14, opacityBase: 0.4, blur: 0.5 },
  { sizeBase: 3.4, durationBase: 20, driftRange: 22, opacityBase: 0.6, blur: 0 },
];

// Saturated warm-amber palette so the specks survive blending over the
// dark warm background.
const SPECK_COLORS = [
  '#fff4d4',
  '#fde68a',
  '#fcd34d',
  '#fbbf24',
  '#f59e0b',
  '#d97706',
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
</script>

<template>
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
</template>

<style scoped>
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

@media (prefers-reduced-motion: reduce) {
  .speck {
    animation: none;
    opacity: var(--peak, 0.18);
  }
}

/* Cut the speck count on mobile: the filter: blur() / brightness() pulse
   animation is GPU-expensive, and 42 of them compositing under a scroll
   makes phones drop frames. Keeping 12 (4 per depth layer, since layer
   = i % 3) preserves the atmosphere without the cost. */
@media (max-width: 899px) {
  .speck:nth-child(n + 13) {
    display: none;
  }
}
</style>
