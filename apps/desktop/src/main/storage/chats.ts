import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { ChatSummary, SavedChat, SavedTurn } from '@scbrowser/shared'

const TITLE_LENGTH = 80

interface Row {
  id: string
  title: string
  updated_at: number
}

/** Assistant chats. Only what was shown in the conversation is kept, never the page text sent with it. */
export class ChatsRepo {
  private readonly upsert: StatementSync
  private readonly listQuery: StatementSync
  private readonly getQuery: StatementSync
  private readonly deleteOne: StatementSync
  private readonly deleteAll: StatementSync

  constructor(db: DatabaseSync) {
    this.upsert = db.prepare(`INSERT OR REPLACE INTO chats (id, title, turns, updated_at) VALUES (?, ?, ?, ?)`)
    this.listQuery = db.prepare(`SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC LIMIT 200`)
    this.getQuery = db.prepare(`SELECT id, title, turns, updated_at FROM chats WHERE id = ?`)
    this.deleteOne = db.prepare(`DELETE FROM chats WHERE id = ?`)
    this.deleteAll = db.prepare(`DELETE FROM chats`)
  }

  save(id: string, turns: SavedTurn[], now = Date.now()): void {
    const first = turns.find((t) => t.role === 'user')?.content.replace(/\s+/g, ' ').trim() ?? 'Chat'
    this.upsert.run(id, first.slice(0, TITLE_LENGTH), JSON.stringify(turns), now)
  }

  list(): ChatSummary[] {
    return (this.listQuery.all() as unknown as Row[]).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }))
  }

  get(id: string): SavedChat | null {
    const row = this.getQuery.get(id) as (Row & { turns: string }) | undefined
    if (!row) return null
    return { id: row.id, title: row.title, updatedAt: row.updated_at, turns: JSON.parse(row.turns) as SavedTurn[] }
  }

  delete(id: string): void {
    this.deleteOne.run(id)
  }

  clear(): void {
    this.deleteAll.run()
  }
}
