import { randomUUID } from 'node:crypto'
import { MAX_READING_ITEMS, type ReadingItem } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'reading:list'

/** Pages saved to read later, newest first. Kept on this computer and never synced. */
export class ReadingList {
  constructor(private readonly kv: KeyValueRepo) {}

  list(): ReadingItem[] {
    const saved = this.kv.get(KEY)
    return Array.isArray(saved) ? (saved as ReadingItem[]) : []
  }

  private save(items: ReadingItem[]): void {
    this.kv.set(KEY, items.slice(0, MAX_READING_ITEMS))
  }

  has(url: string): boolean {
    return this.list().some((item) => item.url === url)
  }

  add(url: string, title: string): ReadingItem {
    if (!/^(https?|file):/i.test(url)) throw new Error('Only web pages can go on the reading list.')
    const all = this.list()
    const existing = all.find((item) => item.url === url)
    if (existing) return existing
    const item: ReadingItem = { id: randomUUID(), url, title: title.slice(0, 300), addedAt: Date.now(), readAt: null, summary: null }
    this.save([item, ...all])
    return item
  }

  get(id: string): ReadingItem | null {
    return this.list().find((item) => item.id === id) ?? null
  }

  patch(id: string, change: Partial<Pick<ReadingItem, 'readAt' | 'summary' | 'title'>>): void {
    this.save(this.list().map((item) => (item.id === id ? { ...item, ...change } : item)))
  }

  remove(id: string): void {
    this.save(this.list().filter((item) => item.id !== id))
  }

  /** Marks it read when it's opened from the list, or when its page is visited. */
  markVisited(url: string): void {
    const item = this.list().find((candidate) => candidate.url === url && candidate.readAt === null)
    if (item) this.patch(item.id, { readAt: Date.now() })
  }
}
