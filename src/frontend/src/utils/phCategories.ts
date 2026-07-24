export type PhIconEntry = { id: string; tags: string[] };
export type PhCategories = Record<string, PhIconEntry[]>;

const WEIGHT_SUFFIXES = [
  '-bold', '-fill', '-light', '-thin', '-duotone',
] as const

function getOrCreateBucket(r: PhCategories, cat: string): PhIconEntry[] {
  if (!r[cat]) {
    r[cat] = []
  } // nosemgrep: gitlab.eslint.detect-object-injection
  return r[cat] // nosemgrep: gitlab.eslint.detect-object-injection
}

/**
 * Pure transform: takes the raw icons array from @phosphor-icons/core and
 * returns a map of category name → icon entries.
 * Only regular-weight icons are included
 * (no -bold, -fill, -light, -thin, -duotone).
 * An icon that belongs to multiple categories appears in each.
 */
export function buildPhCategories(
  icons: Array<{ name: string; categories: string[]; tags: string[] }>,
): PhCategories {
  const result: PhCategories = {}
  for (const icon of icons) {
    if (WEIGHT_SUFFIXES.some((s) => icon.name.endsWith(s))) {
      continue
    }
    for (const cat of icon.categories) {
      const bucket = getOrCreateBucket(result, cat)
      bucket.push({ id: `ph:${icon.name}`, tags: icon.tags })
    }
  }
  return result
}

/**
 * Filter icons across all categories by query string.
 * Matches against the icon name (without 'ph:' prefix) and tags.
 * Returns a deduplicated flat array (an icon in multiple categories
 * appears once).
 * Returns [] for an empty query.
 */
export function filterIcons(
  categories: PhCategories,
  query: string,
): PhIconEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) {
    return []
  }
  const seen = new Set<string>()
  const results: PhIconEntry[] = []
  for (const entries of Object.values(categories)) {
    for (const entry of entries) {
      if (seen.has(entry.id)) {
        continue
      }
      const name = entry.id.slice(3) // strip 'ph:' prefix (always 3 chars)
      if (name.includes(q) || entry.tags.some((t) => t.includes(q))) {
        results.push(entry)
        seen.add(entry.id)
      }
    }
  }
  return results
}
