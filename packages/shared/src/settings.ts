import { PASSWORD_LOCK_CHOICES } from './passwords'
import { isBypassHost, type VpnMethod, type VpnScope } from './vpn'
import { TRANSLATE_LANGUAGES, type TranslateLanguage } from './ai'
import { isToolbarOrder, TOOLBAR_ITEMS, TOOLBAR_SLOTS, type ToolbarItemId, type ToolbarSlot } from './containers'
import { DEFAULT_BLOCKER, isBlockerConfig, type BlockerConfig } from './blocker'
import { DEFAULT_NEW_TAB, isNewTabConfig, type NewTabConfig } from './newtab'
import { ACCENTS, type AccentId } from './privacy'
import type { SearchEngine } from './url'

const isWidth = (v: unknown) => Number.isInteger(v) && (v as number) >= 160 && (v as number) <= 2000

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
  /** Trades polish for speed: see `sleepMinutes`, `data-performance` in tokens.css and `quietMedia` in TabManager. */
  performanceMode: boolean
  /** Empty means the system Downloads folder. */
  downloadDir: string
  askWhereToSave: boolean
  /** Keep assistant chats on this device between sessions. */
  saveChats: boolean
  /** Standard blocks ads and trackers; strict also blocks annoyances like cookie banners. */
  trackingProtection: 'off' | 'standard' | 'strict'
  httpsOnly: boolean
  accent: AccentId
  /** A faint wash of the accent behind the toolbar and browser pages. */
  accentTint: boolean
  hiddenToolbarItems: ToolbarItemId[]
  toolbarOrder: ToolbarSlot[]
  translateTo: TranslateLanguage
  /** Google is quick and free, and sees the page's text. The AI uses the person's own model and credit. */
  translateEngine: 'google' | 'ai'
  /** A small panel under the toolbar's button, or the extension's own side panel and windows. */
  extensionDisplay: 'panel' | 'window'
  spellCheck: boolean
  /** A language code, or empty to follow the system. */
  spellLanguage: string
  newTab: NewTabConfig
  /** How long a VPN ping waits before moving to the next connection. */
  vpnPingTimeout: number
  vpnScope: VpnScope
  vpnMethod: VpnMethod
  /** Connect as soon as scTerra starts, holding pages back until it has. */
  vpnAutoConnect: boolean
  /** Turning the VPN on first picks the fastest working connection in the same group. */
  vpnAutoFastest: boolean
  /** Sites that go direct instead of through the VPN, like example.com. */
  vpnBypass: string[]
  /** Widths in pixels of what can be dragged wider or narrower. */
  assistantWidth: number
  extensionPanelWidth: number
  reportWidth: number
  sidebarWidth: number
  devToolsWidth: number
  /** Minutes unused before passwords lock again, or 0 for only when closed. */
  passwordLockMinutes: number
  passwordOfferSave: boolean
  /** Also offers while the vault is locked or hasn't been set up, which keeps the login in memory for a minute. */
  passwordOfferLocked: boolean
  blocker: BlockerConfig
  /** Also called Study Mode: turns on Focus Mode rules and categories. */
  focusMode: boolean
  /** Include browsing history in sync, as well as bookmarks and settings. */
  syncHistory: boolean
  /** Off until the person turns them on. */
  crashReports: boolean
  usageStats: boolean
  /** Show a button for switching profiles in the toolbar. */
  profilesButton: boolean
  /** Download new versions in the background. */
  autoUpdate: boolean
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
  performanceMode: false,
  downloadDir: '',
  askWhereToSave: false,
  saveChats: true,
  trackingProtection: 'standard',
  httpsOnly: true,
  accent: 'teal',
  accentTint: false,
  hiddenToolbarItems: [],
  toolbarOrder: [...TOOLBAR_SLOTS],
  translateTo: 'English',
  translateEngine: 'google',
  extensionDisplay: 'panel',
  spellCheck: true,
  spellLanguage: '',
  newTab: DEFAULT_NEW_TAB,
  vpnPingTimeout: 3000,
  vpnScope: 'browser',
  vpnMethod: 'proxy',
  vpnAutoConnect: false,
  vpnAutoFastest: false,
  vpnBypass: [],
  assistantWidth: 360,
  extensionPanelWidth: 360,
  reportWidth: 560,
  sidebarWidth: 240,
  devToolsWidth: 460,
  passwordLockMinutes: 15,
  passwordOfferSave: true,
  passwordOfferLocked: true,
  blocker: DEFAULT_BLOCKER,
  focusMode: false,
  syncHistory: true,
  crashReports: false,
  usageStats: false,
  profilesButton: false,
  autoUpdate: true
}

/** How soon Performance Mode sleeps background tabs. */
export const PERFORMANCE_SLEEP_MINUTES = 5

/** Minutes before a background tab sleeps, or 0 for never. Performance Mode only ever makes it sooner. */
export function sleepMinutes({ performanceMode, sleepAfterMinutes }: Pick<Settings, 'performanceMode' | 'sleepAfterMinutes'>): number {
  if (!performanceMode) return sleepAfterMinutes
  return sleepAfterMinutes > 0 ? Math.min(sleepAfterMinutes, PERFORMANCE_SLEEP_MINUTES) : PERFORMANCE_SLEEP_MINUTES
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
  performanceMode: (v) => typeof v === 'boolean',
  downloadDir: (v) => typeof v === 'string' && v.length <= 4096,
  askWhereToSave: (v) => typeof v === 'boolean',
  saveChats: (v) => typeof v === 'boolean',
  trackingProtection: (v) => oneOf(v, ['off', 'standard', 'strict']),
  httpsOnly: (v) => typeof v === 'boolean',
  accent: (v) => ACCENTS.some((accent) => accent.id === v),
  accentTint: (v) => typeof v === 'boolean',
  translateTo: (v) => TRANSLATE_LANGUAGES.includes(v as TranslateLanguage),
  translateEngine: (v) => v === 'google' || v === 'ai',
  extensionDisplay: (v) => v === 'panel' || v === 'window',
  spellCheck: (v) => typeof v === 'boolean',
  spellLanguage: (v) => typeof v === 'string' && /^([a-zA-Z-]{2,16})?$/.test(v),
  hiddenToolbarItems: (v) => Array.isArray(v) && v.every((id) => TOOLBAR_ITEMS.some((item) => item.id === id)),
  toolbarOrder: isToolbarOrder,
  newTab: isNewTabConfig,
  vpnPingTimeout: (v) => Number.isInteger(v) && (v as number) >= 200 && (v as number) <= 30_000,
  vpnScope: (v) => v === 'browser' || v === 'computer',
  vpnMethod: (v) => v === 'proxy' || v === 'tun',
  vpnAutoConnect: (v) => typeof v === 'boolean',
  vpnAutoFastest: (v) => typeof v === 'boolean',
  vpnBypass: (v) => Array.isArray(v) && v.length <= 500 && v.every(isBypassHost),
  assistantWidth: isWidth,
  extensionPanelWidth: isWidth,
  reportWidth: isWidth,
  sidebarWidth: isWidth,
  devToolsWidth: isWidth,
  passwordLockMinutes: (v) => (PASSWORD_LOCK_CHOICES as readonly unknown[]).includes(v),
  passwordOfferSave: (v) => typeof v === 'boolean',
  passwordOfferLocked: (v) => typeof v === 'boolean',
  blocker: isBlockerConfig,
  focusMode: (v) => typeof v === 'boolean',
  syncHistory: (v) => typeof v === 'boolean',
  crashReports: (v) => typeof v === 'boolean',
  usageStats: (v) => typeof v === 'boolean',
  profilesButton: (v) => typeof v === 'boolean',
  autoUpdate: (v) => typeof v === 'boolean'
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
