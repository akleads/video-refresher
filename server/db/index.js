import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createTables } from './schema.js';

export function initDatabase(dbPath) {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);

  // Critical pragmas -- set before any queries
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');  // Safe with WAL mode

  // Run schema migrations
  createTables(db);

  return db;
}
