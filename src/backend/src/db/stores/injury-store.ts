import db from '../index.js';

export interface Injury {
  id: number;
  item_id: number;
  occurred_at: number;
  healed_at: number | null;
  severity: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

class InjuryStore {
  findAll(itemId?: number): Injury[] {
    if (itemId !== undefined) {
      return db
        .prepare('SELECT * FROM injuries WHERE item_id = ? ORDER BY occurred_at DESC')
        .all(itemId) as Injury[];
    }
    return db.prepare('SELECT * FROM injuries ORDER BY occurred_at DESC').all() as Injury[];
  }

  find(id: number): Injury | undefined {
    return db.prepare('SELECT * FROM injuries WHERE id = ?').get(id) as Injury | undefined;
  }

  findActive(itemId: number): Injury | undefined {
    return db
      .prepare('SELECT * FROM injuries WHERE item_id = ? AND healed_at IS NULL ORDER BY occurred_at DESC LIMIT 1')
      .get(itemId) as Injury | undefined;
  }

  hasActive(itemId: number): boolean {
    return this.findActive(itemId) !== undefined;
  }

  hasActiveInCategory(categoryId: number): boolean {
    const row = db
      .prepare(
        `SELECT 1 FROM injuries inj
         JOIN items i ON i.id = inj.item_id
         WHERE i.category_id = ? AND inj.healed_at IS NULL LIMIT 1`,
      )
      .get(categoryId);
    return row !== undefined;
  }

  record(itemId: number, severity: number): Injury {
    return db
      .prepare(
        'INSERT INTO injuries (item_id, occurred_at, healed_at, severity) VALUES (?, ?, NULL, ?) RETURNING *',
      )
      .get(itemId, nowSeconds(), severity) as Injury;
  }

  heal(itemId: number): void {
    db.prepare('UPDATE injuries SET healed_at = ? WHERE item_id = ? AND healed_at IS NULL').run(
      nowSeconds(),
      itemId,
    );
  }

  /** Elapsed (ended_at - started_at) of the most recent ended session for an item. */
  lastSessionWear(itemId: number): number {
    const row = db
      .prepare(
        `SELECT (ended_at - started_at) AS elapsed FROM sessions
         WHERE item_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`,
      )
      .get(itemId) as { elapsed: number } | undefined;
    return row?.elapsed ?? 0;
  }
}

export const injuryStore = new InjuryStore();
