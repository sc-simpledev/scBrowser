import { randomUUID } from 'node:crypto'
import { MAX_ARCHIVED, type ArchivedTab } from '@scbrowser/shared'
import type { SavedTab } from './tabs/TabManager'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'tabs:archive'

/** Tabs closed after going unused, newest first. Kept on this computer and never synced. */
export class TabArchive {
  constructor(
    private readonly kv: KeyValueRepo,
    private readonly onChange: () => void
  ) {}

  list(): ArchivedTab[] {
    const saved = this.kv.get(KEY)
    return Array.isArray(saved) ? (saved as ArchivedTab[]) : []
  }

  add(tabs: (SavedTab & { lastActiveAt: number })[], byHand = false, now = Date.now()): void {
    if (tabs.length === 0) return
    const fresh = tabs.map(({ url, title, container, lastActiveAt }) => ({ id: randomUUID(), url, title, container: container ?? null, archivedAt: now, lastActiveAt, byHand }))
    // The same page archived again replaces its older entry.
    const urls = new Set(fresh.map((tab) => tab.url))
    this.kv.set(KEY, [...fresh, ...this.list().filter((tab) => !urls.has(tab.url))].slice(0, MAX_ARCHIVED))
    this.onChange()
  }

  /** Takes an entry out, to reopen it. */
  take(id: string): ArchivedTab | null {
    const all = this.list()
    const found = all.find((tab) => tab.id === id) ?? null
    if (found) {
      this.kv.set(KEY, all.filter((tab) => tab !== found))
      this.onChange()
    }
    return found
  }

  clear(): void {
    this.kv.set(KEY, [])
    this.onChange()
  }
}
