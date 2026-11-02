import { describe, expect, it } from 'vitest'
import { STALE_TAB_DAYS, suggestCleanup } from './tabs'

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
