import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { CODE_CHAT_PREFIX, shownMessage, type ChatSummary, type SavedChat, type SavedTurn } from '@scbrowser/shared'

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
    // A preset or change request is titled by what the person asked, not its instructions.
    const asked = turns.find((t) => t.role === 'user')?.content
    const first = asked ? shownMessage(asked).replace(/\s+/g, ' ').trim() : 'Chat'
    this.upsert.run(id, first.slice(0, TITLE_LENGTH), JSON.stringify(turns), now)
  }

  /** A Terra Code chat: what its screen showed, and the folder it was working in. */
  saveCode(id: string, title: string, folder: string, data: string, now = Date.now()): void {
    if (!id.startsWith(CODE_CHAT_PREFIX)) throw new Error('Invalid chat')
    this.upsert.run(id, title.replace(/\s+/g, ' ').trim().slice(0, TITLE_LENGTH) || 'Code', JSON.stringify({ folder, data }), now)
  }

  getCode(id: string): { folder: string; data: string } | null {
    if (!id.startsWith(CODE_CHAT_PREFIX)) return null
    const row = this.getQuery.get(id) as (Row & { turns: string }) | undefined
    return row ? (JSON.parse(row.turns) as { folder: string; data: string }) : null
  }

  list(): ChatSummary[] {
    return (this.listQuery.all() as unknown as Row[]).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }))
  }

  get(id: string): SavedChat | null {
    if (id.startsWith(CODE_CHAT_PREFIX)) return null
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
