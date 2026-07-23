import db from '../index.js';

export interface Item {
  id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
}

export interface ItemCreate {
  name: string;
  category_id: number;
  color: string;
  difficulty_multiplier?: number;
}

export type ItemUpdate = Partial<
  Omit<ItemCreate, 'difficulty_multiplier'> & { difficulty_multiplier: number }
>;

class ItemStore {
  findAll(categoryId?: number): Item[] {
    if (categoryId !== undefined) {
      return db
        .prepare('SELECT * FROM items WHERE category_id = ? ORDER BY id')
        .all(categoryId) as Item[];
    }
    return db.prepare('SELECT * FROM items ORDER BY id').all() as Item[];
  }

  find(id: number): Item | undefined {
    return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as
      Item | undefined;
  }

  create(data: ItemCreate): Item {
    const difficulty = data.difficulty_multiplier ?? 1.0;
    const result = db
      .prepare(
        'INSERT INTO items (name, category_id, color, ' +
          'difficulty_multiplier) VALUES (?, ?, ?, ?)',
      )
      .run(data.name, data.category_id, data.color, difficulty);

    const item = this.find(result.lastInsertRowid as number)!;

    // Initialise the cumulative stats row for this item
    db.prepare('INSERT OR IGNORE INTO stats (item_id) VALUES (?)').run(item.id);

    return item;
  }

  update(id: number, data: ItemUpdate): Item {
    const keys = Object.keys(data);
    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE items SET ${setClauses} WHERE id = ?`).run(
      ...Object.values(data),
      id,
    );
    return this.find(id)!;
  }

  delete(id: number): void {
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
  }
}

export const itemStore = new ItemStore();
