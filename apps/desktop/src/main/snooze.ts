import { randomUUID } from 'node:crypto'
import { MAX_SNOOZED, snoozeHost, type SnoozedTab } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'tabs:snoozed'
const TICK_MS = 30_000
/** Soon after starting, so tabs whose time passed while scTerra was closed come straight back. */
const FIRST_TICK_MS = 4_000

export interface SnoozeDeps {
  kv: KeyValueRepo
  /** Opens the tab again. False if there's no window to open it in yet, and it waits. */
  wake: (tab: SnoozedTab) => boolean
  now?: () => number
  /** Off in tests, which call `tick` themselves. */
  timers?: boolean
}

/** Tabs put away until later. Kept on this computer and never synced. */
export class SnoozeService {
  private readonly timers: ReturnType<typeof setTimeout>[] = []

  constructor(private readonly deps: SnoozeDeps) {
    if (deps.timers === false) return
    const first = setTimeout(() => this.tick(), FIRST_TICK_MS)
    const every = setInterval(() => this.tick(), TICK_MS)
    first.unref?.()
    every.unref?.()
    this.timers.push(first, every)
  }

  /** Soonest first. */
  list(): SnoozedTab[] {
    const saved = this.deps.kv.get(KEY)
    return Array.isArray(saved) ? (saved as SnoozedTab[]).toSorted((a, b) => a.wakeAt - b.wakeAt) : []
  }

  add(tab: { url: string; title: string; container?: string | null }, wakeAt: number, options: { wakeHost?: string | null; group?: string | null } = {}): SnoozedTab {
    const all = this.list()
    if (all.length >= MAX_SNOOZED) throw new Error(`You can snooze ${MAX_SNOOZED} tabs at most.`)
    const snoozed: SnoozedTab = { id: randomUUID(), url: tab.url, title: tab.title.slice(0, 300), container: tab.container ?? null, snoozedAt: this.deps.now?.() ?? Date.now(), wakeAt, wakeHost: options.wakeHost ?? null, group: options.group ?? null }
    this.deps.kv.set(KEY, [...all, snoozed])
    return snoozed
  }

  /** Takes one off the list, to open it now or forget it. */
  take(id: string): SnoozedTab | null {
    const all = this.list()
    const found = all.find((tab) => tab.id === id) ?? null
    if (found) this.deps.kv.set(KEY, all.filter((tab) => tab !== found))
    return found
  }

  /** A page on this site was opened: the tabs waiting for it come back. */
  visited(url: string): void {
    const host = snoozeHost(url)
    if (!host) return
    for (const tab of this.list()) {
      if (tab.wakeHost !== host) continue
      if (!this.deps.wake(tab)) return
      this.take(tab.id)
    }
  }

  /** Opens every tab whose time has come. */
  tick(): void {
    const now = this.deps.now?.() ?? Date.now()
    for (const tab of this.list()) {
      if (tab.wakeAt > now) break
      if (!this.deps.wake(tab)) return
      this.take(tab.id)
    }
  }

  destroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer))
  }
}
