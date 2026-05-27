export interface RiskLevel {
  lower: number | null;
  upper: number | null;
  text: string;
  severity: number;
}

const BAND_NAMES: string[][] = [
  ['Medium'],
  ['Low', 'High'],
  ['Low', 'Medium', 'High'],
  ['Lower', 'Low', 'High', 'Higher'],
  ['Lowest', 'Low', 'Medium', 'High', 'Highest'],
];

/** The Tailwind bg class for each band position, keyed by band count (index = count - 1). */
export const BAND_COLORS: string[][] = [
  ['bg-yellow-200'],
  ['bg-green-200', 'bg-red-200'],
  ['bg-green-200', 'bg-yellow-200', 'bg-red-200'],
  ['bg-green-200', 'bg-lime-200', 'bg-orange-200', 'bg-red-200'],
  ['bg-green-200', 'bg-lime-200', 'bg-yellow-200', 'bg-orange-200', 'bg-red-200'],
];

/** Returns the fixed ordered name array for a given band count (1–5). */
export function bandNamesForCount(count: number): string[] {
  if (count < 1 || count > 5) throw new Error(`bandNamesForCount: count must be 1–5, got ${count}`);
  return BAND_NAMES[count - 1];
}

/** Returns the Tailwind bg class array for a given band count (1–5). */
export function bandColorsForCount(count: number): string[] {
  if (count < 1 || count > 5) throw new Error(`bandColorsForCount: count must be 1–5, got ${count}`);
  return BAND_COLORS[count - 1];
}

/** Converts bandCount + crossoverPoints into the risk_levels API array. */
export function buildRiskLevels(bandCount: number, crossoverPoints: number[]): RiskLevel[] {
  if (bandCount < 1 || bandCount > 5) throw new Error(`buildRiskLevels: bandCount must be 1–5, got ${bandCount}`);
  if (crossoverPoints.length !== bandCount - 1) {
    throw new Error(`buildRiskLevels: expected ${bandCount - 1} crossoverPoints, got ${crossoverPoints.length}`);
  }
  return Array.from({ length: bandCount }, (_, i) => ({
    lower: i === 0 ? null : crossoverPoints[i - 1],
    upper: i === bandCount - 1 ? null : crossoverPoints[i],
    text: BAND_NAMES[bandCount - 1][i],
    severity: i + 1,
  }));
}
