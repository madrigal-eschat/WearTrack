import app from '../src/server.js';

const CATEGORIES = '/api/categories';
const ITEMS = '/api/items';

export const sampleCategory = {
  name: 'Footwear',
  icon: 'figure.walk',
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 6,
  minimum_rest: 86400,
  risk_levels: [
    { lower: null, upper: 14400, text: 'safe', severity: 1 },
    { lower: 14400, upper: 28800, text: 'moderate', severity: 2 },
    { lower: 28800, upper: null, text: 'high', severity: 3 },
  ],
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
};

export async function createCategory(overrides: Record<string, unknown> = {}) {
  return app.request(CATEGORIES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...sampleCategory, ...overrides }),
  });
}

export async function createItem(categoryId: number, overrides: Record<string, unknown> = {}) {
  return app.request(ITEMS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Shoe', category_id: categoryId, color: '#ff0000', ...overrides }),
  });
}
