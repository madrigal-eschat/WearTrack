export function clampNumber(
  raw: string,
  opts: { min?: number; max?: number; default: number }
): number {
  const val = Number(raw)
  if (raw.trim() === '' || isNaN(val)) {
    return opts.default
  }
  let result = val
  if (opts.min !== undefined) {
    result = Math.max(opts.min, result)
  }
  if (opts.max !== undefined) {
    result = Math.min(opts.max, result)
  }
  return result
}
