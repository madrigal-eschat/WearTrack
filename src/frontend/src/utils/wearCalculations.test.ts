import { describe, it, expect } from 'vitest';
import { maxWearSeconds } from './wearCalculations';

describe('maxWearSeconds', () => {
  it('returns initial duration unchanged for multiplier of 1', () => {
    expect(maxWearSeconds({ initial_wear_duration_seconds: 3600 }, { difficulty_multiplier: 1 })).toBe(3600);
  });

  it('scales down for multiplier less than 1', () => {
    expect(maxWearSeconds({ initial_wear_duration_seconds: 3600 }, { difficulty_multiplier: 0.5 })).toBe(1800);
  });

  it('scales up for multiplier greater than 1', () => {
    expect(maxWearSeconds({ initial_wear_duration_seconds: 3600 }, { difficulty_multiplier: 2 })).toBe(7200);
  });

  it('returns 0 for zero multiplier', () => {
    expect(maxWearSeconds({ initial_wear_duration_seconds: 3600 }, { difficulty_multiplier: 0 })).toBe(0);
  });
});
