/** Full precision: "Xd Yh Zm", "Xh Ym", "Ym Zs", or "Zs". */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return '0s';
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) {
    return `${d}d ${h}h`;
  }
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

/**
 * Compact for calendar cells / picker triggers:
 * "Xd Yh", "Xh Ym", "Ym", or "0m".
 */
export function shortDuration(seconds: number): string {
  if (seconds <= 0) {
    return '0m';
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) {
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}
