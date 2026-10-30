import type { Bookmark } from './library'
import type { TabId, TabState } from './tabs'
import { DEFAULT_SEARCH_ENGINE, isNewTabUrl, resolveOmniboxInput, type SearchEngine } from './url'

export interface HistoryEntry {
  url: string
  title: string
  visitCount: number
  lastVisit: number
}

export type SuggestionKind = 'navigate' | 'search' | 'tab' | 'bookmark' | 'history' | 'search-suggestion'

export type SuggestionAction = { type: 'navigate'; url: string } | { type: 'switch-tab'; tabId: TabId }

export interface Suggestion {
  /** Stable within one result list, used as a React key. */
  id: string
  kind: SuggestionKind
  title: string
  /** Secondary text, usually a URL. */
  detail?: string
  action: SuggestionAction
}

export const MAX_SUGGESTIONS = 8
const MAX_TABS = 2
const MAX_SEARCH_SUGGESTIONS = 4

const searchUrl = (query: string, engine: SearchEngine) => engine.template.replace('%s', encodeURIComponent(query))

const matches = (needle: string, ...haystacks: string[]) => haystacks.some((h) => h.toLowerCase().includes(needle))

interface BuildOptions {
  history: HistoryEntry[]
  bookmarks?: Bookmark[]
  tabs: TabState[]
  activeTabId: TabId | null
  searchSuggestions?: string[]
  engine?: SearchEngine
}

/**
 * Builds the omnibox dropdown. The first row is always what Enter does with the raw input
 * (visit the URL, or search for it); open tabs come next so "switch to tab" beats opening
 * duplicates, then history, then the search engine's own suggestions.
 */
export function buildSuggestions(rawInput: string, options: BuildOptions): Suggestion[] {
  const input = rawInput.trim()
  if (!input) return []
  const engine = options.engine ?? DEFAULT_SEARCH_ENGINE
  const needle = input.toLowerCase()
  const resolved = resolveOmniboxInput(input, engine)
  const isSearch = resolved === searchUrl(input, engine)

  const results: Suggestion[] = [
    isSearch
      ? { id: 'default', kind: 'search', title: input, detail: `Search ${engine.name}`, action: { type: 'navigate', url: resolved } }
      : { id: 'default', kind: 'navigate', title: resolved, action: { type: 'navigate', url: resolved } }
  ]
  const seenUrls = new Set([resolved])

  const tabs = options.tabs
    .filter((tab) => tab.id !== options.activeTabId && !isNewTabUrl(tab.url) && matches(needle, tab.url, tab.title))
    .slice(0, MAX_TABS)
  for (const tab of tabs) {
    seenUrls.add(tab.url)
    results.push({
      id: `tab:${tab.id}`,
      kind: 'tab',
      title: tab.title || tab.url,
      detail: tab.url,
      action: { type: 'switch-tab', tabId: tab.id }
    })
  }

  for (const bookmark of options.bookmarks ?? []) {
    if (results.length >= MAX_SUGGESTIONS - 1) break
    if (seenUrls.has(bookmark.url) || !matches(needle, bookmark.url, bookmark.title)) continue
    seenUrls.add(bookmark.url)
    results.push({
      id: `bookmark:${bookmark.id}`,
      kind: 'bookmark',
      title: bookmark.title || bookmark.url,
      detail: bookmark.url,
      action: { type: 'navigate', url: bookmark.url }
    })
  }

  for (const entry of options.history) {
    if (results.length >= MAX_SUGGESTIONS - 1) break
    if (seenUrls.has(entry.url)) continue
    seenUrls.add(entry.url)
    results.push({
      id: `history:${entry.url}`,
      kind: 'history',
      title: entry.title || entry.url,
      detail: entry.url,
      action: { type: 'navigate', url: entry.url }
    })
  }

  const phrases = (options.searchSuggestions ?? [])
    .filter((phrase) => phrase.toLowerCase() !== needle)
    .slice(0, MAX_SEARCH_SUGGESTIONS)
  for (const phrase of phrases) {
    if (results.length >= MAX_SUGGESTIONS) break
    results.push({
      id: `suggest:${phrase}`,
      kind: 'search-suggestion',
      title: phrase,
      action: { type: 'navigate', url: searchUrl(phrase, engine) }
    })
  }
  return results
}
