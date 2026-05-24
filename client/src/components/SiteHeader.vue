<script setup>
// Fixed mini-header that slides in when the page is scrolled deep. Parent
// owns the visibility decision (it knows where the brand area ends); we
// just render and animate.

defineProps({
  visible: { type: Boolean, default: false },
});

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
  <header class="site-header" :class="{ 'is-visible': visible }">
    <button
      type="button"
      class="header-brand"
      @click="scrollToTop"
      aria-label="Back to top"
    >DOAC</button>
    <button
      type="button"
      class="header-browse-button"
      @click="scrollToTop"
    >
      <span aria-hidden="true">↑</span>
      Browse categories
    </button>
    <button
      type="button"
      class="header-top-button"
      @click="scrollToTop"
      aria-label="Back to top"
    >
      <span aria-hidden="true">↑</span>
      Top
    </button>
  </header>
</template>

<style scoped>
.site-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1.5rem;
  padding: 0.625rem 1.5rem;
  background: rgba(16, 14, 12, 0.78);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border-bottom: 1px solid rgba(245, 236, 214, 0.06);
  transform: translateY(-100%);
  /* Strong ease-out: feels weighted on the way in without overshooting
     top:0 (which would briefly create a gap above the bar). */
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
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
  transition: color 0.15s ease;
}

.header-brand:hover {
  color: #c89968;
}

.header-browse-button {
  justify-self: center;
  background: rgba(245, 236, 214, 0.04);
  border: 1px solid rgba(245, 236, 214, 0.12);
  border-radius: 9999px;
  padding: 0.4rem 1.125rem;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #c4b89f;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.header-browse-button:hover {
  border-color: rgba(200, 153, 104, 0.5);
  background: rgba(245, 236, 214, 0.06);
  color: #f5ecd6;
}

.header-browse-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

.header-top-button {
  background: rgba(245, 236, 214, 0.06);
  border: none;
  color: #c4b89f;
  padding: 0.4rem 0.875rem;
  border-radius: 9999px;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.header-top-button:hover {
  background: rgba(245, 236, 214, 0.12);
  color: #f5ecd6;
}

.header-top-button:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

@media (max-width: 640px) {
  /* Browse button is hidden, so collapse the middle 1fr track and let the
     remaining two children land flush in left/right columns (otherwise the
     top button would slide into the now-empty 1fr middle column). */
  .site-header {
    grid-template-columns: auto 1fr;
  }
  .header-browse-button {
    display: none;
  }
  .header-top-button {
    justify-self: end;
  }
}
</style>
