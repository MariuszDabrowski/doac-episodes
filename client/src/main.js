import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import HomePage from './pages/HomePage.vue';
import './assets/css/main.css';

// HomePage is the entry route, so eager-import it. /guest/:slug and
// /review are only reached after the user navigates; lazy-import them
// so they don't bloat the initial bundle (especially /review, which is
// dev-only and never loaded in prod). Vite/Rollup splits each dynamic
// import into its own chunk.
const GuestPage = () => import('./pages/GuestPage.vue');
const GuestsIndex = () => import('./pages/GuestsIndex.vue');
const ReviewPage = () => import('./pages/ReviewPage.vue');

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
    { path: '/guests', component: GuestsIndex },
    { path: '/guest/:slug', component: GuestPage },
    { path: '/review', component: ReviewPage },
  ],
  // Defer scroll-to-top until after the page-fade leave transition has
  // finished. Without the delay, the user sees the current page jump to
  // the top WHILE it's fading out, which reads as a glitch. Same-route
  // navigations (cluster/topic query updates from FilterBar clicks) skip
  // scrolling entirely - the user is already in the right spot and a
  // jump would feel broken.
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.path === from.path) return false;
    return new Promise((resolve) => {
      setTimeout(() => resolve({ top: 0 }), 420);
    });
  },
});

createApp(App).use(router).mount('#app');
