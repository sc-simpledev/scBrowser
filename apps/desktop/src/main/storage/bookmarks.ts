import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { BarItem, Bookmark, BookmarkGroup } from '@scbrowser/shared'

interface Row {
  id: number
  url: string
  title: string
  created_at: number
  group_id: number | null
  position: number
}

export class BookmarksRepo {
  private readonly listQuery: StatementSync
  private readonly findQuery: StatementSync
  private readonly insert: StatementSync
  private readonly rename_: StatementSync
  private readonly deleteQuery: StatementSync
  private readonly edit_: StatementSync
  private readonly setGroup_: StatementSync
  private readonly setPosition: StatementSync
  private readonly groupsQuery: StatementSync
  private readonly insertGroup: StatementSync
  private readonly renameGroup_: StatementSync
  private readonly deleteGroup: StatementSync
  private readonly setGroupPosition: StatementSync
  private readonly nextPosition: StatementSync

  constructor(db: DatabaseSync) {
    this.listQuery = db.prepare(`SELECT id, url, title, created_at, group_id, position FROM bookmarks ORDER BY position, id`)
    this.findQuery = db.prepare(`SELECT id FROM bookmarks WHERE url = ?`)
    this.insert = db.prepare(`INSERT INTO bookmarks (url, title, created_at, position) VALUES (?, ?, ?, ?)`)
    this.rename_ = db.prepare(`UPDATE bookmarks SET title = ? WHERE id = ?`)
    this.deleteQuery = db.prepare(`DELETE FROM bookmarks WHERE id = ?`)
    this.edit_ = db.prepare(`UPDATE bookmarks SET title = ?, url = ? WHERE id = ?`)
    this.setGroup_ = db.prepare(`UPDATE bookmarks SET group_id = ?, position = ? WHERE id = ?`)
    this.setPosition = db.prepare(`UPDATE bookmarks SET position = ? WHERE id = ?`)
    this.groupsQuery = db.prepare(`SELECT id, name, position FROM bookmark_groups ORDER BY position, id`)
    this.insertGroup = db.prepare(`INSERT INTO bookmark_groups (name, position) VALUES (?, ?)`)
    this.renameGroup_ = db.prepare(`UPDATE bookmark_groups SET name = ? WHERE id = ?`)
    this.deleteGroup = db.prepare(`DELETE FROM bookmark_groups WHERE id = ?`)
    this.setGroupPosition = db.prepare(`UPDATE bookmark_groups SET position = ? WHERE id = ?`)
    this.nextPosition = db.prepare(
      `SELECT max(coalesce((SELECT max(position) FROM bookmarks), 0), coalesce((SELECT max(position) FROM bookmark_groups), 0)) + 1 AS next`
    )
  }

  list(): Bookmark[] {
    return (this.listQuery.all() as unknown as Row[]).map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      createdAt: row.created_at,
      groupId: row.group_id,
      position: row.position
    }))
  }

  private next(): number {
    return (this.nextPosition.get() as { next: number }).next
  }

  has(url: string): boolean {
    return this.findQuery.get(url) !== undefined
  }

  groups(): BookmarkGroup[] {
    return this.groupsQuery.all() as unknown as BookmarkGroup[]
  }

  addGroup(name: string): number {
    return Number(this.insertGroup.run(name, this.next()).lastInsertRowid)
  }

  renameGroup(id: number, name: string): void {
    this.renameGroup_.run(name, id)
  }

  /** The bookmarks inside go back onto the bar. */
  removeGroup(id: number): void {
    this.deleteGroup.run(id)
  }

  /** Throws if another bookmark already has this address. */
  edit(id: number, title: string, url: string): void {
    this.edit_.run(title, url, id)
  }

  setGroup(id: number, groupId: number | null): void {
    this.setGroup_.run(groupId, this.next(), id)
  }

  /** Saves a new order for the bar, or for the bookmarks in one group. */
  arrange(items: BarItem[]): void {
    items.forEach(({ kind, id }, position) => (kind === 'group' ? this.setGroupPosition : this.setPosition).run(position, id))
  }

  /** Adds the URL, or removes it if it's already bookmarked. */
  toggle(url: string, title: string, now = Date.now()): void {
    const existing = this.findQuery.get(url) as { id: number } | undefined
    if (existing) this.remove(existing.id)
    else this.insert.run(url, title, now, this.next())
  }

  /** Adds bookmarks that aren't already saved and returns how many were new. */
  importMany(items: { url: string; title: string }[], now = Date.now()): number {
    const existing = new Set(this.list().map((b) => b.url))
    let added = 0
    for (const { url, title } of items) {
      if (existing.has(url)) continue
      existing.add(url)
      this.insert.run(url, title, now, this.next())
      added++
    }
    return added
  }

  rename(id: number, title: string): void {
    this.rename_.run(title, id)
  }

  remove(id: number): void {
    this.deleteQuery.run(id)
  }
}
