import { PASSWORD_LOCK_CHOICES } from './passwords'
import { isBypassHost, type VpnMethod, type VpnScope } from './vpn'
import { TRANSLATE_LANGUAGES, type TranslateLanguage } from './ai'
import { CONTAINERS, isToolbarOrder, TOOLBAR_ITEMS, TOOLBAR_SLOTS, type ToolbarItemId, type ToolbarSlot } from './containers'
import { DEFAULT_BLOCKER, isBlockerConfig, type BlockerConfig } from './blocker'
import { DEFAULT_NEW_TAB, isNewTabConfig, type NewTabConfig } from './newtab'
import { ACCENTS, type AccentId } from './privacy'
import type { SearchEngine } from './url'
import { isHiddenElements, isSiteCss, isSiteHost } from './siteTweaks'
import { isSidebarSites, type SidebarSite } from './sidebarSites'
import { ARCHIVE_CHOICES } from './archive'
import { isDownloadRules, type DownloadRule } from './downloadRules'

const isWidth = (v: unknown) => Number.isInteger(v) && (v as number) >= 160 && (v as number) <= 2000

export interface EngineOption extends SearchEngine {
  id: string
  /** OpenSearch-style endpoint returning ["query", ["suggestion", ...]]; `%s` is the query. */
  suggestTemplate: string | null
}

export const SEARCH_ENGINES: EngineOption[] = [
  {
    id: 'google',
    name: 'Google',
    template: 'https://www.google.com/search?q=%s',
    suggestTemplate: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s'
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    template: 'https://duckduckgo.com/?q=%s',
    suggestTemplate: 'https://duckduckgo.com/ac/?type=list&q=%s'
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

/** Encrypted DNS services to choose from. */
export const SECURE_DNS = {
  default: { name: 'Automatic', url: null },
  cloudflare: { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  quad9: { name: 'Quad9', url: 'https://dns.quad9.net/dns-query' },
  google: { name: 'Google', url: 'https://dns.google/dns-query' }
} as const
export type SecureDns = keyof typeof SECURE_DNS

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
  /** Days a tab goes unused before it's closed into the archive, or 0 for never. Pinned and playing tabs stay. */
  archiveAfterDays: (typeof ARCHIVE_CHOICES)[number]
  /** Trades polish for speed: see `sleepMinutes`, `data-performance` in tokens.css and `quietMedia` in TabManager. */
  performanceMode: boolean
  /** Empty means the system Downloads folder. */
  downloadDir: string
  askWhereToSave: boolean
  /** Folders for downloads of a kind or from a site. Folders belong to this computer, so these aren't synced. */
  downloadRules: DownloadRule[]
  /** Keep assistant chats on this device between sessions. */
  saveChats: boolean
  /** Standard blocks ads and trackers; strict also blocks annoyances like cookie banners. */
  trackingProtection: 'off' | 'standard' | 'strict'
  httpsOnly: boolean
  /** Shift-clicking a link shows it over the page instead of opening a window. */
  linkPreview: boolean
  /** Presses a cookie banner's reject button, never accept. Off for sites where tracking protection is off. */
  rejectCookieBanners: boolean
  /** Sites whose cookies and storage are cleared each time scTerra closes, like example.com. */
  forgetOnClose: string[]
  /** Parts of pages hidden with the picker, as selectors by site. */
  hiddenElements: Record<string, string[]>
  /** The person's own CSS, by site. */
  siteCss: Record<string, string>
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
  /** Side panels dock beside the page, so they stay open while the page is used, or open under the button. */
  extensionSidePanels: 'beside' | 'popover'
  /** A row under the toolbar, or a column of icons and folders down the side, like Arc and Dia. */
  bookmarksLayout: 'horizontal' | 'vertical'
  /** A moon button beside each tab's close button, to put it to sleep and free its memory. */
  tabSleepButton: boolean
  /** Tab groups folded down to their name. */
  collapsedTabGroups: string[]
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
  /** Moves to another server in the same group when the connected one stops answering. */
  vpnFailover: boolean
  /** Who answers DNS lookups, encrypted. `default` leaves it to Chromium and the system. */
  secureDns: SecureDns
  /** Adds the notes on sc://ai to what the model is told. */
  aiMemory: boolean
  /** Turning the VPN on first picks the fastest working connection in the same group. */
  vpnAutoFastest: boolean
  /** Sites that go direct instead of through the VPN, like example.com. */
  vpnBypass: string[]
  /** Containers whose tabs go direct rather than through the VPN, when it covers just scTerra. */
  vpnDirectContainers: string[]
  /** Sites kept in a rail at the right edge, each opening in a panel beside the page. */
  sidebarSites: SidebarSite[]
  /** Widths in pixels of what can be dragged wider or narrower. */
  assistantWidth: number
  extensionPanelWidth: number
  reportWidth: number
  sidebarWidth: number
  devToolsWidth: number
  sidebarSiteWidth: number
  /** Minutes unused before passwords lock again, or 0 for only when closed. */
  passwordLockMinutes: number
  passwordOfferSave: boolean
  /** Also offers while the vault is locked or hasn't been set up, which keeps the login in memory for a minute. */
  passwordOfferLocked: boolean
  /** A list of saved logins under sign-in fields when one is clicked. */
  passwordSuggest: boolean
  /** Fills a page's sign-in form by itself when exactly one login is saved for the site. */
  passwordAutoFill: boolean
  /** Keeps sign-ins that sites meant to last only until the browser closes, as Chrome does when it continues where it left off. */
  keepSignIns: boolean
  /** Sleeps the oldest background tabs when the computer is short of memory, like Chrome's Memory Saver. */
  memorySaver: boolean
  /** The project folder agentic coding (beta) works in, on this computer only. */
  coderFolder: string
  coderMode: 'plan' | 'ask' | 'edits'
  blocker: BlockerConfig
  /** Also called Study Mode: turns on Focus Mode rules and categories. */
  focusMode: boolean
  /** When a focus session turns Focus Mode off again, or 0 when none is running. */
  focusUntil: number
  /** A study session's break ends here, then the next round of focus starts. 0 outside a break. */
  focusBreakUntil: number
  /** Which round of a study session this is, from 1. 0 outside a study session. */
  studyRound: number
  studyRounds: number
  /** Include browsing history in sync, as well as bookmarks and settings. */
  syncHistory: boolean
  /** Off until the person turns them on. */
  crashReports: boolean
  usageStats: boolean
  /** Show a button for switching profiles in the toolbar. */
  profilesButton: boolean
  /** Download new versions in the background. */
  autoUpdate: boolean
  /** Leave a downloaded update until the browser closes, with no Restart button in the toolbar. */
  updateOnQuit: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'google',
  searchSuggestions: true,
  suggestionSources: SUGGESTION_SOURCES.map((source) => source.id),
  theme: 'system',
  tabLayout: 'vertical',
  verticalTabsCollapsed: false,
  bookmarksBar: 'always',
  startup: 'restore',
  sleepAfterMinutes: 30,
  performanceMode: false,
  archiveAfterDays: 0,
  downloadDir: '',
  askWhereToSave: false,
  downloadRules: [],
  saveChats: true,
  trackingProtection: 'standard',
  httpsOnly: true,
  linkPreview: true,
  rejectCookieBanners: true,
  forgetOnClose: [],
  hiddenElements: {},
  siteCss: {},
  accent: 'teal',
  accentTint: false,
  hiddenToolbarItems: [],
  toolbarOrder: [...TOOLBAR_SLOTS],
  translateTo: 'English',
  translateEngine: 'google',
  extensionDisplay: 'panel',
  extensionSidePanels: 'beside',
  bookmarksLayout: 'horizontal',
  tabSleepButton: false,
  collapsedTabGroups: [],
  spellCheck: true,
  spellLanguage: '',
  newTab: DEFAULT_NEW_TAB,
  vpnPingTimeout: 3000,
  vpnScope: 'browser',
  vpnMethod: 'proxy',
  vpnAutoConnect: false,
  vpnFailover: false,
  secureDns: 'default',
  aiMemory: true,
  vpnAutoFastest: false,
  vpnBypass: [],
  vpnDirectContainers: [],
  assistantWidth: 360,
  extensionPanelWidth: 360,
  reportWidth: 560,
  sidebarWidth: 240,
  devToolsWidth: 460,
  sidebarSiteWidth: 400,
  sidebarSites: [],
  passwordLockMinutes: 15,
  passwordOfferSave: true,
  passwordOfferLocked: true,
  passwordSuggest: true,
  passwordAutoFill: true,
  keepSignIns: true,
  memorySaver: true,
  coderFolder: '',
  coderMode: 'ask',
  blocker: DEFAULT_BLOCKER,
  focusMode: false,
  focusUntil: 0,
  focusBreakUntil: 0,
  studyRound: 0,
  studyRounds: 4,
  syncHistory: true,
  crashReports: false,
  usageStats: false,
  profilesButton: false,
  autoUpdate: true,
  updateOnQuit: false
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
  archiveAfterDays: (v) => (ARCHIVE_CHOICES as readonly unknown[]).includes(v),
  downloadDir: (v) => typeof v === 'string' && v.length <= 4096,
  askWhereToSave: (v) => typeof v === 'boolean',
  downloadRules: isDownloadRules,
  saveChats: (v) => typeof v === 'boolean',
  trackingProtection: (v) => oneOf(v, ['off', 'standard', 'strict']),
  httpsOnly: (v) => typeof v === 'boolean',
  linkPreview: (v) => typeof v === 'boolean',
  rejectCookieBanners: (v) => typeof v === 'boolean',
  forgetOnClose: (v) => Array.isArray(v) && v.length <= 200 && v.every(isSiteHost),
  hiddenElements: isHiddenElements,
  siteCss: isSiteCss,
  accent: (v) => ACCENTS.some((accent) => accent.id === v),
  accentTint: (v) => typeof v === 'boolean',
  translateTo: (v) => TRANSLATE_LANGUAGES.includes(v as TranslateLanguage),
  translateEngine: (v) => v === 'google' || v === 'ai',
  extensionDisplay: (v) => v === 'panel' || v === 'window',
  extensionSidePanels: (v) => v === 'beside' || v === 'popover',
  bookmarksLayout: (v) => v === 'horizontal' || v === 'vertical',
  tabSleepButton: (v) => typeof v === 'boolean',
  collapsedTabGroups: (v) => Array.isArray(v) && v.length <= 200 && v.every((name) => typeof name === 'string' && name.length <= 60),
  spellCheck: (v) => typeof v === 'boolean',
  spellLanguage: (v) => typeof v === 'string' && /^([a-zA-Z-]{2,16})?$/.test(v),
  hiddenToolbarItems: (v) => Array.isArray(v) && v.every((id) => TOOLBAR_ITEMS.some((item) => item.id === id)),
  toolbarOrder: isToolbarOrder,
  newTab: isNewTabConfig,
  vpnPingTimeout: (v) => Number.isInteger(v) && (v as number) >= 200 && (v as number) <= 30_000,
  vpnScope: (v) => v === 'browser' || v === 'computer',
  vpnMethod: (v) => v === 'proxy' || v === 'tun',
  vpnAutoConnect: (v) => typeof v === 'boolean',
  vpnFailover: (v) => typeof v === 'boolean',
  secureDns: (v) => typeof v === 'string' && v in SECURE_DNS,
  aiMemory: (v) => typeof v === 'boolean',
  vpnAutoFastest: (v) => typeof v === 'boolean',
  vpnBypass: (v) => Array.isArray(v) && v.length <= 500 && v.every(isBypassHost),
  vpnDirectContainers: (v) => Array.isArray(v) && v.every((id) => CONTAINERS.some((container) => container.id === id)),
  assistantWidth: isWidth,
  extensionPanelWidth: isWidth,
  reportWidth: isWidth,
  sidebarWidth: isWidth,
  devToolsWidth: isWidth,
  sidebarSiteWidth: isWidth,
  sidebarSites: isSidebarSites,
  passwordLockMinutes: (v) => (PASSWORD_LOCK_CHOICES as readonly unknown[]).includes(v),
  passwordOfferSave: (v) => typeof v === 'boolean',
  passwordOfferLocked: (v) => typeof v === 'boolean',
  passwordSuggest: (v) => typeof v === 'boolean',
  passwordAutoFill: (v) => typeof v === 'boolean',
  keepSignIns: (v) => typeof v === 'boolean',
  memorySaver: (v) => typeof v === 'boolean',
  coderFolder: (v) => typeof v === 'string' && v.length <= 4096,
  coderMode: (v) => v === 'plan' || v === 'ask' || v === 'edits',
  blocker: isBlockerConfig,
  focusMode: (v) => typeof v === 'boolean',
  focusUntil: (v) => Number.isSafeInteger(v) && (v as number) >= 0,
  focusBreakUntil: (v) => Number.isSafeInteger(v) && (v as number) >= 0,
  studyRound: (v) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 12,
  studyRounds: (v) => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= 12,
  syncHistory: (v) => typeof v === 'boolean',
  crashReports: (v) => typeof v === 'boolean',
  usageStats: (v) => typeof v === 'boolean',
  profilesButton: (v) => typeof v === 'boolean',
  autoUpdate: (v) => typeof v === 'boolean',
  updateOnQuit: (v) => typeof v === 'boolean'
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
