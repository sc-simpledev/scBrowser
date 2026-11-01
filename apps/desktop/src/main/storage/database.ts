import { DatabaseSync } from 'node:sqlite'

/**
 * Ordered schema migrations. Never edit a shipped entry — append a new one. The index
 * (+1) is stored in `PRAGMA user_version`.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE history (
     url TEXT PRIMARY KEY,
     title TEXT NOT NULL DEFAULT '',
     visit_count INTEGER NOT NULL DEFAULT 0,
     last_visit INTEGER NOT NULL
   );
   CREATE INDEX history_last_visit ON history (last_visit DESC);`,
  `CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE bookmarks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     url TEXT NOT NULL UNIQUE,
     title TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE downloads (
     id TEXT PRIMARY KEY,
     url TEXT NOT NULL,
     filename TEXT NOT NULL,
     path TEXT NOT NULL,
     received_bytes INTEGER NOT NULL,
     total_bytes INTEGER NOT NULL,
     state TEXT NOT NULL,
     started_at INTEGER NOT NULL
   );
   CREATE TABLE permissions (
     origin TEXT NOT NULL,
     permission TEXT NOT NULL,
     allowed INTEGER NOT NULL,
     PRIMARY KEY (origin, permission)
   );`,
  `CREATE TABLE chats (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     turns TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX chats_updated_at ON chats (updated_at DESC);`,
  `CREATE TABLE bookmark_groups (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     position INTEGER NOT NULL
   );
   ALTER TABLE bookmarks ADD COLUMN group_id INTEGER REFERENCES bookmark_groups (id) ON DELETE SET NULL;
   ALTER TABLE bookmarks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
   UPDATE bookmarks SET position = id;`,
  `CREATE TABLE site_icons (host TEXT PRIMARY KEY, icon TEXT NOT NULL);`
]

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i]!)
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
