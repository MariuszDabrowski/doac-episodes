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

const TARGET_BRIGHTNESS = 0.06;
const FALLBACK_SCRIM = 0.65;

const scrimOpacity = computed(() => {
  const b = props.guests[0]?.portraitBrightness;
  if (!b) return FALLBACK_SCRIM;
  const calculated = 1 - TARGET_BRIGHTNESS / b;
  return Math.max(0, Math.min(0.88, calculated));
});

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
    <a
      class="card-bg-link"
      :href="episode.links.youtube"
      target="_blank"
      rel="noopener"
      :aria-label="`Watch ${episode.title} on YouTube`"
    >
      <img
        v-if="guests[0]?.portrait"
        :src="guests[0].portrait"
        :srcset="guests[0].portrait2x ? `${guests[0].portrait} 1x, ${guests[0].portrait2x} 2x` : undefined"
        :alt="guests[0].name"
        class="card-bg-img"
      />
      <span v-else class="portrait-placeholder" aria-hidden="true">portrait</span>
    </a>

    <div class="card-grid">
      <div class="left-col">
        <div class="guest-block">
          <div v-for="(guest, gi) in guests" :key="guest.id" class="guest">
            <div class="guest-name-row">
              <span class="guest-name">{{ guest.name }}</span>
              <span v-if="gi === 0" class="appearance-pill">{{ ordinal(appearanceCounts[0]) }} appearance</span>
            </div>
            <div v-if="guest.credibilityLine" class="credibility">{{ guest.credibilityLine }}</div>
          </div>
        </div>
      </div>

    <div class="right-col">
      <div class="content-block">
        <span class="episode-date">{{ fmtDate(episode.date) }}</span>
        <div class="episode-block">
          <div v-if="episode.episodeNumber" class="episode-meta">
            <span class="episode-number">Ep {{ episode.episodeNumber }}</span>
          </div>
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

      <div v-if="guestPromotionGroups.length" class="promotes-block">
        <div class="promoting">
          Promotes <template v-for="(g, i) in guestPromotionGroups" :key="g.type"><span
            v-if="i > 0 && i === guestPromotionGroups.length - 1"
          >{{ guestPromotionGroups.length > 2 ? ', and ' : ' and ' }}</span><span
            v-else-if="i > 0"
          >, </span>{{ g.prefix }}<span class="hint">{{ g.typeWord }}<span class="tooltip" role="tooltip">
            <a
              v-for="item in g.items"
              :key="item.title"
              :href="item.link"
              target="_blank"
              rel="noopener"
              class="tooltip-link"
            >{{ item.title }}</a>
          </span></span></template> in this episode.
        </div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  background: linear-gradient(90deg, #0d0d10 0%, #2c2c2f 100%);
  overflow: hidden;
  border-radius: 5px;
}

.card-bg-link {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: block;
  text-decoration: none;
  color: inherit;
}

.card-bg-img {
  width: auto;
  height: 100%;
  display: block;
  mask-image: linear-gradient(to right, black 0%, black 70%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, black 0%, black 70%, transparent 100%);
}

.card-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 45% 1fr;
  min-height: 320px;
}

.left-col {
  position: relative;
}

.right-col {
  display: flex;
  flex-direction: column;
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
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1;
  background: rgba(9, 9, 11, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: calc(0.875rem + 28px) 1rem 0.875rem;
  clip-path: polygon(0 28px, 100% 0, 100% 100%, 0 100%);
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
  color: #fafafa;
}

.appearance-pill {
  background: rgba(255, 255, 255, 0.12);
  color: #e4e4e7;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
}

.credibility {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #d4d4d8;
}

.content-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #1d1d20 0%, #0d0d10 100%);
  border-bottom-left-radius: 8px;
  box-shadow: -4px 4px 16px rgba(0, 0, 0, 0.2);
  position: relative;
  z-index: 2;
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

.title {
  margin: 0;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1.3125rem;
  font-weight: 600;
  line-height: 1.25;
  color: #fde68a;
}

.description {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: #a1a1aa;
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
  background: rgba(96, 165, 250, 0.12);
  color: #93c5fd;
  padding: 0.25rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.topic-pill:hover {
  background: rgba(96, 165, 250, 0.22);
  color: #bfdbfe;
}

.watch-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.875rem;
  background: #1e3a5f;
  color: #f5f7fb;
  border: none;
  border-radius: 4px;
  text-decoration: none;
  font-weight: 500;
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  transition: background-color 0.15s ease;
}

.watch-button:hover {
  background: #2b507f;
}

.promotes-block {
  position: relative;
  z-index: 1;
  margin-top: -8px;
  background: rgba(9, 9, 11, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: calc(0.875rem + 8px) 1rem 0.875rem;
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
