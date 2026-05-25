import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import HomePage from './pages/HomePage.vue';
import GuestPage from './pages/GuestPage.vue';
import ReviewPage from './pages/ReviewPage.vue';
import './assets/css/main.css';

// Belt-and-suspenders: index.html sets history.scrollRestoration =
// 'manual' before navigation starts so the browser doesn't try to
// restore the previous scroll position on refresh. Even with that,
// scroll *into* the page during the initial Vue boot can land us below
// the top, so explicitly scroll to top once mount completes.
window.scrollTo(0, 0);

const router = createRouter({
  // Use Vite's BASE_URL so the router base matches the build base. In prod
  // it's '/doac-episodes/'; in dev it's '/'.
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: HomePage },
    { path: '/guest/:slug', component: GuestPage },
    { path: '/review', component: ReviewPage },
  ],
  // Jump to top on navigation, restore on back/forward.
  scrollBehavior(_to, _from, saved) {
    return saved || { top: 0 };
  },
});

createApp(App).use(router).mount('#app');
