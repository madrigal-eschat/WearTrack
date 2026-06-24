import type { Plugin } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
        icons as unknown as Array<{ name: string; categories: string[]; tags: string[] }>,
      );
      const outDir = join(process.cwd(), 'src', 'generated');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'ph-categories.json'), JSON.stringify(data));
    },
  };
}
