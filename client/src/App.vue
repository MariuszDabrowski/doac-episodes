<script setup>
import { RouterView } from 'vue-router';
import AppAtmosphere from './components/AppAtmosphere.vue';
import BaseModal from './components/BaseModal.vue';
import { useAboutModal } from './composables/useAboutModal.js';

const { aboutOpen, closeAbout } = useAboutModal();
</script>

<template>
  <AppAtmosphere />
  <RouterView v-slot="{ Component, route }">
    <Transition name="page-fade" mode="out-in">
      <!-- Key by route.path (not fullPath) so guest-to-guest navigations
           (/guest/scott -> /guest/jay) get the same fade transition that
           cross-page navigations do. Query-only changes like ?cluster=X
           stay on the same key, so HomePage's filter-change pattern
           still works without re-mounting the whole page. -->
      <component :is="Component" :key="route.path" />
    </Transition>
  </RouterView>
  <BaseModal
    :open="aboutOpen"
    title="About this project"
    @close="closeAbout"
  >
    <p>
      <em>The Diary of a CEO</em> has hundreds of long-form interviews,
      but most fall out of YouTube's feed within weeks of release. The
      back catalog is full of conversations that hold up years later:
      they just aren't the ones the algorithm surfaces. This is a
      calmer way to browse the whole catalog and find them:
    </p>
    <ul>
      <li>Editorial titles and short summaries written for browsing, not for the YouTube feed.</li>
      <li>
        A credibility line for every guest (credentials, current role,
        notable books) so you can tell whether they fit the topic
        before committing ninety minutes.
      </li>
      <li>
        Filter by the topics you care about. Every episode equally
        visible, sorted only by date.
      </li>
    </ul>
    <p>
      Built by
      <a
        href="https://www.linkedin.com/in/mariuszpdabrowski/"
        target="_blank"
        rel="noopener"
      >Mariusz Dabrowski</a>.
      Source on
      <a
        href="https://github.com/MariuszDabrowski/doac-episodes"
        target="_blank"
        rel="noopener"
      >GitHub</a>.
    </p>
  </BaseModal>
</template>

<style>
/* Cross-page fade transition. mode="out-in" guarantees the old page is
   gone before the new one mounts, so the SiteHeader and grid don't
   overlap mid-animation. Short and gentle so navigation feels snappy. */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.4s ease;
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .page-fade-enter-active,
  .page-fade-leave-active {
    transition: none;
  }
}
</style>
