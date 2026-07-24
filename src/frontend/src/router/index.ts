import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Items from '../views/Items.vue'
import Stats from '../views/Stats.vue'
import Setup from '../views/Setup.vue'
import Settings from '../views/Settings.vue'
import Log from '../views/Log.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/items', component: Items },
    { path: '/stats', component: Stats },
    { path: '/setup', component: Setup },
    { path: '/settings', component: Settings },
    { path: '/log', component: Log },
  ],
})

export default router
