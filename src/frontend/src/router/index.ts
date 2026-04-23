import { createRouter, createWebHistory } from 'vue-router';
import Home from '../views/Home.vue';
import Items from '../views/Items.vue';
import Stats from '../views/Stats.vue';
import Setup from '../views/Setup.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/items', component: Items },
    { path: '/stats', component: Stats },
    { path: '/setup', component: Setup },
  ],
});

export default router;
