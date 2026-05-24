<script setup>
import { computed, ref, onUnmounted } from 'vue';
import { RouterLink } from 'vue-router';

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

// Data stores the JPG path as canonical; the WebP/AVIF siblings are emitted
// alongside it by scripts/auto-portrait.py. Derive them by extension swap.
function asFormat(path, ext) {
  return path ? path.replace(/\.jpg$/, ext) : null;
}

function srcset(oneX, twoX) {
  if (!oneX) return undefined;
  return twoX ? `${oneX} 1x, ${twoX} 2x` : oneX;
}

const portraitSrcsetAvif = computed(() =>
  srcset(asFormat(portraitSrc.value, '.avif'), asFormat(portrait2xSrc.value, '.avif'))
);
const portraitSrcsetWebp = computed(() =>
  srcset(asFormat(portraitSrc.value, '.webp'), asFormat(portrait2xSrc.value, '.webp'))
);
const portraitSrcsetJpg = computed(() => srcset(portraitSrc.value, portrait2xSrc.value));

const portraitAlt = computed(() => props.guests[0]?.name || '');

const expanded = ref(false);

const extraGuests = computed(() => props.guests.slice(1));
const hiddenGuestCount = computed(() => props.guests.length - 1);

// Overflow detection for credibility lines, only show the bottom fade
// indicator + enable hover-to-expand on bios that actually overflow the
// 3-line clamp. Uses a single ResizeObserver across all credibility
// elements in this card. The callback toggles a class directly on the
// element (no reactive re-render needed for a simple class flip).
let credibilityObserver = null;

function watchCredibility(el) {
  if (!el) return;
  if (!credibilityObserver) {
    credibilityObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        // Skip while any part of the card is hovered OR the credibility is
        // explicitly tap-expanded. Without this, the element grows →
        // observer measures expanded state → removes .has-overflow → CSS
        // rule drops → collapses → re-overflows → yo-yo. Card-wide hover
        // covers the desktop hover trigger; .is-expanded covers the touch
        // tap-to-expand trigger.
        const card = target.closest('.card');
        if (card?.matches(':hover')) continue;
        if (target.classList.contains('is-expanded')) continue;
        const overflowing = target.scrollHeight > target.clientHeight + 1;
        target.classList.toggle('has-overflow', overflowing);
      }
    });
  }
  credibilityObserver.observe(el);
}

// Click/tap toggle for touch devices (no hover). Also harmless on
// hover-capable devices: clicking the bio after hovering it just pins
// it open until the next click.
function toggleCredibility(e) {
  const el = e.currentTarget;
  if (el.classList.contains('has-overflow')) {
    el.classList.toggle('is-expanded');
  }
}

onUnmounted(() => {
  if (credibilityObserver) credibilityObserver.disconnect();
});

// Display at most two topic pills per card so the actions row never wraps
// to a second line, which left a loose gap next to the last pill and
// floated the Watch button onto its own row. The full topic list still
// drives filtering and search.
const displayedTopics = computed(() => props.episode.topics.slice(0, 2));

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
          <picture v-if="portraitSrc">
            <source type="image/avif" :srcset="portraitSrcsetAvif" />
            <source type="image/webp" :srcset="portraitSrcsetWebp" />
            <img
              :src="portraitSrc"
              :srcset="portraitSrcsetJpg"
              :alt="portraitAlt"
              class="portrait-img"
              loading="lazy"
              decoding="async"
              @load="$event.target.classList.add('is-loaded')"
            />
          </picture>
          <span v-else class="portrait-placeholder" aria-hidden="true">portrait</span>
        </div>
      </a>

      <div class="guest-block">
        <div v-if="guests[0]" :key="guests[0].id" class="guest">
          <div class="guest-name-row">
            <span class="guest-name">{{ guests[0].name }}</span>
            <span class="appearance-pill">{{ ordinal(appearanceCounts[0]) }} appearance</span>
          </div>
          <div
            v-if="guests[0].credibilityLine"
            :ref="watchCredibility"
            class="credibility"
            @click="toggleCredibility"
          >{{ guests[0].credibilityLine }}</div>
        </div>

        <div
          v-if="extraGuests.length"
          class="extra-guests"
          :class="{ expanded }"
        >
          <div class="extra-inner">
            <div v-for="(guest, i) in extraGuests" :key="guest.id" class="guest">
              <div class="guest-name-row">
                <span class="guest-name">{{ guest.name }}</span>
                <span class="appearance-pill">{{ ordinal(appearanceCounts[i + 1]) }} appearance</span>
              </div>
              <div
                v-if="guest.credibilityLine"
                :ref="watchCredibility"
                class="credibility"
                @click="toggleCredibility"
              >{{ guest.credibilityLine }}</div>
            </div>
          </div>
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
        <div class="content-block">
          <div class="episode-block">
          <h3 class="title">{{ episode.title }}</h3>
          <p class="description">{{ episode.description }}</p>
        </div>

        <div class="actions-row">
          <div class="topic-pills">
            <RouterLink
              v-for="t in displayedTopics"
              :key="t"
              :to="`/?topic=${t}`"
              class="topic-pill"
            >
              {{ topicsById[t]?.label || t }}
            </RouterLink>
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
  /* Fade in once the file has loaded and decoded so the image doesn't
     pop in over the dark placeholder. For cached images, `load` fires
     immediately on hydration and the fade is essentially instant. */
  opacity: 0;
  transition: opacity 0.4s ease;
}

.portrait-img.is-loaded {
  opacity: 1;
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
}

/* Animate the open/close via grid-template-rows 0fr -> 1fr. The grid row
   itself collapses to 0 height when closed (content clipped by overflow);
   the card and the row in the parent grid auto-follow. */
.extra-guests {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

.extra-guests.expanded {
  grid-template-rows: 1fr;
}

.extra-inner {
  overflow: hidden;
}

/* Explicit margins (instead of the old flex gap) so the collapsed
   .extra-guests at 0 height doesn't leave a phantom gap above the pill. */
.extra-inner > .guest {
  margin-top: 1rem;
}

.more-guests-pill {
  margin-top: 1rem;
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
  position: relative;
  max-height: 4.5em; /* 3 lines × 1.5 line-height */
  overflow: hidden;
  /* Isolates layout/style work to this subtree, when max-height animates
     the browser doesn't have to re-layout the whole card chain each frame. */
  contain: layout style;
}

/* Hover-to-expand. Bios that already fit in 3 lines stay static -
   no fade, no cursor change, no dead hover. */
.credibility.has-overflow {
  cursor: help;
  /* mask-image fades the TEXT itself; the card background shows through
     transparently, so we don't need to color-match (which is fragile
     across the page's radial gradient). */
  -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
  transition: max-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
              -webkit-mask-image 0.25s ease,
              mask-image 0.25s ease;
}

/* Trigger expansion from the entire left side of the card:
   - the whole .left-col expands the primary guest's bio, including all the
     padding/gap areas between the portrait, name, and bio (otherwise the
     mouse would drop hover whenever it crossed a gap)
   - secondary guests in the +N more expansion still expand on hover of
     their own .guest block
   - direct hover on the credibility itself remains supported */
.credibility.has-overflow:hover,
.credibility.has-overflow.is-expanded,
.guest:hover .credibility.has-overflow,
.left-col:hover .guest-block > .guest:first-child .credibility.has-overflow {
  max-height: max-content;
  -webkit-mask-image: linear-gradient(to bottom, #000 100%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 100%, transparent 100%);
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
  /* Align to flex-end so the Watch button hugs the bottom of the (possibly
     wrapped) pill block instead of centering against it and floating up. */
  align-items: flex-end;
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

.watch-button {
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
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.watch-button:hover {
  background: #f0c890;
}

@media (max-width: 639px) {
  /* Stack the card vertically with the episode content (title +
     description + actions) above the guest's name and bio. `display:
     contents` on .left-col lets us treat its children (.portrait-link
     and .guest-block) as direct grid items of .card so we can reorder
     them with grid-template-areas. Above 640px the original side-by-side
     horizontal tile stays. */
  .card {
    grid-template-columns: 1fr;
    grid-template-areas:
      "portrait"
      "content"
      "guest";
    position: relative; /* anchor for the episode badge over the portrait */
    /* Tint the card surface to match the content-block color, so the
       diagonal cut at the portrait's bottom edge reveals the same shade
       as the section directly below it (instead of the dim transparent
       default that read as a dark triangular gap). */
    background: #1c1916;
  }
  .left-col { display: contents; }
  .portrait-link { grid-area: portrait; }
  .guest-block {
    grid-area: guest;
    /* Card surface is tinted #1c1916 for the slant trick above. Restore
       the page-bg shade here so the bio sits on the same near-black
       backdrop as on desktop, instead of inheriting the brown tint. */
    background: #100e0c;
  }
  .right-col {
    grid-area: content;
    /* Drop the positioned-ancestor status so the .episode-badge inside
       resolves its absolute positioning against .card, not this column.
       The badge lands in the card's top-right, i.e. over the portrait. */
    position: static;
  }

  /* Portrait gets the angled top-right notch (where the badge sits) and
     keeps the diagonal bottom slant. With the card background tinted to
     match the content-block (see .card above), the cut reveals the same
     color as the section below, so the slant reads as a seam instead of
     a gap. */
  .portrait {
    clip-path: polygon(
      0 0,
      calc(100% - 159px) 0,
      100% 32px,
      100% calc(100% - 16px),
      0 100%
    );
  }
  .content-block {
    clip-path: none;
  }
}

@media (max-width: 640px) {
  /* Topic pills above, Watch button as a full-width tap target below. */
  .actions-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.875rem;
  }

  .watch-button {
    width: 100%;
    padding: 0.625rem 1rem;
  }

  /* No hover on touch, and the tap-to-expand affordance is invisible
     when you can't see the mask fade. Just show the full bio. */
  .credibility {
    max-height: none;
  }
  .credibility.has-overflow {
    cursor: default;
    -webkit-mask-image: none;
    mask-image: none;
  }
}
</style>
