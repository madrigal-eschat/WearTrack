/**
 * Build-output assertions.
 *
 * These tests read the compiled dist/index.html to catch configuration
 * regressions that only manifest in production.
 *
 * Requires a prior build:  npm run build
 *
 * Why: Vite's `base: './'` produces relative asset paths (./assets/…).
 * When the SPA's catch-all serves index.html for a deep route like /items,
 * the browser resolves './assets/index.js' relative to /items/ and requests
 * /items/assets/index.js — which returns index.html (not JS) — and the app
 * never mounts.  `base: '/'` fixes this with absolute paths.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

const distIndex = resolve(__dirname, '../../dist/index.html');

describe('Vite build output', () => {
  beforeAll(() => {
    if (!existsSync(distIndex)) {
      throw new Error(
        `dist/index.html not found — run 'npm run build' before this ` +
          `test suite.`,
      );
    }
  });

  it('script src attributes use absolute paths (not relative)', () => {
    const html = readFileSync(distIndex, 'utf-8');
    const relativeScripts = [...html.matchAll(/src="(\.[^"]+)"/g)]
      .map((m) => m[1]);
    expect(
      relativeScripts,
      'Script src paths must be absolute (/assets/…), not relative ' +
        '(./assets/…). Check that vite.config.ts has base: \'/\'.',
    ).toEqual([]);
  });

  it('link href attributes for CSS/manifest use absolute paths', () => {
    const html = readFileSync(distIndex, 'utf-8');
    // Ignore favicon — it's fine as /favicon.ico (already absolute)
    const relativeLinks = [...html.matchAll(/href="(\.[^"]+)"/g)]
      .map((m) => m[1]);
    expect(
      relativeLinks,
      'Link href paths must be absolute (/assets/…), not relative ' +
        '(./assets/…). Check that vite.config.ts has base: \'/\'.',
    ).toEqual([]);
  });
});
