import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import HomePage from './pages/HomePage.vue';
import DebugPortraits from './pages/DebugPortraits.vue';
import './assets/css/main.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage },
    { path: '/debug-portraits', component: DebugPortraits },
  ],
  // Match Nuxt's default behavior: jump to top on navigation, restore on back/forward.
  scrollBehavior(_to, _from, saved) {
    return saved || { top: 0 };
  },
});

createApp(App).use(router).mount('#app');
