import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import HomePage from './pages/HomePage.vue';
import ReviewPage from './pages/ReviewPage.vue';
import './assets/css/main.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage },
    { path: '/review', component: ReviewPage },
  ],
  // Jump to top on navigation, restore on back/forward.
  scrollBehavior(_to, _from, saved) {
    return saved || { top: 0 };
  },
});

createApp(App).use(router).mount('#app');
