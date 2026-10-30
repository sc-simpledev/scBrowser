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
   CREATE INDEX history_last_visit ON history (last_visit DESC);`
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
