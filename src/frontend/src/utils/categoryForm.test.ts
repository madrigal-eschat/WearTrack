import { describe, it, expect } from 'vitest';
import { categoryToFormState, formStateToApiPayload } from './categoryForm.js';
import type { CategoryApiShape } from './categoryForm.js';

const BASE_CATEGORY: CategoryApiShape = {
  id: 1,
  name: 'Earrings',
  icon: '💎',
  initial_wear_duration_seconds: 900,
  rest_multiplier: 2,
  rest_constant_seconds: 86400,
  break_decay_multiplier: 1,
  break_starts_after_seconds: 300,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
};

describe('categoryToFormState', () => {
  it('maps scalar fields correctly', () => {
    const state = categoryToFormState(BASE_CATEGORY);
    expect(state.name).toBe('Earrings');
    expect(state.icon).toBe('💎');
    expect(state.initialWearSeconds).toBe(900);
    expect(state.restMultiplier).toBe(2);
  });

  it('derives bandCount from risk_levels length', () => {
    expect(categoryToFormState(BASE_CATEGORY).bandCount).toBe(3);
  });

  it('extracts crossoverPoints from band upper boundaries (excluding last band)', () => {
    expect(categoryToFormState(BASE_CATEGORY).crossoverPoints).toEqual([3600, 7200]);
  });

  it('returns empty crossoverPoints for a 1-band category', () => {
    const cat: CategoryApiShape = {
      ...BASE_CATEGORY,
      risk_levels: [{ lower: null, upper: null, text: 'Medium', severity: 1 }],
    };
    const state = categoryToFormState(cat);
    expect(state.bandCount).toBe(1);
    expect(state.crossoverPoints).toEqual([]);
  });

  it('handles 5 bands with 4 crossover points', () => {
    const cat: CategoryApiShape = {
      ...BASE_CATEGORY,
      risk_levels: [
        { lower: null,  upper: 1800, text: 'Lowest',  severity: 1 },
        { lower: 1800,  upper: 3600, text: 'Low',     severity: 2 },
        { lower: 3600,  upper: 5400, text: 'Medium',  severity: 3 },
        { lower: 5400,  upper: 7200, text: 'High',    severity: 4 },
        { lower: 7200,  upper: null, text: 'Highest', severity: 5 },
      ],
    };
    const state = categoryToFormState(cat);
    expect(state.bandCount).toBe(5);
    expect(state.crossoverPoints).toEqual([1800, 3600, 5400, 7200]);
  });

  it('round-trips through formStateToApiPayload', () => {
    const state = categoryToFormState(BASE_CATEGORY);
    const payload = formStateToApiPayload(state);
    expect(payload.name).toBe(BASE_CATEGORY.name);
    expect(payload.icon).toBe(BASE_CATEGORY.icon);
    expect(payload.initial_wear_duration_seconds).toBe(BASE_CATEGORY.initial_wear_duration_seconds);
    expect(payload.rest_multiplier).toBe(BASE_CATEGORY.rest_multiplier);
    expect(payload.risk_levels).toEqual(BASE_CATEGORY.risk_levels);
  });
});

describe('formStateToApiPayload', () => {
  it('maps scalar fields to snake_case keys', () => {
    const payload = formStateToApiPayload({
      name: 'Test',
      icon: '🎯',
      initialWearSeconds: 1800,
      restMultiplier: 1.5,
      bandCount: 2,
      crossoverPoints: [3600],
    });
    expect(payload.name).toBe('Test');
    expect(payload.icon).toBe('🎯');
    expect(payload.initial_wear_duration_seconds).toBe(1800);
    expect(payload.rest_multiplier).toBe(1.5);
  });

  it('builds risk_levels via buildRiskLevels', () => {
    const payload = formStateToApiPayload({
      name: 'x',
      icon: 'x',
      initialWearSeconds: 900,
      restMultiplier: 2,
      bandCount: 2,
      crossoverPoints: [3600],
    });
    expect(payload.risk_levels).toEqual([
      { lower: null, upper: 3600, text: 'Low',  severity: 1 },
      { lower: 3600, upper: null, text: 'High', severity: 2 },
    ]);
  });

  it('does not include rest_constant_seconds or break fields (callers add those)', () => {
    const payload = formStateToApiPayload({
      name: 'x',
      icon: 'x',
      initialWearSeconds: 0,
      restMultiplier: 1,
      bandCount: 1,
      crossoverPoints: [],
    });
    expect('rest_constant_seconds' in payload).toBe(false);
    expect('break_decay_multiplier' in payload).toBe(false);
    expect('break_starts_after_seconds' in payload).toBe(false);
  });
});
