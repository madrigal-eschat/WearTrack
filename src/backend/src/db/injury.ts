import { prepare } from './index.js';

export function getActiveInjury(itemId: number) {
  return prepare(
    'SELECT * FROM injuries WHERE item_id = ? AND healed_at IS NULL ORDER BY occurred_at DESC LIMIT 1'
  ).get(itemId);
}

export function hasActiveInjury(itemId: number): boolean {
  return getActiveInjury(itemId) !== undefined;
}

export function recordInjury(itemId: number, severity: number) {
  return prepare(
    'INSERT INTO injuries (item_id, occurred_at, healed_at, severity) VALUES (?, ?, NULL, ?) RETURNING *'
  ).get(itemId, Math.floor(Date.now() / 1000), severity);
}

export function healInjury(itemId: number) {
  return prepare(
    'UPDATE injuries SET healed_at = ? WHERE item_id = ? AND healed_at IS NULL'
  ).run(Math.floor(Date.now() / 1000), itemId);
}
