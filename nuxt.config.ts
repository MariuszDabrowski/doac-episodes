export default defineNuxtConfig({
  modules: ['@nuxt/fonts'],
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  fonts: {
    families: [
      { name: 'Barlow', weights: [400, 500, 600, 700] },
      { name: 'Barlow Semi Condensed', weights: [400, 500, 600, 700] },
    ],
  },
  app: {
    head: {
      title: 'DOAC episodes',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'A discovery tool for The Diary of a CEO podcast.' },
      ],
      script: [
        { src: 'https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.5.7/lottie.min.js', defer: true },
      ],
    },
  },
  compatibilityDate: '2025-01-01',
});
