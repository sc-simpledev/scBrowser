import { randomUUID } from 'node:crypto'
import { net, Notification } from 'electron'
import { withHiddenPage } from './hiddenPage'
import { addWatchPoint, diffWatchText, isSafeSelector, MAX_WATCHES, meetsTarget, normaliseWatchText, watchNumber, type PageWatch, type WatchInterval, type WatchTarget } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'watch:pages'
/** How often it looks for watches that are due. */
const TICK_MS = 60_000
/** A first look a little after starting, so it doesn't compete with restoring tabs. */
const FIRST_TICK_MS = 45_000
const WORLD = 1013

const READ_TEXT = (selector: string | null) => `(() => {
  const root = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.body'}
  return root ? root.innerText : null
})()`

interface WatcherHost {
  onChange: () => void
  /** Opens a watched page in a tab, from its notification. */
  openTab: (url: string) => void
  /** Says what changed in a sentence, or null when there's no model to ask or the site has AI off. */
  summarise?: (watch: PageWatch, added: string[], removed: string[]) => Promise<string | null>
}

/**
 * Checks watched pages in a hidden, muted window, one at a time, and says when their words
 * change. Only pages the person asked to watch are ever loaded, using their own session.
 */
export class PageWatcher {
  private checking = false
  private readonly first: ReturnType<typeof setTimeout>
  private readonly timer: ReturnType<typeof setInterval>

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly host: WatcherHost
  ) {
    this.first = setTimeout(() => void this.tick(), FIRST_TICK_MS)
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.first.unref?.()
    this.timer.unref?.()
  }

  list(): PageWatch[] {
    const saved = this.kv.get(KEY)
    return Array.isArray(saved) ? (saved as PageWatch[]) : []
  }

  private save(watches: PageWatch[]): void {
    this.kv.set(KEY, watches)
    this.host.onChange()
  }

  private patch(id: string, change: Partial<PageWatch>): void {
    this.save(this.list().map((watch) => (watch.id === id ? { ...watch, ...change } : watch)))
  }

  /** Starts watching, and takes the first reading straight away so later checks have something to compare. */
  async add(url: string, title: string, selector: string | null): Promise<PageWatch> {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only websites can be watched.')
    if (selector !== null && !isSafeSelector(selector)) throw new Error("That part of the page can't be watched.")
    const watches = this.list()
    const existing = watches.find((watch) => watch.url === url && watch.selector === selector)
    if (existing) return existing
    if (watches.length >= MAX_WATCHES) throw new Error(`You can watch ${MAX_WATCHES} pages at most.`)
    const watch: PageWatch = { id: randomUUID(), url, title: title.slice(0, 200), selector, everyMinutes: 60, lastText: '', lastCheckedAt: null, changedAt: null, unseen: false, error: null, added: [], removed: [] }
    this.save([...watches, watch])
    await this.check(watch.id)
    return this.list().find((candidate) => candidate.id === watch.id) ?? watch
  }

  remove(id: string): void {
    this.save(this.list().filter((watch) => watch.id !== id))
  }

  setInterval(id: string, everyMinutes: WatchInterval): void {
    this.patch(id, { everyMinutes })
  }

  /** Only announce when the watched number passes a target, or null to announce every change again. */
  setTarget(id: string, target: WatchTarget | null): void {
    const watch = this.list().find((candidate) => candidate.id === id)
    if (!watch) return
    const value = watchNumber(watch.lastText)
    this.patch(id, { target, value, hit: target !== null && value !== null && meetsTarget(value, target) })
  }

  markSeen(id?: string): void {
    this.save(this.list().map((watch) => (id === undefined || watch.id === id ? { ...watch, unseen: false } : watch)))
  }

  unseenCount(): number {
    return this.list().filter((watch) => watch.unseen).length
  }

  private async tick(): Promise<void> {
    if (this.checking || !net.isOnline()) return
    const now = Date.now()
    const due = this.list().filter((watch) => watch.lastCheckedAt === null || now - watch.lastCheckedAt >= watch.everyMinutes * 60_000)
    for (const watch of due) await this.check(watch.id)
  }

  /** Reads the page now. Compares with the last reading, and says so if it's different. */
  async check(id: string): Promise<void> {
    const watch = this.list().find((candidate) => candidate.id === id)
    if (!watch) return
    if (this.checking) {
      // One at a time, so a long list never opens a crowd of hidden pages.
      await new Promise((resolve) => setTimeout(resolve, 500))
      return this.check(id)
    }
    this.checking = true
    try {
      const text = await readPage(watch.url, watch.selector)
      const current = this.list().find((candidate) => candidate.id === id)
      if (!current) return
      if (text === null) return this.patch(id, { lastCheckedAt: Date.now(), error: watch.selector ? "The watched part isn't on the page any more." : 'The page had no text to read.' })
      const value = watchNumber(text)
      const first = current.lastCheckedAt === null || (!current.lastText && current.error !== null)
      const target = current.target ?? null
      const hit = target !== null && value !== null && meetsTarget(value, target)
      const history = addWatchPoint(current.history, value, Date.now())
      if (history !== current.history) this.patch(id, { history })
      if (first || text === current.lastText) return this.patch(id, { lastText: text, lastCheckedAt: Date.now(), error: null, value, hit })
      const { added, removed } = diffWatchText(current.lastText, text)
      // Only reordering, which pages do without anything really changing.
      if (added.length === 0 && removed.length === 0) return this.patch(id, { lastText: text, lastCheckedAt: Date.now(), error: null, value, hit })
      // With a target, a change is only news once the number passes it, and once per crossing.
      const news = target === null || (hit && !current.hit)
      this.patch(id, { lastText: text, lastCheckedAt: Date.now(), changedAt: Date.now(), unseen: news || current.unseen, error: null, added, removed, summary: null, value, hit })
      if (!news) return
      if (target !== null) return this.notify(current, [`Now ${value}, ${target.direction} your ${target.value}.`])
      const summary = await this.host.summarise?.(current, added, removed).catch(() => null)
      if (summary) this.patch(id, { summary: summary.slice(0, 600) })
      this.notify(current, summary ? [summary] : added)
    } catch (error) {
      this.patch(id, { lastCheckedAt: Date.now(), error: error instanceof Error ? error.message : "Couldn't load the page." })
    } finally {
      this.checking = false
    }
  }

  private notify(watch: PageWatch, added: string[]): void {
    if (!Notification.isSupported()) return
    const note = new Notification({ title: `${watch.title || new URL(watch.url).host} changed`, body: added[0]?.slice(0, 140) ?? 'Some of its text was removed.', silent: false })
    note.on('click', () => {
      this.markSeen(watch.id)
      this.host.openTab(watch.url)
    })
    note.show()
  }

  destroy(): void {
    clearTimeout(this.first)
    clearInterval(this.timer)
  }
}

/** Loads a page out of sight and returns its text, or null if the part to watch isn't there. */
function readPage(url: string, selector: string | null): Promise<string | null> {
  return withHiddenPage(url, async (contents) => {
    const text = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: READ_TEXT(selector) }])) as unknown
    return typeof text === 'string' ? normaliseWatchText(text) || null : null
  })
}
