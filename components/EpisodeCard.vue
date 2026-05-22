<script setup>
const props = defineProps({
  episode: { type: Object, required: true },
  guests: { type: Array, required: true },
  appearanceCounts: { type: Array, required: true },
  rolesById: { type: Object, required: true },
  topicsById: { type: Object, required: true },
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
  return Object.entries(byType).map(([type, items]) => ({
    type,
    items,
    label: items.length === 1 ? `a ${type}` : `${items.length} ${type}s`,
  }));
});
</script>

<template>
  <article class="card">
    <div class="top-row">
      <a class="portrait-link" :href="episode.links.youtube" target="_blank" rel="noopener">
        <div class="portrait" aria-hidden="true">
          <span class="portrait-placeholder">portrait</span>
        </div>
      </a>
      <dl class="meta">
        <div class="meta-row">
          <dt class="meta-label">Date</dt>
          <dd class="meta-value">{{ fmtDate(episode.date) }}</dd>
        </div>
        <div v-if="guests[0]" class="meta-row">
          <dt class="meta-label">Order</dt>
          <dd class="meta-value">{{ ordinal(appearanceCounts[0]) }} appearance</dd>
        </div>
        <div class="meta-row">
          <dt class="meta-label">Topics</dt>
          <dd class="meta-value meta-topics">
            <span v-for="t in episode.topics" :key="t" class="topic-tag">
              {{ topicsById[t]?.label || t }}
            </span>
          </dd>
        </div>
      </dl>
    </div>

    <div class="episode-block">
      <h3 class="title">{{ episode.title }}</h3>
      <p class="description">{{ episode.description }}</p>
    </div>

    <div class="guest-block">
      <div v-for="guest in guests" :key="guest.id" class="guest">
        <div class="guest-name">{{ guest.name }}</div>
        <div v-if="guest.credibilityLine" class="credibility">{{ guest.credibilityLine }}</div>
      </div>

      <div v-if="guestPromotionGroups.length" class="promoting">
        Promoting <template v-for="(g, i) in guestPromotionGroups" :key="g.type"><span
          v-if="i > 0 && i === guestPromotionGroups.length - 1"
        >{{ guestPromotionGroups.length > 2 ? ', and ' : ' and ' }}</span><span
          v-else-if="i > 0"
        >, </span><span class="hint">
          {{ g.label }}<span class="tooltip" role="tooltip">
            <a
              v-for="item in g.items"
              :key="item.title"
              :href="item.link"
              target="_blank"
              rel="noopener"
              class="tooltip-link"
            >{{ item.title }}</a>
          </span>
        </span></template>.
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

.top-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 1rem;
  padding: 1rem;
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

.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.meta-row {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.meta-label {
  margin: 0;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.075em;
  color: #a1a1aa;
  font-weight: 500;
}

.meta-value {
  margin: 0;
  font-size: 0.8125rem;
  color: #27272a;
}

.meta-topics {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.topic-tag {
  background: #f4f4f5;
  color: #3f3f46;
  padding: 0.125rem 0.5rem;
  font-size: 0.7rem;
}

.episode-block {
  padding: 0 1rem 1rem;
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
