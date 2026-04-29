import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import './style.css';
import { addCollection } from '@iconify/vue';
import { icons as ph } from '@iconify-json/ph';

addCollection(ph);

const app = createApp(App);
app.use(router);
app.mount('#app');
