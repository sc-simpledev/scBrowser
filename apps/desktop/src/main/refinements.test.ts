import { describe, expect, it } from 'vitest'
import { addWatchPoint, graceWaitSeconds, highlightsBriefTopic, matchPalette, pickForMinutes, readingMinutes, SKILL_COMMAND, weekRange, widgetShownAt, type ReadingItem } from '@scbrowser/shared'
import { SnoozeService } from './snooze'
import type { KeyValueRepo } from './storage/kv'

const memoryKv = () => {
  const map = new Map<string, unknown>()
  return { get: (key: string) => map.get(key), set: (key: string, value: unknown) => void map.set(key, value) } as unknown as KeyValueRepo
}

describe('refinements', () => {
  it('wakes a tab snoozed until its site as soon as that site is opened', () => {
    const woken: string[] = []
    const snooze = new SnoozeService({ kv: memoryKv(), wake: (tab) => !!woken.push(tab.url), timers: false })
    snooze.add({ url: 'https://news.example/story', title: 'Story' }, Date.now() + 86_400_000, { wakeHost: 'news.example' })
    snooze.visited('https://other.example/')
    expect(woken).toEqual([])
    snooze.visited('https://www.news.example/front')
    expect(woken).toEqual(['https://news.example/story'])
    expect(snooze.list()).toHaveLength(0)
  })

  it('keeps a watched number when it moves, and once a day when it holds still', () => {
    let history = addWatchPoint(undefined, 100, 0)
    history = addWatchPoint(history, 100, 3_600_000)
    expect(history).toHaveLength(1)
    history = addWatchPoint(history, 90, 7_200_000)
    history = addWatchPoint(history, 90, 7_200_000 + 86_400_000)
    expect(history!.map((point) => point.value)).toEqual([100, 90, 90])
    expect(addWatchPoint(history, null, 0)).toBe(history)
  })

  it('picks the longest unread page that fits, or else the shortest', () => {
    const item = (id: string, minutes: number | null, readAt: number | null = null): ReadingItem => ({ id, url: `https://x.test/${id}`, title: id, addedAt: 0, readAt, summary: null, minutes })
    const items = [item('a', 3), item('b', 9), item('c', 25), item('d', 8, 1), item('e', null)]
    expect(pickForMinutes(items, 10)?.id).toBe('b')
    expect(pickForMinutes(items, 2)?.id).toBe('a')
    expect(readingMinutes('word '.repeat(460))).toBe(2)
  })

  it('shows recent commands first, and matching skills before asking the AI', () => {
    const recent = matchPalette('', { recent: ['downloads', 'history'] })
    expect(recent.slice(0, 2).map((command) => command.id)).toEqual(['downloads', 'history'])
    const typed = matchPalette('explain this page simply', { skills: [{ id: 's1', name: 'Explain simply' }] })
    const skill = typed.findIndex((command) => command.id === `${SKILL_COMMAND}s1`)
    const ai = typed.findIndex((command) => command.ai)
    expect(skill).toBeGreaterThanOrEqual(0)
    expect(skill).toBeLessThan(ai)
  })

  it('makes each extra minute on a blocked site wait longer', () => {
    expect([0, 1, 2, 3, 4, 5].map(graceWaitSeconds)).toEqual([5, 10, 20, 40, 60, 60])
  })

  it('shows widgets only at their time of day', () => {
    const at = (hour: number) => new Date(2026, 10, 14, hour)
    expect(widgetShownAt('morning', at(8))).toBe(true)
    expect(widgetShownAt('morning', at(13))).toBe(false)
    expect(widgetShownAt('evening', at(2))).toBe(true)
    expect(widgetShownAt(undefined, at(2))).toBe(true)
  })

  it('briefs on highlights by their words, and recaps seven days', () => {
    const topic = highlightsBriefTopic([{ text: 'Open models with long context', title: 'A' }, { text: 'x'.repeat(200), title: 'B' }])
    expect(topic).toContain('Open models with long context')
    expect(topic.length).toBeLessThanOrEqual(500)
    const { after, before } = weekRange(new Date(2026, 10, 14, 15).getTime())
    expect(new Date(after).getDate()).toBe(8)
    expect(before).toBe(new Date(2026, 10, 14, 15).getTime())
  })
})
