import { describe, it, expect } from 'vitest';
import {
  SWATCHES,
  MAX_LIGHTNESS,
  randomSwatchColor,
  buildOklch,
} from './colors';

describe('SWATCHES', () => {
  it('has 12 entries', () => {
    expect(SWATCHES).toHaveLength(12);
  });

  it('all use MAX_LIGHTNESS', () => {
    for (const s of SWATCHES) {
      expect(s).toContain(`oklch(${MAX_LIGHTNESS} `);
    }
  });

  it('covers hues 0–330 in 30° steps', () => {
    const hues = SWATCHES.map((s) => {
      const m = s.match(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/);
      return m ? parseFloat(m[1]) : null;
    });
    expect(hues).toEqual([
      0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330,
    ]);
  });
});

describe('randomSwatchColor', () => {
  it('returns a value from SWATCHES', () => {
    const color = randomSwatchColor();
    expect(SWATCHES).toContain(color);
  });
});

describe('buildOklch', () => {
  it('assembles a CSS oklch string with MAX_LIGHTNESS', () => {
    expect(buildOklch(0.15, 240)).toBe(`oklch(${MAX_LIGHTNESS} 0.15 240)`);
  });

  it('rounds chroma to 2 decimal places', () => {
    expect(buildOklch(0.2000001, 180)).toBe(`oklch(${MAX_LIGHTNESS} 0.2 180)`);
  });

  it('rounds hue to nearest integer', () => {
    expect(buildOklch(0.15, 180.7)).toBe(`oklch(${MAX_LIGHTNESS} 0.15 181)`);
  });
});
