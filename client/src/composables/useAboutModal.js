import { ref } from 'vue';

// Singleton ref so both the SiteHeader (always reachable) and any
// page-level "About" CTA (the corner button on the home hero) toggle the
// same modal mounted at App.vue.
const aboutOpen = ref(false);

export function useAboutModal() {
  return {
    aboutOpen,
    openAbout: () => {
      aboutOpen.value = true;
    },
    closeAbout: () => {
      aboutOpen.value = false;
    },
  };
}
