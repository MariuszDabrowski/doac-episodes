<script setup>
import { onMounted, onUnmounted, nextTick, ref, watch } from 'vue';

// Generic accessible modal. Parent passes `open` (one-way) and listens for
// `close`. Implements the WAI-ARIA dialog pattern: focus moves to the panel
// on open, Tab/Shift+Tab cycle within the panel, Escape and backdrop click
// emit close, and focus is restored to the previously-active element when
// the modal closes.

const props = defineProps({
  open: { type: Boolean, required: true },
  title: { type: String, default: '' },
});
const emit = defineEmits(['close']);

const panel = ref(null);
let previousFocus = null;
// Stable id so screen readers can associate the heading with the dialog.
const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      previousFocus = document.activeElement;
      nextTick(() => panel.value?.focus());
    } else {
      previousFocus?.focus?.();
      previousFocus = null;
    }
  }
);

function onKeydown(e) {
  if (!props.open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }
  if (e.key !== 'Tab' || !panel.value) return;
  const focusables = panel.value.querySelectorAll(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Transition name="modal-fade">
    <div
      v-if="open"
      class="modal-backdrop"
      @click.self="emit('close')"
    >
      <div
        ref="panel"
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        tabindex="-1"
      >
        <button
          type="button"
          class="modal-close"
          @click="emit('close')"
          aria-label="Close"
        >×</button>
        <h2 v-if="title" :id="titleId" class="modal-title">{{ title }}</h2>
        <slot />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(8, 7, 6, 0.7);
  backdrop-filter: blur(8px) saturate(120%);
  -webkit-backdrop-filter: blur(8px) saturate(120%);
}

.modal-panel {
  position: relative;
  max-width: 32rem;
  width: 100%;
  padding: 1.75rem 2rem 1.75rem;
  /* Subtle top-to-bottom warm gradient instead of a flat slab, so the
     panel reads like part of the same gold-leaning palette as the site
     brand and not a generic dark dialog. */
  background: linear-gradient(180deg, #221e1a 0%, #1c1916 70%);
  border: 1px solid rgba(245, 236, 214, 0.08);
  border-radius: 12px;
  box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.6);
  color: #c4b89f;
  font-size: 0.9375rem;
  line-height: 1.6;
  /* Hide overflow so the top gold accent (::before) clips to the rounded
     corners instead of poking past them. */
  overflow: hidden;
  /* tabindex=-1 lets us focus the panel programmatically without a visible
     ring. Focus is then carried by the internal interactive elements. */
  outline: none;
}

/* Thin gold accent fading out at the edges, runs along the top of the
   panel. Same gradient family as the .site-brand text in HomePage and
   the favicon, ties the modal to the brand instead of feeling generic. */
.modal-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(200, 153, 104, 0.7) 50%,
    transparent 100%
  );
}

.modal-title {
  margin: 0 0 1rem;
  font-family: 'Barlow Semi Condensed', -apple-system, sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  /* Brand-matching gradient text, mirrors .site-brand. */
  background: linear-gradient(135deg, #f5ecd6 0%, #c89968 50%, #f5ecd6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.modal-close {
  position: absolute;
  top: 0.625rem;
  right: 0.875rem;
  background: transparent;
  border: none;
  color: #a89e8c;
  font-size: 1.75rem;
  line-height: 1;
  width: 2rem;
  height: 2rem;
  cursor: pointer;
  border-radius: 9999px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.modal-close:hover {
  color: #f5ecd6;
  background: rgba(245, 236, 214, 0.06);
}

.modal-close:focus-visible {
  outline: 2px solid #c89968;
  outline-offset: 2px;
}

/* Slotted content typography. :deep() so the rules apply to the parent's
   slot content rather than only the local template. */
.modal-panel :deep(p) {
  margin: 0 0 1rem;
}

.modal-panel :deep(p:last-child) {
  margin-bottom: 0;
}

.modal-panel :deep(ul) {
  margin: 0 0 1.25rem;
  padding-left: 1.125rem;
}

.modal-panel :deep(li) {
  margin-bottom: 0.5rem;
}

.modal-panel :deep(li:last-child) {
  margin-bottom: 0;
}

.modal-panel :deep(li::marker) {
  color: rgba(200, 153, 104, 0.6);
}

.modal-panel :deep(a) {
  color: #f5ecd6;
  text-decoration: underline;
  text-decoration-color: rgba(200, 153, 104, 0.5);
  text-underline-offset: 3px;
  transition: text-decoration-color 0.15s ease;
}

.modal-panel :deep(a:hover) {
  text-decoration-color: #c89968;
}

.modal-panel :deep(strong) {
  color: #f5ecd6;
  font-weight: 600;
}

/* Backdrop fades; panel rises a touch from below on entry and sinks back
   down on leave. Translate-only (no scale) keeps the motion subtle. */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.4s ease;
}

.modal-fade-enter-active .modal-panel,
.modal-fade-leave-active .modal-panel {
  transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from .modal-panel,
.modal-fade-leave-to .modal-panel {
  opacity: 0;
  transform: translateY(20px);
}
</style>
