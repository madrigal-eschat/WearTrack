import { describe, it, expect } from 'vitest';
import { targetWearSeconds, maxWearSeconds, remainingWearSeconds } from './wearCalculations.js';

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

describe('remainingWearSeconds', () => {
  it('counts down to target before target is reached', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: 1800 };
    expect(remainingWearSeconds(session, 1000 + 300)).toBe(600);
  });

  it('counts down to max once target is passed, when max is set', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: 1800 };
    expect(remainingWearSeconds(session, 1000 + 1000)).toBe(800);
  });

  it('returns null once max is reached', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: 1800 };
    expect(remainingWearSeconds(session, 1000 + 1800)).toBeNull();
  });

  it('returns null once target is reached when there is no max', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: null };
    expect(remainingWearSeconds(session, 1000 + 900)).toBeNull();
  });

  it('returns null past target with no max even well beyond it', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: null };
    expect(remainingWearSeconds(session, 1000 + 5000)).toBeNull();
  });
});
