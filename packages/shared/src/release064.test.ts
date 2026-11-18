import { describe, expect, it } from 'vitest'
import { buildSuggestions, completeDomain, scopeFromInput } from './omnibox'
import { tooltipBox, tooltipSize } from './overlay'
import { treeFolds, type TabState } from './tabs'
import { convertUnits } from './units'

const tab = (id: number, depth = 0, extra: Partial<TabState> = {}): TabState => ({
  id, url: `https://site${id}.test/`, title: `Site ${id}`, faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false,
  isSleeping: false, zoomPercent: 100, blockedCount: 0, container: null, group: null, workspace: 'main', pinned: false, audible: false, muted: false,
  depth, ...extra
})

describe('unit conversions', () => {
  it('converts lengths, weights, temperatures and data', () => {
    expect(convertUnits('5 km in miles')?.text).toBe('3.10686 mi')
    expect(convertUnits('5km to mi')?.answer).toBe('3.10686')
    expect(convertUnits('30 c to f')?.text).toBe('86 °F')
    expect(convertUnits('100 fahrenheit in celsius')?.text).toBe('37.7778 °C')
    expect(convertUnits('2.5 kg in lb')?.text).toBe('5.51156 lb')
    expect(convertUnits('1 GiB to MB')?.text).toBe('1073.74 MB')
    expect(convertUnits('100 km/h to mph')?.text).toBe('62.1371 mph')
    expect(convertUnits('2 fl oz to ml')?.text).toBe('59.1471 ml')
    expect(convertUnits('2*3 ft to m')?.text).toBe('1.8288 m')
  })

  it('refuses mixed kinds and ordinary questions', () => {
    for (const input of ['5 km in kg', 'time in tokyo', 'weather in sydney', '5 apples to pears', 'km to mi']) expect(convertUnits(input), input).toBeNull()
  })

  it('shows in the address bar like a sum', () => {
    const rows = buildSuggestions('5 km in miles', { history: [], tabs: [], activeTabId: null })
    expect(rows[1]).toMatchObject({ kind: 'calc', title: '5 km in miles = 3.10686 mi', action: { type: 'copy', text: '3.10686' } })
  })
})

describe('address bar scopes', () => {
  it('reads @keywords and unique starts of them', () => {
    expect(scopeFromInput('@bookmarks rust')).toEqual({ scope: 'bookmarks', rest: 'rust' })
    expect(scopeFromInput('@h ')).toEqual({ scope: 'history', rest: '' })
    expect(scopeFromInput('@ai what is a monad')).toEqual({ scope: 'ai', rest: 'what is a monad' })
    expect(scopeFromInput('@bookmarks')).toBeNull()
    expect(scopeFromInput('@x hi')).toBeNull()
    expect(scopeFromInput('rust @tabs ')).toBeNull()
  })

  it('lists the shortcuts when @ is typed, leaving out the AI without a model', () => {
    expect(buildSuggestions('@', { history: [], tabs: [], activeTabId: null }).map((row) => row.title)).toEqual(['@bookmarks', '@history', '@tabs'])
    expect(buildSuggestions('@t', { history: [], tabs: [], activeTabId: null, assistantReady: true }).map((row) => row.action)).toEqual([{ type: 'scope', scope: 'tabs' }])
  })

  it('shows only the scope’s rows, with no search row or engine suggestions', () => {
    const bookmarks = [{ id: 1, url: 'https://rust-lang.org/', title: 'Rust', createdAt: 0, groupId: null, position: 0 }, { id: 2, url: 'https://go.dev/', title: 'Go', createdAt: 0, groupId: null, position: 1 }]
    const rows = buildSuggestions('rust', { history: [], tabs: [], activeTabId: null, bookmarks, searchSuggestions: ['rust book'], scope: 'bookmarks' })
    expect(rows.map((row) => row.kind)).toEqual(['bookmark'])
    expect(buildSuggestions('', { history: [], tabs: [tab(1), tab(2)], activeTabId: 1, scope: 'tabs' }).map((row) => row.title)).toEqual(['Site 2'])
  })
})

describe('Ctrl+Enter', () => {
  it('adds www. and .com to a single word only', () => {
    expect(completeDomain('Example')).toBe('https://www.example.com/')
    expect(completeDomain('example.org')).toBeNull()
    expect(completeDomain('two words')).toBeNull()
  })
})

describe('tab tree folds', () => {
  it('hides a folded branch and counts it', () => {
    const tabs = [tab(1), tab(2, 1, { collapsed: true }), tab(3, 2), tab(4, 2), tab(5, 1), tab(6)]
    const folds = treeFolds(tabs)
    expect([...folds.parents]).toEqual([1, 2])
    expect([...folds.hidden]).toEqual([3, 4])
    expect(folds.counts.get(2)).toBe(2)
  })

  it('ignores a fold on a tab with nothing under it', () => {
    expect(treeFolds([tab(1, 0, { collapsed: true }), tab(2)]).hidden.size).toBe(0)
  })
})

describe('tooltip cards', () => {
  it('sit to the right of a side tab, centred on it', () => {
    const card = { anchor: { x: 8, y: 100, width: 200, height: 36 }, label: 'A page', detail: 'site.test · 80 MB memory', placement: 'right' as const }
    const box = tooltipBox(card)
    expect(box.x).toBe(214)
    expect(box.y + box.height / 2).toBeCloseTo(118, 0)
  })

  it('grow with a long address', () => {
    expect(tooltipSize({ label: 'x'.repeat(400), wrap: true }).height).toBeGreaterThan(tooltipSize({ label: 'x'.repeat(40), wrap: true }).height)
  })
})
