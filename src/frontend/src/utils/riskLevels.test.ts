import { describe, it, expect } from 'vitest';
import { bandNamesForCount, bandColorsForCount, buildRiskLevels } from './riskLevels';

describe('bandNamesForCount', () => {
  it('returns ["Medium"] for 1 band', () => {
    expect(bandNamesForCount(1)).toEqual(['Medium']);
  });
  it('returns ["Low","High"] for 2 bands', () => {
    expect(bandNamesForCount(2)).toEqual(['Low', 'High']);
  });
  it('returns ["Low","Medium","High"] for 3 bands', () => {
    expect(bandNamesForCount(3)).toEqual(['Low', 'Medium', 'High']);
  });
  it('returns ["Lower","Low","High","Higher"] for 4 bands', () => {
    expect(bandNamesForCount(4)).toEqual(['Lower', 'Low', 'High', 'Higher']);
  });
  it('returns ["Lowest","Low","Medium","High","Highest"] for 5 bands', () => {
    expect(bandNamesForCount(5)).toEqual(['Lowest', 'Low', 'Medium', 'High', 'Highest']);
  });
});

describe('buildRiskLevels', () => {
  it('builds 1 band with null lower and upper', () => {
    expect(buildRiskLevels(1, [])).toEqual([
      { lower: null, upper: null, text: 'Medium', severity: 1 },
    ]);
  });
  it('builds 2 bands with one crossover', () => {
    expect(buildRiskLevels(2, [3600])).toEqual([
      { lower: null, upper: 3600, text: 'Low', severity: 1 },
      { lower: 3600, upper: null, text: 'High', severity: 2 },
    ]);
  });
  it('builds 3 bands with two crossovers', () => {
    expect(buildRiskLevels(3, [3600, 7200])).toEqual([
      { lower: null, upper: 3600, text: 'Low', severity: 1 },
      { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
      { lower: 7200, upper: null, text: 'High', severity: 3 },
    ]);
  });
  it('builds 5 bands with correct names and severity', () => {
    const result = buildRiskLevels(5, [3600, 7200, 10800, 14400]);
    expect(result).toEqual([
      { lower: null, upper: 3600, text: 'Lowest', severity: 1 },
      { lower: 3600, upper: 7200, text: 'Low', severity: 2 },
      { lower: 7200, upper: 10800, text: 'Medium', severity: 3 },
      { lower: 10800, upper: 14400, text: 'High', severity: 4 },
      { lower: 14400, upper: null, text: 'Highest', severity: 5 },
    ]);
  });
  it('sets lower null on first band and upper null on last band', () => {
    const result = buildRiskLevels(4, [1800, 3600, 7200]);
    expect(result[0].lower).toBeNull();
    expect(result[3].upper).toBeNull();
    expect(result[1].lower).toBe(1800);
    expect(result[2].upper).toBe(7200);
  });
});

describe('bounds validation', () => {
  it('bandNamesForCount throws for count 0', () => {
    expect(() => bandNamesForCount(0)).toThrow('must be 1–5');
  });
  it('bandNamesForCount throws for count 6', () => {
    expect(() => bandNamesForCount(6)).toThrow('must be 1–5');
  });
  it('bandColorsForCount throws for count 0', () => {
    expect(() => bandColorsForCount(0)).toThrow('must be 1–5');
  });
  it('bandColorsForCount throws for count 6', () => {
    expect(() => bandColorsForCount(6)).toThrow('must be 1–5');
  });
  it('buildRiskLevels throws for bandCount 0', () => {
    expect(() => buildRiskLevels(0, [])).toThrow('must be 1–5');
  });
  it('buildRiskLevels throws for bandCount 6', () => {
    expect(() => buildRiskLevels(6, [1, 2, 3, 4, 5])).toThrow('must be 1–5');
  });
  it('buildRiskLevels throws for wrong crossoverPoints length', () => {
    expect(() => buildRiskLevels(3, [3600])).toThrow('crossoverPoints');
  });
});
