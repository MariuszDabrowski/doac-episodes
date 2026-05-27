<script setup>
// Fixed mini-header that slides in when the page is scrolled deep. Parent
// owns the visibility decision (it knows where the brand area ends); we
// just render and animate. On routes other than the home grid, the brand
// becomes a route-to-home shortcut instead of a scroll-to-top, and the
// "Browse categories" button hides (it scrolls to the cluster bar, which
// only exists on the home page).
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useAboutModal } from '@/composables/useAboutModal.js';
import { useFilterContext } from '@/composables/useFilterContext.js';

defineProps({
  visible: { type: Boolean, default: false },
});

const route = useRoute();
const router = useRouter();
const isHome = computed(() => route.path === '/');

const { openAbout } = useAboutModal();

// Carry the last-seen cluster/topic filter across Home/Guests links so
// a user's filter context follows them across all pages (not just the
// two that have URL state for it). Source-of-truth is the filter-context
// composable, updated by HomePage + GuestsIndex when their filter
// changes.
const { carryFilterQuery } = useFilterContext();
const homeLink = computed(() => ({ path: '/', query: carryFilterQuery() }));
const guestsLink = computed(() => ({ path: '/guests', query: carryFilterQuery() }));

function brandClick() {
  if (isHome.value) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    // Carry the filter context so clicking the brand from a subpage
    // returns the user home with their cluster/topic still applied.
    router.push({ path: '/', query: carryFilterQuery() });
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
  <header class="site-header" :class="{ 'is-visible': visible }">
    <div class="site-header-inner">
      <button
        type="button"
        class="header-brand"
        @click="brandClick"
        :aria-label="isHome ? 'Back to top' : 'DOAC episodes home'"
      >DOAC</button>
      <button
        v-if="isHome"
        type="button"
        class="header-browse-button"
        @click="scrollToTop"
      >
        <span aria-hidden="true">↑</span>
        Browse categories
      </button>
      <div class="header-right">
        <RouterLink v-if="!isHome" :to="homeLink" class="header-link">Home</RouterLink>
        <RouterLink :to="guestsLink" class="header-link">Guests</RouterLink>
        <button
          type="button"
          class="header-link header-about-button"
          @click="openAbout"
        >About</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  /* Outer: full-width fixed bar. Horizontal padding matches body main
     so the inner content lines up with the body content's left/right
     edges at every breakpoint. */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  padding: 0.625rem 4rem;
  background: rgba(16, 14, 12, 0.78);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border-bottom: 1px solid rgba(245, 236, 214, 0.09);
  transform: translateY(-100%);
  /* Strong ease-out: feels weighted on the way in without overshooting
     top:0 (which would briefly create a gap above the bar). */
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

@media (max-width: 899px) {
  .site-header {
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
}

.site-header-inner {
  /* Inner: same max-width as the grid below (110rem) with margin auto
     so it tracks the body content alignment exactly. Three equal
     columns with explicit grid-column placement so the brand stays
     left, browse stays centered, and top stays right regardless of
     whether the browse button is rendered. */
  max-width: 110rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  gap: 1.5rem;
}

.header-brand { grid-column: 1; justify-self: start; }
.header-browse-button { grid-column: 2; justify-self: center; }
.header-right {
  grid-column: 3;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.site-header.is-visible {
  transform: translateY(0);
  pointer-events: auto;
}

.header-brand {
  background: transparent;
  border: none;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #f5ecd6;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  /* Negative margin offsets the button's left padding so the "D" lines
     up with the body content's left edge, while keeping the click/hover
     target the same size as the visible text plus padding. */
  margin-left: -0.5rem;
  transition: color 0.15s ease;
}

.header-brand:hover {
  color: #c89968;
}

.header-browse-button {
  justify-self: center;
  background: rgba(245, 236, 214, 0.07);
  border: 1px solid rgba(245, 236, 214, 0.12);
  border-radius: 9999px;
  padding: 0.4rem 1.125rem;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #d4c9ad;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.header-browse-button:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.09);
  color: #f5ecd6;
}

.header-browse-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

.header-link {
  /* Match the outlined .header-browse-button look so Guests/About read
     as siblings of Browse, not a different visual family. */
  background: rgba(245, 236, 214, 0.07);
  border: 1px solid rgba(245, 236, 214, 0.12);
  color: #d4c9ad;
  text-decoration: none;
  /* Asymmetric vertical padding (less top, more bottom) compensates for
     Barlow Semi Condensed's metrics, which leave the optical center of
     uppercase letters sitting ~1px below the line box center under
     line-height: 1. */
  padding: 0.35rem 0.875rem 0.45rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.header-link:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.09);
  color: #f5ecd6;
}

.header-link.router-link-active {
  background: #c89968;
  color: #100e0c;
}

.header-link:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

@media (max-width: 640px) {
  /* Browse-categories button is verbose on phones; the brand + Top are
     enough. Grid + justify-self placement (above) keep the other two
     pinned to left/right regardless of the middle column being empty. */
  .header-browse-button {
    display: none;
  }
}
</style>
