import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { FINISHED_READING, isHalfRead, MAX_READING_ITEMS, type ReadingItem } from '@scbrowser/shared'
import { samePage } from './citations'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'reading:list'
const PROGRESS_WORLD = 1022
/** How far down the page is scrolled, from 0 at the top to 1 at the end; null for a page too short to scroll. */
const SCROLLED = `(() => {
  const page = document.scrollingElement || document.documentElement
  const room = page.scrollHeight - innerHeight
  return room > innerHeight / 2 ? Math.min(1, scrollY / room) : null
})()`
const scrollTo = (fraction: number) => `(() => {
  const page = document.scrollingElement || document.documentElement
  if (scrollY < 40) scrollTo({ top: ${fraction} * (page.scrollHeight - innerHeight), behavior: 'instant' })
})()`

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

  patch(id: string, change: Partial<Pick<ReadingItem, 'readAt' | 'summary' | 'title' | 'minutes' | 'progress'>>): void {
    this.save(this.list().map((item) => (item.id === id ? { ...item, ...change } : item)))
  }

  remove(id: string): void {
    this.save(this.list().filter((item) => item.id !== id))
  }

  /**
   * Notes how far down each open page on the list has been read: the furthest point, so scrolling
   * back up to check something doesn't lose the place. Read in an isolated world; pages never see it.
   */
  async noteProgress(open: WebContents[]): Promise<void> {
    const items = this.list()
    if (items.length === 0) return
    for (const contents of open) {
      if (contents.isDestroyed()) continue
      const item = items.find((candidate) => samePage(contents.getURL(), candidate.url))
      if (!item || (item.progress ?? 0) >= FINISHED_READING) continue
      const fraction = (await contents.executeJavaScriptInIsolatedWorld(PROGRESS_WORLD, [{ code: SCROLLED }]).catch(() => null)) as number | null
      if (typeof fraction !== 'number' || !Number.isFinite(fraction)) continue
      const rounded = Math.round(Math.min(1, Math.max(0, fraction)) * 100) / 100
      if (rounded > (item.progress ?? 0)) this.patch(item.id, { progress: rounded })
    }
  }

  /** Takes a page opened from the list back to where it was left, once it has loaded. */
  resume(contents: WebContents, item: ReadingItem): void {
    if (!isHalfRead(item)) return
    contents.once('did-finish-load', () => {
      // A moment for the page to lay itself out, or its height is still the loading screen's.
      setTimeout(() => {
        if (!contents.isDestroyed()) void contents.executeJavaScriptInIsolatedWorld(PROGRESS_WORLD, [{ code: scrollTo(item.progress!) }]).catch(() => undefined)
      }, 400)
    })
  }

  /** Marks it read when it's opened from the list, or when its page is visited. */
  markVisited(url: string): void {
    const item = this.list().find((candidate) => candidate.url === url && candidate.readAt === null)
    if (item) this.patch(item.id, { readAt: Date.now() })
  }
}
