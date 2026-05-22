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
    <a class="portrait-link" :href="episode.links.youtube" target="_blank" rel="noopener">
      <div class="portrait">
        <img
          v-if="guests[0]?.portrait"
          :src="guests[0].portrait"
          :alt="guests[0].name"
          class="portrait-img"
        />
        <span v-else class="portrait-placeholder" aria-hidden="true">portrait</span>
        <div class="overlay overlay-bottom-left">
          <span class="chip">{{ fmtDate(episode.date) }}</span>
        </div>
        <div v-if="guests[0]" class="overlay overlay-bottom-right">
          <span class="chip">{{ ordinal(appearanceCounts[0]) }} appearance</span>
        </div>
      </div>
    </a>

    <div class="episode-block">
      <h3 class="title">{{ episode.title }}</h3>
      <p class="description">{{ episode.description }}</p>
    </div>

    <div class="topics-row">
      <NuxtLink
        v-for="t in episode.topics"
        :key="t"
        :to="`/?topic=${t}`"
        class="topic-pill"
      >
        {{ topicsById[t]?.label || t }}
      </NuxtLink>
    </div>

    <div class="guest-block">
      <div v-for="guest in guests" :key="guest.id" class="guest">
        <div class="guest-name">{{ guest.name }}</div>
        <div v-if="guest.credibilityLine" class="credibility">{{ guest.credibilityLine }}</div>
      </div>

      <div v-if="guestPromotionGroups.length" class="promoting">
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
  </article>
</template>

<style scoped>
.card {
  background: #fff;
  border: 1px solid #e4e4e7;
  transition: border-color 0.15s ease;
  display: flex;
  flex-direction: column;
}

.card:hover {
  border-color: #a1a1aa;
}

.portrait-link {
  display: block;
  text-decoration: none;
  color: inherit;
}

.portrait {
  position: relative;
  aspect-ratio: 16 / 9;
  background: linear-gradient(135deg, #d4d4d8, #71717a);
  overflow: hidden;
}

.portrait-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.overlay {
  position: absolute;
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  z-index: 1;
}

.overlay-bottom-left {
  bottom: 0.5rem;
  left: 0.5rem;
}

.overlay-bottom-right {
  bottom: 0.5rem;
  right: 0.5rem;
}

.chip {
  background: rgba(255, 255, 255, 0.92);
  color: #18181b;
  padding: 0.125rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 500;
  white-space: nowrap;
}

.episode-block {
  padding: 1rem 1rem 0.75rem;
}

.title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.3;
  color: #18181b;
}

.description {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #52525b;
}

.topics-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  padding: 0 1rem 1rem;
}

.topic-pill {
  background: #f4f4f5;
  color: #3f3f46;
  padding: 0.25rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.topic-pill:hover {
  background: #18181b;
  color: #fff;
}

.guest-block {
  background: #fafafa;
  border-top: 1px solid #e4e4e7;
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.guest-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #18181b;
}

.credibility {
  margin-top: 0.125rem;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: #52525b;
}

.promoting {
  font-size: 0.8125rem;
  color: #6b3a05;
  line-height: 1.45;
}

.hint {
  position: relative;
  border-bottom: 1px dotted currentColor;
  cursor: help;
}

.tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  background: #18181b;
  color: #fff;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
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
  color: #fff;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.tooltip-link:hover {
  text-decoration: none;
}
</style>
