import { describe, it, expect } from 'vitest';
import { buildPhCategories, filterIcons } from './phCategories.js';
import type { PhCategories } from './phCategories.js';

// Minimal mock that mirrors the shape from @phosphor-icons/core
const mockIcons = [
  { name: 'arrow-up', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-bold', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-fill', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-light', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-thin', categories: ['arrows'], tags: ['up', 'direction'] },
  {
    name: 'arrow-up-duotone',
    categories: ['arrows'],
    tags: ['up', 'direction'],
  },
  {
    name: 'heart',
    categories: ['health & wellness', 'people'],
    tags: ['love', 'care'],
  },
  { name: 'sneaker', categories: ['objects'], tags: ['shoe', 'footwear'] },
];

describe('buildPhCategories', () => {
  it('excludes all weight variants', () => {
    const result = buildPhCategories(mockIcons);
    for (const entries of Object.values(result)) {
      for (const entry of entries) {
        expect(entry.id).not.toMatch(/-(bold|fill|light|thin|duotone)$/);
      }
    }
  });

  it('prefixes icon names with ph:', () => {
    const result = buildPhCategories(mockIcons);
    expect(result['arrows'][0].id).toBe('ph:arrow-up');
  });

  it('includes tags from the source icon', () => {
    const result = buildPhCategories(mockIcons);
    expect(result['arrows'][0].tags).toEqual(['up', 'direction']);
  });

  it('places an icon in all its categories', () => {
    const result = buildPhCategories(mockIcons);
    expect(result['health & wellness'].map((e) => e.id)).toContain('ph:heart');
    expect(result['people'].map((e) => e.id)).toContain('ph:heart');
  });

  it('returns only one arrow entry (bold/fill/etc excluded)', () => {
    const result = buildPhCategories(mockIcons);
    expect(result['arrows']).toHaveLength(1);
  });
});

describe('filterIcons', () => {
  const cats: PhCategories = {
    arrows: [{ id: 'ph:arrow-up', tags: ['direction', 'up'] }],
    'health & wellness': [{ id: 'ph:heart', tags: ['love', 'care'] }],
    people: [{ id: 'ph:heart', tags: ['love', 'care'] }],
    objects: [{ id: 'ph:sneaker', tags: ['shoe', 'footwear'] }],
  };

  it('returns empty array for empty query', () => {
    expect(filterIcons(cats, '')).toEqual([]);
    expect(filterIcons(cats, '   ')).toEqual([]);
  });

  it('matches by icon name (without ph: prefix)', () => {
    const result = filterIcons(cats, 'arrow');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ph:arrow-up');
  });

  it('matches by tag', () => {
    const result = filterIcons(cats, 'shoe');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ph:sneaker');
  });

  it('deduplicates icons that appear in multiple categories', () => {
    const result = filterIcons(cats, 'love');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ph:heart');
  });

  it('returns empty array when nothing matches', () => {
    expect(filterIcons(cats, 'zzzzz')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(filterIcons(cats, 'ARROW')).toHaveLength(1);
  });
});
