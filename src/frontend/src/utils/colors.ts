export const MAX_LIGHTNESS = 0.55;

export const SWATCHES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  `oklch(${MAX_LIGHTNESS} 0.15 ${i * 30})`
);

export function randomSwatchColor(): string {
  return SWATCHES[Math.floor(Math.random() * SWATCHES.length)];
}

export function buildOklch(chroma: number, hue: number): string {
  const c = Math.round(chroma * 100) / 100;
  const h = Math.round(hue);
  return `oklch(${MAX_LIGHTNESS} ${c} ${h})`;
}
