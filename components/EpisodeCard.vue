<script setup>
const props = defineProps({
  episode: { type: Object, required: true },
  guests: { type: Array, required: true },
  appearanceCounts: { type: Array, required: true },
  rolesById: { type: Object, required: true },
  topicsById: { type: Object, required: true },
});

const PLURAL_OF = {
  book: 'books',
  product: 'products',
  company: 'companies',
  course: 'courses',
  service: 'services',
};

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Portrait sources: episode-level thumbnail wins (per-episode shot, different
// for each appearance of a recurring guest). Falls back to the guest's
// canonical portrait when the episode doesn't have its own yet.
const portraitSrc = computed(() => {
  return props.episode.thumbnail || props.guests[0]?.portrait || null;
});

const portrait2xSrc = computed(() => {
  return props.episode.thumbnail2x || props.guests[0]?.portrait2x || null;
});

const portraitAlt = computed(() => props.guests[0]?.name || '');

const expanded = ref(false);

const visibleGuests = computed(() =>
  expanded.value ? props.guests : props.guests.slice(0, 1)
);

const hiddenGuestCount = computed(() => props.guests.length - 1);

// Stick-man Lottie animation that pops out of the watch button on hover.
// Lottie is loaded globally via CDN (see nuxt.config.ts).
const bodymovinRef = ref(null);
let lottieAnim = null;
let isAnimationRunning = false;

function startLoop() {
  if (!lottieAnim) return;
  lottieAnim.loop = true;
  lottieAnim.removeEventListener('complete', startLoop);
  lottieAnim.playSegments([9, 13], true);
}

function onContentEnter() {
  if (!lottieAnim || isAnimationRunning) return;
  isAnimationRunning = true;
  bodymovinRef.value?.classList.remove('bodymovin--hidden');
  lottieAnim.loop = false;
  lottieAnim.setDirection(1);
  lottieAnim.playSegments([0, 8], true);
  lottieAnim.addEventListener('complete', startLoop);
}

function onContentLeave() {
  if (!lottieAnim) return;
  bodymovinRef.value?.classList.add('bodymovin--hidden');
  isAnimationRunning = false;
  lottieAnim.removeEventListener('complete', startLoop);
}

onMounted(() => {
  // Wait for the CDN-loaded lottie global to be available before init.
  function init() {
    if (!window.lottie || !bodymovinRef.value) return;
    lottieAnim = window.lottie.loadAnimation({
      container: bodymovinRef.value,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: '/animations/stick-man.json',
    });
    lottieAnim.setSpeed(2.6);
  }
  if (window.lottie) {
    init();
  } else {
    const interval = setInterval(() => {
      if (window.lottie) {
        clearInterval(interval);
        init();
      }
    }, 50);
    // Stop polling if the component unmounts before lottie loads
    onUnmounted(() => clearInterval(interval));
  }
});

onUnmounted(() => {
  if (lottieAnim) {
    lottieAnim.destroy();
    lottieAnim = null;
  }
});

const guestPromotionGroups = computed(() => {
  const byType = {};
  for (const p of props.episode.promotions || []) {
    if (p.by !== 'guest') continue;
    if (!byType[p.type]) byType[p.type] = [];
    byType[p.type].push(p);
  }
  return Object.entries(byType).map(([type, items]) => {
    const count = items.length;
    const typeWord = count === 1 ? type : PLURAL_OF[type] || `${type}s`;
    return {
      type,
      items,
      prefix: count === 1 ? 'a ' : `${count} `,
      typeWord,
    };
  });
});
</script>

<template>
  <article class="card">
    <div class="left-col">
      <a
        class="portrait-link"
        :href="episode.links.youtube"
        target="_blank"
        rel="noopener"
        :aria-label="`Watch ${episode.title} on YouTube`"
      >
        <div class="portrait">
          <img
            v-if="portraitSrc"
            :src="portraitSrc"
            :srcset="portrait2xSrc ? `${portraitSrc} 1x, ${portrait2xSrc} 2x` : undefined"
            :alt="portraitAlt"
            class="portrait-img"
          />
          <span v-else class="portrait-placeholder" aria-hidden="true">portrait</span>
        </div>
      </a>

      <div class="guest-block">
        <div v-for="(guest, gi) in visibleGuests" :key="guest.id" class="guest">
          <div class="guest-name-row">
            <span class="guest-name">{{ guest.name }}</span>
            <span class="appearance-pill">{{ ordinal(appearanceCounts[gi]) }} appearance</span>
          </div>
          <div v-if="guest.credibilityLine" class="credibility">{{ guest.credibilityLine }}</div>
        </div>
        <button
          v-if="guests.length > 1"
          type="button"
          class="more-guests-pill"
          @click="expanded = !expanded"
        >
          {{ expanded ? 'Show less' : `+${hiddenGuestCount} more guest${hiddenGuestCount === 1 ? '' : 's'}` }}
        </button>
      </div>
    </div>

    <div class="right-col">
      <span v-if="episode.episodeNumber" class="episode-badge">Ep {{ episode.episodeNumber }}</span>
      <div class="content-shape">
        <div class="content-block" @mouseenter="onContentEnter" @mouseleave="onContentLeave">
          <div class="episode-block">
          <h3 class="title">{{ episode.title }}</h3>
          <p class="description">{{ episode.description }}</p>
        </div>

        <div class="actions-row">
          <div class="topic-pills">
            <NuxtLink
              v-for="t in episode.topics"
              :key="t"
              :to="`/?topic=${t}`"
              class="topic-pill"
            >
              {{ topicsById[t]?.label || t }}
            </NuxtLink>
          </div>
          <div class="watch-wrapper">
            <span ref="bodymovinRef" class="bodymovin bodymovin--hidden" aria-hidden="true"></span>
            <a
              class="watch-button"
              :href="episode.links.youtube"
              target="_blank"
              rel="noopener"
            >
              Watch
            </a>
          </div>
        </div>
        </div>
      </div>

    </div>
  </article>
</template>

<style scoped>
.card {
  background: rgba(245, 236, 214, 0.03);
  display: grid;
  grid-template-columns: 45% 1fr;
  overflow: hidden;
  border-radius: 8px;
}

.left-col,
.right-col {
  display: flex;
  flex-direction: column;
}

.right-col {
  position: relative;
}

.portrait-link {
  display: block;
  text-decoration: none;
  color: inherit;
}

.portrait {
  position: relative;
  width: 100%;
  padding-bottom: 56.25%;
  /* Dark placeholder so any sub-pixel gap at the card's rounded corner is
     invisible against the page background, not a bright silver halo. */
  background: #100e0c;
  overflow: hidden;
  flex-shrink: 0;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 16px), 0 100%);
  box-shadow: inset 0 -55px 40px -18px rgba(0, 0, 0, 0.9);
}

.portrait-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.portrait-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.55;
}

.guest-block {
  background: transparent;
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.guest-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.guest-name {
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: #f5ecd6;
}

.appearance-pill {
  background: rgba(245, 236, 214, 0.06);
  color: #a89e8c;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
}

.more-guests-pill {
  align-self: flex-start;
  background: rgba(245, 236, 214, 0.06);
  border: none;
  color: #c4b89f;
  padding: 0.3rem 0.75rem;
  border-radius: 9999px;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.more-guests-pill:hover {
  background: rgba(245, 236, 214, 0.12);
  color: #f5ecd6;
}

.more-guests-pill:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

.credibility {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #a89e8c;
}

.content-shape {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
  margin-bottom: 20px;
  border-bottom-left-radius: 8px;
  overflow: hidden;
}

.content-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1c1916;
  clip-path: polygon(0 0, calc(100% - 159px) 0, 100% 32px, 100% 100%, 0 100%);
}

.episode-badge {
  position: absolute;
  top: 6px;
  right: 10px;
  padding: 0;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #a89e8c;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  z-index: 2;
}

.episode-date {
  position: absolute;
  top: 0;
  right: 0;
  background: #131316;
  color: #52525b;
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 500;
  z-index: 1;
  border-bottom-left-radius: 2px;
}

.episode-block {
  flex: 1;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.episode-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: #a1a1aa;
  letter-spacing: 0.02em;
  margin-bottom: -0.25rem;
}

.episode-number {
  font-weight: 600;
  color: #71717a;
  text-decoration: underline;
  text-decoration-color: #3f3f46;
  text-underline-offset: 4px;
  text-decoration-thickness: 1px;
}

.title {
  margin: 0;
  padding-right: 30px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1.3125rem;
  font-weight: 600;
  line-height: 1.25;
  color: #f5ecd6;
}

.description {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: #a89e8c;
}

.actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0 1rem 1rem;
}

.topic-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.topic-pill {
  background: transparent;
  border: 1px solid rgba(245, 236, 214, 0.22);
  color: #c4b89f;
  padding: 0.2rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  text-decoration: none;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.topic-pill:hover {
  border-color: #c89968;
  color: #f5ecd6;
}

.watch-wrapper {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.watch-button {
  position: relative;
  z-index: 2; /* sits above the bodymovin so it can hide behind */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.4rem 1rem;
  background: #c89968;
  color: #100e0c;
  border: none;
  border-radius: 9999px;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  transition: background 0.2s ease;
}

.bodymovin {
  width: 42px;
  height: 23px;
  position: absolute;
  top: -21px; /* head peeks above the button */
  right: 6px;
  z-index: 1; /* behind the button so it disappears behind when descending */
  pointer-events: none;
  transition: transform 0s;
}

.bodymovin--hidden {
  transform: translateY(24px);
  /* Quick drop so rapid hover-jumping reads as one stick man, not many */
  transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.watch-button:hover {
  background: #f0c890;
}

.promotes-block {
  background: transparent;
  padding: 0.75rem 1rem;
}

.promoting {
  font-size: 0.8125rem;
  color: #6b6b73;
  line-height: 1.5;
  text-align: center;
}

.hint {
  position: relative;
  border-bottom: 1px solid #71717a;
  cursor: help;
}

.tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  background: #fafafa;
  color: #18181b;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  white-space: nowrap;
  border-radius: 2px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.15s ease, visibility 0.15s ease;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: max-content;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 8px;
}

.hint:hover .tooltip,
.hint:focus-within .tooltip,
.hint .tooltip:hover {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.tooltip-link {
  color: #18181b;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.tooltip-link:hover {
  text-decoration: none;
}
</style>
