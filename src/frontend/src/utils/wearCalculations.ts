export function maxWearSeconds(
  category: { initial_wear_duration_seconds: number },
  item: { difficulty_multiplier: number },
): number {
  return category.initial_wear_duration_seconds * item.difficulty_multiplier;
}
