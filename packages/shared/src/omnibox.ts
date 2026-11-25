import { calculate, formatCalculation } from './calc'
import type { Bookmark } from './library'
import type { SuggestionSourceId } from './settings'
import type { TabId, TabState } from './tabs'
import { convertUnits } from './units'
import { DEFAULT_SEARCH_ENGINE, isNewTabUrl, keywordNamed, keywordSearch, resolveOmniboxInput, type SearchEngine, type SearchKeyword } from './url'

export interface HistoryEntry {
  url: string
  title: string
  visitCount: number
  lastVisit: number
}

export type SuggestionKind = 'navigate' | 'search' | 'tab' | 'bookmark' | 'history' | 'search-suggestion' | 'ask' | 'ask-page' | 'calc' | 'scope' | 'keyword'

export type SuggestionAction =
  | { type: 'navigate'; url: string }
  | { type: 'copy'; text: string }
  | { type: 'switch-tab'; tabId: TabId }
  | { type: 'ask'; text: string }
  | { type: 'ask-page'; text: string }
  | { type: 'scope'; scope: OmniboxScope }
  /** Puts this text in the box to carry on typing, like a keyword and its space. */
  | { type: 'fill'; text: string }

/** `@bookmarks`, `@history`, `@tabs` and `@ai` narrow the address bar to one kind of row. */
export const OMNIBOX_SCOPES = [
  { id: 'bookmarks', name: 'Bookmarks', keyword: '@bookmarks', hint: 'Search bookmarks' },
  { id: 'history', name: 'History', keyword: '@history', hint: 'Search history' },
  { id: 'tabs', name: 'Tabs', keyword: '@tabs', hint: 'Search open tabs' },
  { id: 'ai', name: 'Ask scTerra', keyword: '@ai', hint: 'Ask scTerra AI' }
] as const

export type OmniboxScope = (typeof OMNIBOX_SCOPES)[number]['id']

export const isOmniboxScope = (value: unknown): value is OmniboxScope => OMNIBOX_SCOPES.some((scope) => scope.id === value)

/** `@bo rust` becomes the bookmarks scope with `rust` left to type; any unique start of the word works. */
export function scopeFromInput(input: string): { scope: OmniboxScope; rest: string } | null {
  const match = /^@(\w+)\s(.*)$/s.exec(input)
  if (!match) return null
  const word = match[1]!.toLowerCase()
  const found = OMNIBOX_SCOPES.filter((scope) => scope.keyword.slice(1).startsWith(word))
  return found.length === 1 ? { scope: found[0]!.id, rest: match[2]! } : null
}

/** Ctrl+Enter, as in other browsers: `example` goes to https://www.example.com/. */
export function completeDomain(input: string): string | null {
  const word = input.trim()
  return /^[a-z0-9][a-z0-9-]*$/i.test(word) ? `https://www.${word.toLowerCase()}.com/` : null
}

export interface Suggestion {
  /** Stable within one result list, used as a React key. */
  id: string
  kind: SuggestionKind
  title: string
  /** Secondary text, usually a URL. */
  detail?: string
  /** The site's saved icon, as a data address; the kind's icon is drawn without one. */
  icon?: string
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
  /** Offers to send searches to the assistant. Nothing is sent unless a row is chosen. */
  assistantReady?: boolean
  /** Which kinds of row to show; all of them when left out. */
  sources?: readonly SuggestionSourceId[]
  engine?: SearchEngine
  /** The address completed inline in the box: Enter visits it, so it leads the list. */
  autofill?: Autofill | null
  /** Show the answer to a typed sum. On unless turned off. */
  calculator?: boolean
  /** Only this kind of row, after `@bookmarks` and the like. */
  scope?: OmniboxScope | null
  /** Words that search one site, like `yt cats`. */
  keywords?: readonly SearchKeyword[]
}

export interface Autofill {
  /** What the box shows: the typed text with the rest of the address after it. */
  text: string
  /** Where Enter goes. */
  url: string
}

const SCHEME_AND_WWW = /^(?:https?:\/\/)?(?:www\.)?/i

/**
 * Completes a typed address inline, as Firefox does: `git` becomes `github.com/` when a
 * bookmark, visit or open tab is there. Typing only part of a host completes to the site's
 * home; typing past a `/` completes to the whole saved address. Candidates are tried in the
 * order given, so pass bookmarks first and history by how often it's visited.
 */
export function inlineAutofill(input: string, urls: Iterable<string>): Autofill | null {
  if (!input || /\s/.test(input)) return null
  const typed = input.replace(SCHEME_AND_WWW, '').toLowerCase()
  if (!typed || typed.startsWith('/') || typed.includes('?') || typed.includes('#')) return null
  const wantsPath = typed.includes('/')
  for (const candidate of urls) {
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    const host = parsed.host.replace(/^www\./, '')
    if (wantsPath) {
      const whole = candidate.replace(SCHEME_AND_WWW, '')
      if (whole.toLowerCase().startsWith(typed) && whole.length > typed.length) {
        return { text: input + whole.slice(typed.length), url: candidate }
      }
    } else if (host.toLowerCase().startsWith(typed)) {
      return { text: input + `${host}/`.slice(typed.length), url: `${parsed.protocol}//${parsed.host}/` }
    }
  }
  return null
}

/**
 * Builds the omnibox dropdown. The first row is always what Enter does with the raw input
 * (visit the URL, or search for it); open tabs come next so "switch to tab" beats opening
 * duplicates, then history, then the search engine's own suggestions.
 */
export function buildSuggestions(rawInput: string, options: BuildOptions): Suggestion[] {
  const input = rawInput.trim()
  if (options.scope) return scopedSuggestions(input, options.scope, options)
  if (!input) return []
  // Typing `@` lists the shortcuts, so they can be found without knowing them.
  if (/^@\w*$/.test(input)) {
    const word = input.slice(1).toLowerCase()
    const shown = OMNIBOX_SCOPES.filter((scope) => scope.keyword.slice(1).startsWith(word) && (scope.id !== 'ai' || options.assistantReady))
    if (shown.length > 0) {
      return shown.map((scope) => ({ id: `scope:${scope.id}`, kind: 'scope', title: scope.keyword, detail: scope.hint, action: { type: 'scope', scope: scope.id } }))
    }
  }
  const engine = options.engine ?? DEFAULT_SEARCH_ENGINE
  const needle = input.toLowerCase()
  const resolved = resolveOmniboxInput(input, engine)
  const isSearch = resolved === searchUrl(input, engine)

  const autofill = options.autofill ?? null
  const keywords = options.keywords ?? []
  const site = keywordSearch(input, keywords)
  const results: Suggestion[] = site
    ? // The site's search is what Enter does; the whole text as a web search is one row down.
      [
        { id: 'default', kind: 'search', title: site.query, detail: `Search ${site.keyword.name}`, action: { type: 'navigate', url: site.url } },
        { id: 'web', kind: 'search', title: input, detail: `Search ${engine.name}`, action: { type: 'navigate', url: searchUrl(input, engine) } }
      ]
    : [
        autofill
          ? { id: 'default', kind: 'navigate', title: autofill.url, action: { type: 'navigate', url: autofill.url } }
          : isSearch
            ? { id: 'default', kind: 'search', title: input, detail: `Search ${engine.name}`, action: { type: 'navigate', url: resolved } }
            : { id: 'default', kind: 'navigate', title: resolved, action: { type: 'navigate', url: resolved } }
      ]
  // `yt` on its own: say what a space and a search would do. Tab or picking the row adds the space.
  const named = site ? null : keywordNamed(input, keywords)
  if (named) {
    results.push({ id: 'keyword', kind: 'keyword', title: `Search ${named.name}`, detail: `${named.keyword} and your search`, action: { type: 'fill', text: `${named.keyword} ` } })
  }
  // Right under what Enter does, as in Firefox. Picking it copies the answer.
  const sum = options.calculator === false ? null : calculate(input)
  const converted = options.calculator === false || sum !== null ? null : convertUnits(input)
  if (sum !== null) {
    const answer = formatCalculation(sum)
    results.push({ id: 'calc', kind: 'calc', title: `${input.replace(/=\s*$/, '').trim()} = ${answer}`, action: { type: 'copy', text: answer } })
  } else if (converted) {
    results.push({ id: 'calc', kind: 'calc', title: `${input} = ${converted.text}`, action: { type: 'copy', text: converted.answer } })
  }
  // Nothing typed goes to the AI unless this row is chosen.
  const sources = options.sources ?? ['tabs', 'bookmarks', 'history', 'assistant']
  if (isSearch && options.assistantReady && sources.includes('assistant')) {
    results.push(
      { id: 'ask', kind: 'ask', title: input, detail: 'Ask scTerra', action: { type: 'ask', text: input } },
      { id: 'ask-page', kind: 'ask-page', title: input, detail: 'Ask Assistant', action: { type: 'ask-page', text: input } }
    )
  }
  const seenUrls = new Set([resolved, ...(autofill ? [autofill.url] : []), ...(site ? [site.url] : [])])

  const tabs = (sources.includes('tabs') ? options.tabs : [])
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

  for (const bookmark of sources.includes('bookmarks') ? (options.bookmarks ?? []) : []) {
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

  for (const entry of sources.includes('history') ? options.history : []) {
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

/** The rows for one scope. Empty input lists what there is, where there's a list to show. */
function scopedSuggestions(input: string, scope: OmniboxScope, options: BuildOptions): Suggestion[] {
  const needle = input.toLowerCase()
  const fits = (...text: string[]) => !needle || matches(needle, ...text)
  if (scope === 'ai') {
    if (!input || !options.assistantReady) return []
    return [
      { id: 'ask', kind: 'ask', title: input, detail: 'Ask scTerra', action: { type: 'ask', text: input } },
      { id: 'ask-page', kind: 'ask-page', title: input, detail: 'Ask Assistant', action: { type: 'ask-page', text: input } }
    ]
  }
  if (scope === 'tabs') {
    return options.tabs
      .filter((tab) => tab.id !== options.activeTabId && !isNewTabUrl(tab.url) && fits(tab.url, tab.title))
      .slice(0, MAX_SUGGESTIONS)
      .map((tab) => ({ id: `tab:${tab.id}`, kind: 'tab', title: tab.title || tab.url, detail: tab.url, action: { type: 'switch-tab', tabId: tab.id } }))
  }
  if (scope === 'bookmarks') {
    return (options.bookmarks ?? [])
      .filter((bookmark) => fits(bookmark.url, bookmark.title))
      .slice(0, MAX_SUGGESTIONS)
      .map((bookmark) => ({ id: `bookmark:${bookmark.id}`, kind: 'bookmark', title: bookmark.title || bookmark.url, detail: bookmark.url, action: { type: 'navigate', url: bookmark.url } }))
  }
  return (input ? options.history : [])
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => ({ id: `history:${entry.url}`, kind: 'history', title: entry.title || entry.url, detail: entry.url, action: { type: 'navigate', url: entry.url } }))
}
