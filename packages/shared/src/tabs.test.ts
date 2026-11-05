import { describe, expect, it } from 'vitest'
import { clampSplitRatio, matchTabs, SPLIT_GAP, splitLeftWidth, STALE_TAB_DAYS, suggestCleanup, type TabSearchRow } from './tabs'

const DAY = 86_400_000
const NOW = 100 * DAY
const tab = (id: number, url: string, daysAgo = 0) => ({ id, url, title: `Tab ${id}`, lastActiveAt: NOW - daysAgo * DAY })

describe('suggestCleanup', () => {
  it('offers the older copy of a page open twice', () => {
    const rows = suggestCleanup([tab(1, 'https://a.example/', 2), tab(2, 'https://a.example/', 1), tab(3, 'https://b.example/')], 3, NOW)
    expect(rows).toEqual([{ id: 1, title: 'Tab 1', url: 'https://a.example/', reason: 'Open twice' }])
  })

  it('keeps the open tab even when it is the older copy', () => {
    const rows = suggestCleanup([tab(1, 'https://a.example/', 5), tab(2, 'https://a.example/', 1)], 1, NOW)
    expect(rows.map((row) => row.id)).toEqual([2])
  })

  it('offers tabs left alone for a week, and never the open one', () => {
    const rows = suggestCleanup([tab(1, 'https://a.example/', STALE_TAB_DAYS + 3), tab(2, 'https://b.example/', STALE_TAB_DAYS - 1), tab(3, 'https://c.example/', 30)], 3, NOW)
    expect(rows).toEqual([{ id: 1, title: 'Tab 1', url: 'https://a.example/', reason: 'Not opened for 10 days' }])
  })
})

describe('matchTabs', () => {
  const row = (id: number, title: string, url: string, lastActiveAt: number, workspaceName: string | null = null): TabSearchRow => ({ id, title, url, faviconUrl: null, isLoading: false, pinned: false, audible: false, muted: false, workspaceName, lastActiveAt })
  const rows = [row(1, 'Mail inbox', 'https://mail.example/', 10), row(2, 'Team notes', 'https://docs.example/', 30), row(3, 'Recipes', 'https://food.example/', 20, 'Home')]

  it('lists the most recently used first when nothing is typed', () => {
    expect(matchTabs('', rows).map((r) => r.id)).toEqual([2, 3, 1])
  })

  it('needs every word, from the title, address or workspace', () => {
    expect(matchTabs('mail inbox', rows).map((r) => r.id)).toEqual([1])
    expect(matchTabs('docs.example', rows).map((r) => r.id)).toEqual([2])
    expect(matchTabs('home', rows).map((r) => r.id)).toEqual([3])
    expect(matchTabs('mail notes', rows)).toEqual([])
  })
})

describe('split view sizes', () => {
  it('keeps the divider within its limits', () => {
    expect(clampSplitRatio(0)).toBe(0.2)
    expect(clampSplitRatio(1)).toBe(0.8)
    expect(clampSplitRatio(0.4)).toBe(0.4)
  })

  it('shares out the room left after the gap', () => {
    expect(splitLeftWidth(1000 + SPLIT_GAP, 0.25)).toBe(250)
  })
})
