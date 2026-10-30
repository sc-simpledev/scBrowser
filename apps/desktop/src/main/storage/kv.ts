import type { DatabaseSync, StatementSync } from 'node:sqlite'

/** JSON values by key, for small state like settings and the saved session. */
export class KeyValueRepo {
  private readonly getQuery: StatementSync
  private readonly setQuery: StatementSync
  private readonly deleteQuery: StatementSync

  constructor(db: DatabaseSync) {
    this.getQuery = db.prepare(`SELECT value FROM kv WHERE key = ?`)
    this.setQuery = db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    this.deleteQuery = db.prepare(`DELETE FROM kv WHERE key = ?`)
  }

  delete(key: string): void {
    this.deleteQuery.run(key)
  }

  get(key: string): unknown {
    const row = this.getQuery.get(key) as { value: string } | undefined
    if (!row) return undefined
    try {
      return JSON.parse(row.value) as unknown
    } catch {
      return undefined
    }
  }

  set(key: string, value: unknown): void {
    this.setQuery.run(key, JSON.stringify(value))
  }
}
