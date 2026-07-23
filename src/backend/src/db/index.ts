import Database from 'better-sqlite3';

const DB_PATH =
  process.env.NODE_ENV === 'test'
    ? ':memory:'
    : (process.env.DB_PATH ?? './weartrack.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const prepare = (sql: string) => db.prepare(sql);
export { db as dbExport };
export default db;
