import { describe, it, expect } from 'vitest';
import { targetWearSeconds, maxWearSeconds, remainingWearSeconds, lapCount, lapFillFraction, lapTier, fillUpFraction, decayFillFraction, decayTimeLeft } from './wearCalculations.js';

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

describe('lapCount', () => {
  it('is 0 before the first lap completes', () => {
    expect(lapCount(50, 100)).toBe(0);
  });

  it('counts completed laps', () => {
    expect(lapCount(350, 100)).toBe(3);
  });
});

describe('lapFillFraction', () => {
  it('matches plain elapsed/target before the first wrap', () => {
    expect(lapFillFraction(40, 100)).toBeCloseTo(0.4);
  });

  it('wraps back to 0 exactly at a multiple of target', () => {
    expect(lapFillFraction(300, 100)).toBe(0);
  });

  it('wraps partway through a later lap', () => {
    expect(lapFillFraction(350, 100)).toBeCloseTo(0.5);
  });
});

describe('lapTier', () => {
  it.each([
    [0, 0], [1, 0], [2, 1], [3, 2], [4, 2], [5, 3], [7, 3], [8, 4], [20, 4],
  ])('lapTier(%i) === %i', (count, tier) => {
    expect(lapTier(count)).toBe(tier);
  });
});

describe('fillUpFraction', () => {
  it('is 0 when no time has elapsed (remaining === total)', () => {
    expect(fillUpFraction(100, 100)).toBeCloseTo(0);
  });

  it('is 1 once remaining reaches 0', () => {
    expect(fillUpFraction(0, 100)).toBe(1);
  });

  it('interpolates between the two', () => {
    expect(fillUpFraction(25, 100)).toBeCloseTo(0.75);
  });
});

describe('decayFillFraction', () => {
  it('is full (1) right at decay_start_time', () => {
    expect(decayFillFraction(1000, 1000, 2000)).toBeCloseTo(1);
  });

  it('is empty (0) at decay_full_time', () => {
    expect(decayFillFraction(2000, 1000, 2000)).toBeCloseTo(0);
  });

  it('un-fills linearly between the two', () => {
    expect(decayFillFraction(1500, 1000, 2000)).toBeCloseTo(0.5);
  });

  it('clamps to 0 past decay_full_time', () => {
    expect(decayFillFraction(3000, 1000, 2000)).toBe(0);
  });
});

describe('decayTimeLeft', () => {
  it('counts down to decay_full_time', () => {
    expect(decayTimeLeft(1500, 2000)).toBe(500);
  });

  it('floors at 0 past decay_full_time', () => {
    expect(decayTimeLeft(2500, 2000)).toBe(0);
  });
});
