import { PASSWORD_LOCK_CHOICES } from './passwords'
import { isBypassHost, type VpnMethod, type VpnScope } from './vpn'
import { TRANSLATE_LANGUAGES, type TranslateLanguage } from './ai'
import { CONTAINERS, isToolbarOrder, TOOLBAR_ITEMS, TOOLBAR_SLOTS, type ToolbarItemId, type ToolbarSlot } from './containers'
import { DEFAULT_BLOCKER, isBlockerConfig, type BlockerConfig } from './blocker'
import { DEFAULT_NEW_TAB, isNewTabConfig, type NewTabConfig } from './newtab'
import { ACCENTS, type AccentId } from './privacy'
import { DEFAULT_SEARCH_KEYWORDS, isSearchKeywords, type SearchEngine, type SearchKeyword } from './url'
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
  /** Complete a typed address inline from bookmarks, history and open tabs. */
  addressAutofill: boolean
  /** Answer sums like 7*8 in the address bar and the new tab search box. */
  addressCalculator: boolean
  /** Words that search one site from the address bar, like `yt cats`. */
  searchKeywords: SearchKeyword[]
  theme: 'system' | 'light' | 'dark'
  tabLayout: 'horizontal' | 'vertical'
  verticalTabsCollapsed: boolean
  /** With tabs down the side, the sidebar hides and slides out when the pointer reaches the window's left edge, like Dia. */
  sidebarAutoHide: boolean
  /** The tab sidebar's colour: 'default', or a colour as #rrggbb, mixed into the theme so it suits light and dark. */
  sidebarColor: string
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
  /** Takes tracking tags like utm_source and fbclid off addresses as pages open. */
  cleanLinks: boolean
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
  /** Side tabs are drawn as a tree: a tab opened from a link sits indented under the tab it came from. */
  tabTree: boolean
  /** The focus timer under the side tabs. Only shown with vertical tabs. */
  sidebarTimer: boolean
  /** A small Now playing control for sound or video in a tab you aren't looking at. */
  mediaControls: boolean
  /** A playing video floats in picture in picture when you switch away from its tab. */
  autoPictureInPicture: boolean
  /** Split view comes back when either of its tabs is picked again after switching away. */
  splitPairs: boolean
  /** Tab groups folded down to their name. */
  collapsedTabGroups: string[]
  spellCheck: boolean
  /** A language code, or empty to follow the system. */
  spellLanguage: string
  newTab: NewTabConfig
  /** False after "Remove VPN": the VPN's controls are hidden and Xray never starts, until "Install VPN". */
  vpnInstalled: boolean
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
  /** How the assistant writes its replies. */
  replyStyle: ReplyStyle
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
  /** Fences Terra Code's commands in (Linux, with bubblewrap): project-only writes, and optionally no network. */
  coderSandbox: 'off' | 'project' | 'offline' | 'container'
  /** Summarise the start of a long Terra Code session by itself, rather than dropping old output. */
  coderAutoCompact: boolean
  /** Run the project's checker after Terra Code edits, where it runs without asking. */
  coderAutoCheck: boolean
  /** Run the project's own formatter (Prettier, Biome, Ruff, Black, gofmt, rustfmt) on files Terra Code edits. */
  coderFormat: boolean
  /** Shows the model's reasoning in Terra Code, where the model gives it. */
  coderShowReasoning: boolean
  /** How hard Terra Code's model thinks, unless a session picks otherwise. Null: the model's own default. */
  coderEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null
  /** Which model Terra Code's helpers (explore and agents) use: the session's, or the quick model from AI settings. */
  coderAgentModel: 'session' | 'quick'
  /** The session panel beside Terra Code's conversation: context, usage, checklist, helpers and changes. */
  coderPanel: boolean
  /** Tokens (in and out) a Terra Code session may use before it stops and says so; 0 for no limit. */
  coderBudget: (typeof CODER_BUDGETS)[number]
  /** What Terra Code may do on GitHub. Off until the person connects it. */
  coderGithub: 'off' | 'read' | 'write'
  /** A system notification when Terra Code finishes or needs an answer while scTerra is in the background. */
  coderNotify: boolean
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

/** Ways the assistant can write, as Claude's styles. Each adds one line to what the model is told. */
export const REPLY_STYLES = [
  { id: 'normal', name: 'Normal', description: 'As it sees fit', prompt: '' },
  { id: 'concise', name: 'Concise', description: 'Short and to the point', prompt: 'Keep replies short: lead with the answer, skip preamble and recaps, and use a few bullets at most unless asked for more.' },
  { id: 'explanatory', name: 'Explanatory', description: 'Teaches the why', prompt: 'Explain as a patient teacher would: say why as well as what, define terms the first time they appear, and add a short example where it helps.' },
  { id: 'steps', name: 'Step by step', description: 'Numbered steps', prompt: 'Where the answer is something to do, give it as numbered steps, one action each, and say what the person should see after the steps that change something.' }
] as const

export type ReplyStyle = (typeof REPLY_STYLES)[number]['id']

/** The line a style adds to the system prompt, or nothing for Normal. */
export const replyStylePrompt = (style: ReplyStyle): string => {
  const line = REPLY_STYLES.find((entry) => entry.id === style)?.prompt
  return line ? `\n\nReply style: ${line}` : ''
}

/** Budgets a Terra Code session can be given, in tokens. */
export const CODER_BUDGETS = [0, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000] as const

/** Colours offered for the tab sidebar, as people pick them in Settings. Any other #rrggbb works too. */
export const SIDEBAR_COLORS: { id: string; name: string }[] = [
  { id: 'default', name: 'Default' },
  { id: '#c9a27a', name: 'Sand' },
  { id: '#e0828f', name: 'Rose' },
  { id: '#e3a052', name: 'Amber' },
  { id: '#6fae7f', name: 'Sage' },
  { id: '#4f9fbf', name: 'Ocean' },
  { id: '#7d86d9', name: 'Iris' },
  { id: '#7d8794', name: 'Slate' }
]

/** The sidebar's background for a colour: a wash over the theme's own, so text stays readable in both themes. */
export const sidebarBackground = (color: string): string | undefined => (color === 'default' ? undefined : `color-mix(in oklab, ${color} 18%, var(--color-bg))`)

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'google',
  searchSuggestions: true,
  suggestionSources: SUGGESTION_SOURCES.map((source) => source.id),
  addressAutofill: true,
  addressCalculator: true,
  searchKeywords: DEFAULT_SEARCH_KEYWORDS,
  theme: 'system',
  tabLayout: 'vertical',
  verticalTabsCollapsed: false,
  sidebarAutoHide: false,
  sidebarColor: 'default',
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
  cleanLinks: true,
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
  tabTree: true,
  sidebarTimer: false,
  mediaControls: true,
  autoPictureInPicture: false,
  splitPairs: true,
  collapsedTabGroups: [],
  spellCheck: true,
  spellLanguage: '',
  newTab: DEFAULT_NEW_TAB,
  vpnInstalled: true,
  vpnPingTimeout: 3000,
  vpnScope: 'browser',
  vpnMethod: 'proxy',
  vpnAutoConnect: false,
  vpnFailover: false,
  secureDns: 'default',
  aiMemory: true,
  replyStyle: 'normal',
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
  coderSandbox: 'off',
  coderAutoCompact: true,
  coderAutoCheck: true,
  coderFormat: true,
  coderNotify: true,
  coderShowReasoning: true,
  coderEffort: null,
  coderAgentModel: 'session',
  coderPanel: true,
  coderGithub: 'off',
  coderBudget: 0,
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
  sidebarAutoHide: (v) => typeof v === 'boolean',
  sidebarColor: (v) => v === 'default' || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)),
  bookmarksBar: (v) => oneOf(v, ['always', 'new-tab', 'bookmarks-page']),
  addressAutofill: (v) => typeof v === 'boolean',
  addressCalculator: (v) => typeof v === 'boolean',
  searchKeywords: isSearchKeywords,
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
  cleanLinks: (v) => typeof v === 'boolean',
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
  tabTree: (v) => typeof v === 'boolean',
  sidebarTimer: (v) => typeof v === 'boolean',
  mediaControls: (v) => typeof v === 'boolean',
  autoPictureInPicture: (v) => typeof v === 'boolean',
  splitPairs: (v) => typeof v === 'boolean',
  collapsedTabGroups: (v) => Array.isArray(v) && v.length <= 200 && v.every((name) => typeof name === 'string' && name.length <= 60),
  spellCheck: (v) => typeof v === 'boolean',
  spellLanguage: (v) => typeof v === 'string' && /^([a-zA-Z-]{2,16})?$/.test(v),
  hiddenToolbarItems: (v) => Array.isArray(v) && v.every((id) => TOOLBAR_ITEMS.some((item) => item.id === id)),
  toolbarOrder: isToolbarOrder,
  newTab: isNewTabConfig,
  vpnInstalled: (v) => typeof v === 'boolean',
  vpnPingTimeout: (v) => Number.isInteger(v) && (v as number) >= 200 && (v as number) <= 30_000,
  vpnScope: (v) => v === 'browser' || v === 'computer',
  vpnMethod: (v) => v === 'proxy' || v === 'tun',
  vpnAutoConnect: (v) => typeof v === 'boolean',
  vpnFailover: (v) => typeof v === 'boolean',
  secureDns: (v) => typeof v === 'string' && v in SECURE_DNS,
  aiMemory: (v) => typeof v === 'boolean',
  replyStyle: (v) => REPLY_STYLES.some((style) => style.id === v),
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
  coderSandbox: (v) => v === 'off' || v === 'project' || v === 'offline' || v === 'container',
  coderAutoCompact: (v) => typeof v === 'boolean',
  coderAutoCheck: (v) => typeof v === 'boolean',
  coderFormat: (v) => typeof v === 'boolean',
  coderNotify: (v) => typeof v === 'boolean',
  coderShowReasoning: (v) => typeof v === 'boolean',
  coderEffort: (v) => v === null || v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh' || v === 'max',
  coderAgentModel: (v) => v === 'session' || v === 'quick',
  coderPanel: (v) => typeof v === 'boolean',
  coderGithub: (v) => v === 'off' || v === 'read' || v === 'write',
  coderBudget: (v) => CODER_BUDGETS.includes(v as (typeof CODER_BUDGETS)[number]),
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
