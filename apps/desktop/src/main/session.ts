import type { KeyValueRepo } from './storage/kv'
import type { SavedTab, TabManager } from './tabs/TabManager'

const KEY = 'session'
const SAVE_DELAY_MS = 1000

interface SavedSession {
  tabs: SavedTab[]
  activeIndex: number
  /** The two tabs in split view, as positions in `tabs`. */
  split?: [number, number] | null
}

const isSavedTab = (value: unknown): value is SavedTab => {
  const tab = value as SavedTab | null
  return (
    typeof tab === 'object' &&
    tab !== null &&
    typeof tab.url === 'string' &&
    typeof tab.title === 'string' &&
    Array.isArray(tab.entries) &&
    Number.isInteger(tab.entryIndex)
  )
}

export function loadSession(kv: KeyValueRepo): SavedSession | null {
  const saved = kv.get(KEY) as SavedSession | undefined
  if (!saved || !Array.isArray(saved.tabs)) return null
  const tabs = saved.tabs.filter(isSavedTab)
  const split = Array.isArray(saved.split) && saved.split.length === 2 && saved.tabs.length === tabs.length && saved.split.every((index) => Number.isInteger(index) && tabs[index]) ? saved.split : null
  return tabs.length > 0 ? { tabs, activeIndex: Number(saved.activeIndex) || 0, split } : null
}

/**
 * Saves open tabs shortly after every change, so a crash or power cut loses at most a
 * second of tab changes rather than the session.
 */
export class SessionSaver {
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly tabs: TabManager
  ) {}

  schedule(): void {
    if (this.timer || this.stopped) return
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS)
  }

  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.kv.set(KEY, this.tabs.session())
  }

  /** Stops saving for good; the database may close after this. */
  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
