import type { Plugin } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { icons } from '@phosphor-icons/core';
import { buildPhCategories } from './src/utils/phCategories.js';

/**
 * Vite plugin: generates src/generated/ph-categories.json at build start.
 * Runs on both `vite dev` and `vite build`.
 */
export default function phCategoriesPlugin(): Plugin {
  return {
    name: 'ph-categories',
    buildStart() {
      const data = buildPhCategories(
        icons as unknown as Array<{
          name: string;
          categories: string[];
          tags: string[];
        }>,
      );
      // Resolve relative to this file (not process.cwd()), which differs when
      // Vite runs in middleware mode from a different working directory (e.g.
      // the backend dev server importing the frontend app).
      const outDir = fileURLToPath(
        new URL('./src/generated', import.meta.url),
      );
      mkdirSync(outDir, { recursive: true });
      const outFile = fileURLToPath(
        new URL('./src/generated/ph-categories.json', import.meta.url),
      );
      writeFileSync(outFile, JSON.stringify(data));
    },
  };
}
