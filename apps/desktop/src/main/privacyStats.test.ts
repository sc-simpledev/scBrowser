import { describe, expect, it } from 'vitest'
import { PrivacyStats } from './privacyStats'
import type { KeyValueRepo } from './storage/kv'

const memoryKv = () => {
  const map = new Map<string, unknown>()
  return { get: (key: string) => map.get(key), set: (key: string, value: unknown) => void map.set(key, structuredClone(value)) } as unknown as KeyValueRepo
}
const DAY = 86_400_000

describe('privacy stats', () => {
  it('adds up the last seven days and names the busiest trackers', () => {
    let now = new Date(2026, 10, 1, 12).getTime()
    const kv = memoryKv()
    const stats = new PrivacyStats(kv, () => now, false)
    stats.noteBlocked('https://old.test/x')
    now += 8 * DAY
    stats.noteBlocked('https://www.tracker.test/a.js')
    stats.noteBlocked('https://tracker.test/b.js')
    stats.noteBlocked('https://ads.test/c.js')
    stats.noteBanner()
    now += DAY
    stats.noteBlocked()
    const week = stats.week()
    expect(week.blocked).toBe(4)
    expect(week.banners).toBe(1)
    expect(week.daily).toHaveLength(7)
    expect(week.daily.at(-1)!.blocked).toBe(1)
    expect(week.topHosts).toEqual([{ host: 'tracker.test', count: 2 }, { host: 'ads.test', count: 1 }])
    stats.flush()
    expect(new PrivacyStats(kv, () => now, false).week().blocked).toBe(4)
  })

  it('forgets days older than a fortnight', () => {
    let now = new Date(2026, 10, 1, 12).getTime()
    const kv = memoryKv()
    const stats = new PrivacyStats(kv, () => now, false)
    stats.noteBlocked('https://old.test/x')
    now += 20 * DAY
    stats.noteBlocked('https://new.test/x')
    stats.flush()
    expect(Object.keys(kv.get('privacy:stats') as object)).toHaveLength(1)
  })
})
