import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { HistoryEntry } from '@scbrowser/shared'

const DAY_MS = 86_400_000

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

/** Only real web pages are worth remembering. */
export const isRecordable = (url: string) => /^https?:\/\//i.test(url)

interface Row {
  url: string
  title: string
  visit_count: number
  last_visit: number
}

const toEntry = (row: Row): HistoryEntry => ({
  url: row.url,
  title: row.title,
  visitCount: row.visit_count,
  lastVisit: row.last_visit
})

export class HistoryRepo {
  private readonly upsertVisit: StatementSync
  private readonly setTitle: StatementSync
  private readonly searchQuery: StatementSync

  constructor(db: DatabaseSync) {
    this.upsertVisit = db.prepare(
      `INSERT INTO history (url, title, visit_count, last_visit) VALUES (?, ?, 1, ?)
       ON CONFLICT (url) DO UPDATE SET
         visit_count = visit_count + 1,
         last_visit = excluded.last_visit,
         title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END`
    )
    this.setTitle = db.prepare(`UPDATE history SET title = ? WHERE url = ?`)
    // Rank by frecency (visits decayed by age in days), boosting entries whose
    // address — ignoring scheme and "www." — starts with what was typed.
    this.searchQuery = db.prepare(
      `WITH candidates AS (
         SELECT *, CASE WHEN substr(bare, 1, 4) = 'www.' THEN substr(bare, 5) ELSE bare END AS address
         FROM (SELECT *, substr(url, instr(url, '://') + 3) AS bare FROM history)
         WHERE url LIKE :pattern ESCAPE '\\' OR title LIKE :pattern ESCAPE '\\'
       )
       SELECT url, title, visit_count, last_visit FROM candidates
       ORDER BY (address LIKE :prefix ESCAPE '\\') DESC,
                visit_count / (1.0 + (:now - last_visit) / ${DAY_MS}.0) DESC
       LIMIT :limit`
    )
  }

  recordVisit(url: string, title = '', now = Date.now()): void {
    if (isRecordable(url)) this.upsertVisit.run(url, title, now)
  }

  updateTitle(url: string, title: string): void {
    if (isRecordable(url) && title) this.setTitle.run(title, url)
  }

  search(query: string, limit = 8, now = Date.now()): HistoryEntry[] {
    const needle = escapeLike(query.trim().toLowerCase())
    if (!needle) return []
    const rows = this.searchQuery.all({
      pattern: `%${needle}%`,
      prefix: `${needle}%`,
      now,
      limit
    }) as unknown as Row[]
    return rows.map(toEntry)
  }
}
