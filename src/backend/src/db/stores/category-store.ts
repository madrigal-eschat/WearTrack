// src/backend/src/db/stores/category-store.ts
import db from '../index.js';
import type { RiskLevel } from '../calculations.js';

interface CategoryRow {
  id: number;
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  risk_levels: string;
  break_decay_multiplier: number;
  break_grace_time: number;
  type: 'duration' | 'rotation';
  consecutive_wear_days: number;
}

export interface Category extends Omit<CategoryRow, 'risk_levels'> {
  risk_levels: RiskLevel[];
}

export interface CategoryCreate {
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  risk_levels: RiskLevel[];
  break_decay_multiplier: number;
  break_grace_time: number;
  type?: 'duration' | 'rotation';
  consecutive_wear_days?: number;
}

export type CategoryUpdate = Partial<CategoryCreate>;

function deserialize(row: CategoryRow): Category {
  return { ...row, risk_levels: JSON.parse(row.risk_levels) as RiskLevel[] };
}

class CategoryStore {
  findAll(): Category[] {
    return (
      db.prepare('SELECT * FROM categories ORDER BY id').all() as CategoryRow[]
    ).map(deserialize);
  }

  find(id: number): Category | undefined {
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
      CategoryRow | undefined;
    return row ? deserialize(row) : undefined;
  }

  /** Raw DB row (risk_levels as JSON string) — used by calculation callers. */
  findRaw(id: number): CategoryRow | undefined {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
      CategoryRow | undefined;
  }

  create(data: CategoryCreate): Category {
    const result = db
      .prepare(
        `INSERT INTO categories
           (name, icon, initial_target_wear_duration_seconds,
            initial_max_wear_duration_seconds, rest_multiplier,
            minimum_rest, risk_levels, break_decay_multiplier,
            break_grace_time, type, consecutive_wear_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.icon,
        data.initial_target_wear_duration_seconds,
        data.initial_max_wear_duration_seconds,
        data.rest_multiplier,
        data.minimum_rest,
        JSON.stringify(data.risk_levels),
        data.break_decay_multiplier,
        data.break_grace_time,
        data.type ?? 'duration',
        data.consecutive_wear_days ?? 1,
      );
    const category = this.find(result.lastInsertRowid as number)!;
    db.prepare(
      'INSERT OR IGNORE INTO category_stats (category_id) VALUES (?)',
    ).run(category.id);
    return category;
  }

  update(id: number, data: CategoryUpdate): Category {
    const ALLOWED_COLUMNS = new Set([
      'name',
      'icon',
      'initial_target_wear_duration_seconds',
      'initial_max_wear_duration_seconds',
      'rest_multiplier',
      'minimum_rest',
      'break_decay_multiplier',
      'break_grace_time',
      'risk_levels',
      'type',
      'consecutive_wear_days',
    ]);

    const dbData: Record<string, unknown> = { ...data };
    if (data.risk_levels !== undefined) {
      dbData.risk_levels = JSON.stringify(data.risk_levels);
    }
    const entries = Object.entries(dbData).filter(([k]) =>
      ALLOWED_COLUMNS.has(k),
    );
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE categories SET ${setClauses} WHERE id = ?`).run(
      ...entries.map(([, v]) => v),
      id,
    );
    return this.find(id)!;
  }

  delete(id: number): void {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }
}

export const categoryStore = new CategoryStore();
