export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Human-readable duration for notification/MQTT copy, e.g. "2 hours",
 * "45 minutes".
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? '' : 's'}`;

  if (s >= 86400) {
    return plural(Math.round(s / 86400), 'day');
  }
  if (s >= 3600) {
    return plural(Math.round(s / 3600), 'hour');
  }
  if (s >= 60) {
    return plural(Math.round(s / 60), 'minute');
  }
  return plural(s, 'second');
}
