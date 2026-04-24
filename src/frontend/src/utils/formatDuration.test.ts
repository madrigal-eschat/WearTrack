import { describe, it, expect } from 'vitest';
import { formatDuration, shortDuration } from './formatDuration';

describe('formatDuration', () => {
  it('returns "0s" for zero or negative', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('returns seconds only when under a minute', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('returns minutes and seconds when under an hour', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('returns hours and minutes when at least an hour', () => {
    expect(formatDuration(3723)).toBe('1h 2m');
  });
});

describe('shortDuration', () => {
  it('returns "0m" for zero or negative', () => {
    expect(shortDuration(0)).toBe('0m');
    expect(shortDuration(-60)).toBe('0m');
  });

  it('returns minutes only when under an hour', () => {
    expect(shortDuration(125)).toBe('2m');
  });

  it('returns hours only when at least an hour', () => {
    expect(shortDuration(3723)).toBe('1h');
  });
});
