import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { Bookmark } from '@scbrowser/shared'

interface Row {
  id: number
  url: string
  title: string
  created_at: number
}

export class BookmarksRepo {
  private readonly listQuery: StatementSync
  private readonly findQuery: StatementSync
  private readonly insert: StatementSync
  private readonly rename_: StatementSync
  private readonly deleteQuery: StatementSync

  constructor(db: DatabaseSync) {
    this.listQuery = db.prepare(`SELECT id, url, title, created_at FROM bookmarks ORDER BY id`)
    this.findQuery = db.prepare(`SELECT id FROM bookmarks WHERE url = ?`)
    this.insert = db.prepare(`INSERT INTO bookmarks (url, title, created_at) VALUES (?, ?, ?)`)
    this.rename_ = db.prepare(`UPDATE bookmarks SET title = ? WHERE id = ?`)
    this.deleteQuery = db.prepare(`DELETE FROM bookmarks WHERE id = ?`)
  }

  list(): Bookmark[] {
    return (this.listQuery.all() as unknown as Row[]).map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      createdAt: row.created_at
    }))
  }

  /** Adds the URL, or removes it if it's already bookmarked. */
  toggle(url: string, title: string, now = Date.now()): void {
    const existing = this.findQuery.get(url) as { id: number } | undefined
    if (existing) this.remove(existing.id)
    else this.insert.run(url, title, now)
  }

  rename(id: number, title: string): void {
    this.rename_.run(title, id)
  }

  remove(id: number): void {
    this.deleteQuery.run(id)
  }
}
