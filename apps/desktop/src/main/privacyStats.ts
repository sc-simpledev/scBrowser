import { localDay, type PrivacyWeek } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'privacy:stats'
const KEEP_DAYS = 14
const MAX_HOSTS_PER_DAY = 40
const FLUSH_MS = 30_000
const DAY_MS = 86_400_000

interface Day {
  blocked: number
  banners: number
  hosts: Record<string, number>
}

/**
 * Counts of what was blocked, by day, for the new tab's privacy card. Only counts and the
 * trackers' own hosts are kept, never the pages they were on. Private windows count nothing.
 */
export class PrivacyStats {
  private days: Record<string, Day>
  private dirty = false
  private readonly timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly now: () => number = Date.now,
    timers = true
  ) {
    const saved = kv.get(KEY)
    this.days = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, Day>) : {}
    if (timers) {
      this.timer = setInterval(() => this.flush(), FLUSH_MS)
      this.timer.unref?.()
    }
  }

  private today(): Day {
    return (this.days[localDay(this.now())] ??= { blocked: 0, banners: 0, hosts: {} })
  }

  noteBlocked(url?: string): void {
    const day = this.today()
    day.blocked++
    const host = url && URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '') : ''
    // New hosts stop being added once a day's list is full; the ones already there keep counting.
    if (host && (host in day.hosts || Object.keys(day.hosts).length < MAX_HOSTS_PER_DAY)) day.hosts[host] = (day.hosts[host] ?? 0) + 1
    this.dirty = true
  }

  noteBanner(): void {
    this.today().banners++
    this.dirty = true
  }

  /** The last seven days, today included. */
  week(): PrivacyWeek {
    const now = this.now()
    const days = Array.from({ length: 7 }, (_, index) => localDay(now - (6 - index) * DAY_MS))
    const hosts = new Map<string, number>()
    for (const day of days) for (const [host, count] of Object.entries(this.days[day]?.hosts ?? {})) hosts.set(host, (hosts.get(host) ?? 0) + count)
    return {
      blocked: days.reduce((sum, day) => sum + (this.days[day]?.blocked ?? 0), 0),
      banners: days.reduce((sum, day) => sum + (this.days[day]?.banners ?? 0), 0),
      daily: days.map((day) => ({ day, blocked: this.days[day]?.blocked ?? 0 })),
      topHosts: [...hosts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([host, count]) => ({ host, count }))
    }
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    const keep = new Set(Array.from({ length: KEEP_DAYS }, (_, index) => localDay(this.now() - index * DAY_MS)))
    this.days = Object.fromEntries(Object.entries(this.days).filter(([day]) => keep.has(day)))
    this.kv.set(KEY, this.days)
  }

  destroy(): void {
    clearInterval(this.timer)
    this.flush()
  }
}
