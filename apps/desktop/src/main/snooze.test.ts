import { describe, expect, it } from 'vitest'
import type { SnoozedTab } from '@scbrowser/shared'
import { SnoozeService } from './snooze'
import type { KeyValueRepo } from './storage/kv'

const memoryKv = () => {
  const map = new Map<string, unknown>()
  return { get: (key: string) => map.get(key), set: (key: string, value: unknown) => void map.set(key, value) } as unknown as KeyValueRepo
}

describe('snoozed tabs', () => {
  it('wakes tabs whose time has come, soonest first, and keeps the rest', () => {
    let now = 1_000
    const woken: SnoozedTab[] = []
    const snooze = new SnoozeService({ kv: memoryKv(), wake: (tab) => !!woken.push(tab), now: () => now, timers: false })
    snooze.add({ url: 'https://later.test/', title: 'Later' }, 9_000)
    snooze.add({ url: 'https://soon.test/', title: 'Soon', container: 'work' }, 2_000)
    snooze.tick()
    expect(woken).toEqual([])
    now = 2_500
    snooze.tick()
    expect(woken.map((tab) => tab.url)).toEqual(['https://soon.test/'])
    expect(woken[0]!.container).toBe('work')
    expect(snooze.list().map((tab) => tab.title)).toEqual(['Later'])
  })

  it('waits when there is no window to open in', () => {
    const snooze = new SnoozeService({ kv: memoryKv(), wake: () => false, now: () => 5_000, timers: false })
    snooze.add({ url: 'https://a.test/', title: 'A' }, 1_000)
    snooze.tick()
    expect(snooze.list()).toHaveLength(1)
  })
})
