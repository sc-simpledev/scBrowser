import { TRANSLATE_LANGUAGES, type TranslateLanguage } from './ai'
import { TOOLBAR_ITEMS, type ToolbarItemId } from './containers'
import { DEFAULT_BLOCKER, isBlockerConfig, type BlockerConfig } from './blocker'
import { DEFAULT_NEW_TAB, isNewTabConfig, type NewTabConfig } from './newtab'
import { ACCENTS, type AccentId } from './privacy'
import type { SearchEngine } from './url'

export interface EngineOption extends SearchEngine {
  id: string
  /** OpenSearch-style endpoint returning ["query", ["suggestion", ...]]; `%s` is the query. */
  suggestTemplate: string | null
}

export const SEARCH_ENGINES: EngineOption[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    template: 'https://duckduckgo.com/?q=%s',
    suggestTemplate: 'https://duckduckgo.com/ac/?type=list&q=%s'
  },
  {
    id: 'google',
    name: 'Google',
    template: 'https://www.google.com/search?q=%s',
    suggestTemplate: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s'
  },
  {
    id: 'bing',
    name: 'Bing',
    template: 'https://www.bing.com/search?q=%s',
    suggestTemplate: 'https://api.bing.com/osjson.aspx?query=%s'
  },
  {
    id: 'brave',
    name: 'Brave Search',
    template: 'https://search.brave.com/search?q=%s',
    suggestTemplate: 'https://search.brave.com/api/suggest?q=%s'
  },
  { id: 'startpage', name: 'Startpage', template: 'https://www.startpage.com/do/search?q=%s', suggestTemplate: null },
  { id: 'ecosia', name: 'Ecosia', template: 'https://www.ecosia.org/search?q=%s', suggestTemplate: null }
]

export const engineById = (id: string): EngineOption =>
  SEARCH_ENGINES.find((engine) => engine.id === id) ?? SEARCH_ENGINES[0]!

export const SUGGESTION_SOURCES = [
  { id: 'tabs', name: 'Open tabs' },
  { id: 'bookmarks', name: 'Bookmarks' },
  { id: 'history', name: 'History' },
  { id: 'assistant', name: 'Ask the assistant' }
] as const

export type SuggestionSourceId = (typeof SUGGESTION_SOURCES)[number]['id']

export interface Settings {
  searchEngine: string
  /** Send typed text to the search engine for completions. */
  searchSuggestions: boolean
  /** What else the address bar suggests. */
  suggestionSources: SuggestionSourceId[]
  theme: 'system' | 'light' | 'dark'
  tabLayout: 'horizontal' | 'vertical'
  verticalTabsCollapsed: boolean
  /** Where the bookmarks bar appears. */
  bookmarksBar: 'always' | 'new-tab' | 'bookmarks-page'
  startup: 'restore' | 'new-tab'
  /** Background tabs are unloaded after this many minutes; 0 disables it. */
  sleepAfterMinutes: number
  /** Empty means the system Downloads folder. */
  downloadDir: string
  askWhereToSave: boolean
  /** Keep assistant chats on this device between sessions. */
  saveChats: boolean
  /** Standard blocks ads and trackers; strict also blocks annoyances like cookie banners. */
  trackingProtection: 'off' | 'standard' | 'strict'
  httpsOnly: boolean
  accent: AccentId
  hiddenToolbarItems: ToolbarItemId[]
  translateTo: TranslateLanguage
  newTab: NewTabConfig
  blocker: BlockerConfig
  /** Also called Study Mode: turns on Focus Mode rules and categories. */
  focusMode: boolean
  /** Include browsing history in sync, as well as bookmarks and settings. */
  syncHistory: boolean
  /** Off until the person turns them on. */
  crashReports: boolean
  usageStats: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'duckduckgo',
  searchSuggestions: true,
  suggestionSources: SUGGESTION_SOURCES.map((source) => source.id),
  theme: 'system',
  tabLayout: 'vertical',
  verticalTabsCollapsed: false,
  bookmarksBar: 'always',
  startup: 'restore',
  sleepAfterMinutes: 30,
  downloadDir: '',
  askWhereToSave: false,
  saveChats: true,
  trackingProtection: 'standard',
  httpsOnly: true,
  accent: 'teal',
  hiddenToolbarItems: [],
  translateTo: 'English',
  newTab: DEFAULT_NEW_TAB,
  blocker: DEFAULT_BLOCKER,
  focusMode: false,
  syncHistory: true,
  crashReports: false,
  usageStats: false
}

const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => options.includes(value as T)

const validators: { [K in keyof Settings]: (value: unknown) => boolean } = {
  searchEngine: (v) => SEARCH_ENGINES.some((engine) => engine.id === v),
  searchSuggestions: (v) => typeof v === 'boolean',
  theme: (v) => oneOf(v, ['system', 'light', 'dark']),
  tabLayout: (v) => oneOf(v, ['horizontal', 'vertical']),
  verticalTabsCollapsed: (v) => typeof v === 'boolean',
  bookmarksBar: (v) => oneOf(v, ['always', 'new-tab', 'bookmarks-page']),
  suggestionSources: (v) => Array.isArray(v) && v.every((id) => SUGGESTION_SOURCES.some((source) => source.id === id)),
  startup: (v) => oneOf(v, ['restore', 'new-tab']),
  sleepAfterMinutes: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1440,
  downloadDir: (v) => typeof v === 'string' && v.length <= 4096,
  askWhereToSave: (v) => typeof v === 'boolean',
  saveChats: (v) => typeof v === 'boolean',
  trackingProtection: (v) => oneOf(v, ['off', 'standard', 'strict']),
  httpsOnly: (v) => typeof v === 'boolean',
  accent: (v) => ACCENTS.some((accent) => accent.id === v),
  translateTo: (v) => TRANSLATE_LANGUAGES.includes(v as TranslateLanguage),
  hiddenToolbarItems: (v) => Array.isArray(v) && v.every((id) => TOOLBAR_ITEMS.some((item) => item.id === id)),
  newTab: isNewTabConfig,
  blocker: isBlockerConfig,
  focusMode: (v) => typeof v === 'boolean',
  syncHistory: (v) => typeof v === 'boolean',
  crashReports: (v) => typeof v === 'boolean',
  usageStats: (v) => typeof v === 'boolean'
}

/** Keeps only known keys with valid values, so bad stored or sent data can't reach the app. */
export function sanitizeSettings(input: unknown): Partial<Settings> {
  if (typeof input !== 'object' || input === null) return {}
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (Object.hasOwn(validators, key) && validators[key as keyof Settings](value)) clean[key] = value
  }
  return clean as Partial<Settings>
}
