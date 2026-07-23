import { request } from '@playwright/test';

/**
 * Runs once before the entire Playwright suite.
 * Wipes all rows from every table so each run starts from a clean slate —
 * the SQLite equivalent of database_cleaner.
 */
export default async function globalSetup() {
  const ctx = await request.newContext({
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
  });
  const res = await ctx.post('/api/__reset');
  if (!res.ok()) {
    throw new Error(`DB reset failed: ${res.status()} ${await res.text()}`);
  }
  await ctx.dispose();
}
