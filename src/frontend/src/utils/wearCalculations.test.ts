import { describe, it, expect } from 'vitest';
import { targetWearSeconds, maxWearSeconds } from './wearCalculations.js';

describe('targetWearSeconds', () => {
  it('reads the stored session target', () => {
    expect(targetWearSeconds({ target_wear_seconds: 900 })).toBe(900);
  });
});

describe('maxWearSeconds', () => {
  it('reads the stored session max', () => {
    expect(maxWearSeconds({ max_wear_seconds: 1800 })).toBe(1800);
  });
  it('returns null when there is no maximum', () => {
    expect(maxWearSeconds({ max_wear_seconds: null })).toBeNull();
  });
});
