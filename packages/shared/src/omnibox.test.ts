import { describe, expect, it } from 'vitest'
import { buildSuggestions, MAX_SUGGESTIONS, type HistoryEntry } from './omnibox'
import type { TabState } from './tabs'

const tab = (id: number, url: string, title = ''): TabState => ({
  id,
  url,
  title,
  faviconUrl: null,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isSleeping: false,
  zoomPercent: 100,
  blockedCount: 0,
  container: null,
  group: null,
  workspace: 'main', pinned: false, audible: false, muted: false
})

const visit = (url: string, title = ''): HistoryEntry => ({ url, title, visitCount: 1, lastVisit: 0 })

describe('buildSuggestions', () => {
  it('returns nothing for empty input', () => {
    expect(buildSuggestions('  ', { history: [], tabs: [], activeTabId: null })).toEqual([])
  })

  it('leads with a search for plain text', () => {
    const [first] = buildSuggestions('rust borrow checker', { history: [], tabs: [], activeTabId: null })
    expect(first).toMatchObject({ kind: 'search', title: 'rust borrow checker', detail: 'Search DuckDuckGo' })
  })

  it('leads with navigation for something URL-like', () => {
    const [first] = buildSuggestions('example.com', { history: [], tabs: [], activeTabId: null })
    expect(first).toMatchObject({ kind: 'navigate', action: { type: 'navigate', url: 'https://example.com' } })
  })

  it('offers matching open tabs except the active one', () => {
    const tabs = [tab(1, 'https://github.com/', 'GitHub'), tab(2, 'https://github.com/issues', 'Issues')]
    const result = buildSuggestions('github', { history: [], tabs, activeTabId: 1 })
    expect(result.filter((s) => s.kind === 'tab').map((s) => s.action)).toEqual([{ type: 'switch-tab', tabId: 2 }])
  })

  it('does not repeat a URL that is already an open tab', () => {
    const tabs = [tab(2, 'https://github.com/issues', 'Issues')]
    const history = [visit('https://github.com/issues', 'Issues'), visit('https://github.com/pulls', 'Pulls')]
    const result = buildSuggestions('github', { history, tabs, activeTabId: 1 })
    expect(result.map((s) => s.kind)).toEqual(['search', 'tab', 'history'])
  })

  it('lists matching bookmarks ahead of the same URL in history', () => {
    const bookmarks = [{ id: 1, url: 'https://a.dev/', title: 'Alpha docs', createdAt: 0, groupId: null, position: 0 }]
    const result = buildSuggestions('alpha', {
      history: [visit('https://a.dev/', 'Alpha docs')],
      bookmarks,
      tabs: [],
      activeTabId: null
    })
    expect(result.map((s) => s.kind)).toEqual(['search', 'bookmark'])
  })

  it('offers both assistant rows for searches, once one is set up', () => {
    const base = { history: [], tabs: [], activeTabId: null, assistantReady: true }
    expect(buildSuggestions('rust', base).slice(1, 3)).toMatchObject([
      { detail: 'Ask scTerra', action: { type: 'ask', text: 'rust' } },
      { detail: 'Ask Assistant', action: { type: 'ask-page', text: 'rust' } }
    ])
    expect(buildSuggestions('example.com', base).some((s) => s.kind === 'ask')).toBe(false)
    expect(buildSuggestions('rust', { ...base, assistantReady: false }).some((s) => s.kind === 'ask')).toBe(false)
  })

  it('leaves out sources that are switched off', () => {
    const options = {
      history: [visit('https://a.dev/history', 'match')],
      bookmarks: [{ id: 1, url: 'https://a.dev/bookmark', title: 'match', createdAt: 0, groupId: null, position: 0 }],
      tabs: [tab(2, 'https://a.dev/tab', 'match')],
      activeTabId: 1,
      assistantReady: true
    }
    const kinds = (sources: ('tabs' | 'bookmarks' | 'history' | 'assistant')[]) =>
      buildSuggestions('match', { ...options, sources }).map((s) => s.kind)
    expect(kinds([])).toEqual(['search'])
    expect(kinds(['history'])).toEqual(['search', 'history'])
    expect(kinds(['tabs', 'bookmarks'])).toEqual(['search', 'tab', 'bookmark'])
    expect(kinds(['assistant'])).toEqual(['search', 'ask', 'ask-page'])
  })

  it('caps the list and drops search suggestions equal to the input', () => {
    const history = Array.from({ length: 20 }, (_, i) => visit(`https://site${i}.dev/`))
    const result = buildSuggestions('site', {
      history,
      tabs: [],
      activeTabId: null,
      searchSuggestions: ['site', 'site map']
    })
    expect(result).toHaveLength(MAX_SUGGESTIONS)
    expect(result.at(-1)).toMatchObject({ kind: 'search-suggestion', title: 'site map' })
  })
})
