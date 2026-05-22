import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import phCategoriesPlugin from './vite-plugin-ph-categories.js';

export default defineConfig({
  plugins: [
    phCategoriesPlugin(),
    tailwindcss(),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,gif}'],
      },
      manifest: {
        name: 'Weartrack',
        short_name: 'Weartrack',
        description: 'Track your wearable usage',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  base: './',
});
