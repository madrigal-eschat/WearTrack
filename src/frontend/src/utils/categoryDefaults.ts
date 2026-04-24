import type { Category } from '../composables/useWear.js';

export type CategoryDefaults = Omit<Category, 'id' | 'name' | 'icon'>;

export const DEFAULT_CATEGORY_FIELDS: CategoryDefaults = {
  initial_wear_duration_seconds: 900,
  rest_multiplier: 2,
  rest_constant_seconds: 86400,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
  break_decay_multiplier: 0.75,
  break_starts_after_seconds: 604800,
};
