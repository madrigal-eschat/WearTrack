import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    exclude: ['node_modules', 'tests/e2e/**/*.spec.ts'],
  },
});
