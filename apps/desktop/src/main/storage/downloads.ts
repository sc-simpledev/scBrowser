import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { DownloadInfo, DownloadState } from '@scbrowser/shared'

interface Row {
  id: string
  url: string
  filename: string
  path: string
  received_bytes: number
  total_bytes: number
  state: DownloadState
  started_at: number
}

export class DownloadsRepo {
  private readonly upsert: StatementSync
  private readonly listQuery: StatementSync
  private readonly deleteOne: StatementSync
  private readonly deleteFinished: StatementSync
  private readonly markInterrupted: StatementSync

  constructor(db: DatabaseSync) {
    this.upsert = db.prepare(`INSERT OR REPLACE INTO downloads
      (id, url, filename, path, received_bytes, total_bytes, state, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    this.listQuery = db.prepare(`SELECT * FROM downloads ORDER BY started_at DESC LIMIT 500`)
    this.deleteOne = db.prepare(`DELETE FROM downloads WHERE id = ?`)
    this.deleteFinished = db.prepare(`DELETE FROM downloads WHERE state NOT IN ('progressing', 'paused')`)
    this.markInterrupted = db.prepare(`UPDATE downloads SET state = 'interrupted' WHERE state IN ('progressing', 'paused')`)
    // Anything still "running" in the database didn't survive the last shutdown.
    this.markInterrupted.run()
  }

  save(d: DownloadInfo): void {
    this.upsert.run(d.id, d.url, d.filename, d.path, d.receivedBytes, d.totalBytes, d.state, d.startedAt)
  }

  list(): DownloadInfo[] {
    return (this.listQuery.all() as unknown as Row[]).map((row) => ({
      id: row.id,
      url: row.url,
      filename: row.filename,
      path: row.path,
      receivedBytes: row.received_bytes,
      totalBytes: row.total_bytes,
      state: row.state,
      startedAt: row.started_at
    }))
  }

  remove(id: string): void {
    this.deleteOne.run(id)
  }

  clearFinished(): void {
    this.deleteFinished.run()
  }
}
