export default defineNuxtConfig({
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'DOAC episodes',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'A discovery tool for The Diary of a CEO podcast.' },
      ],
    },
  },
  compatibilityDate: '2025-01-01',
});
