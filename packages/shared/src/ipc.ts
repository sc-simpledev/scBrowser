import type { MemoryNote } from './memory'
import type { AiState, AiStatus, AssistantMessage, AssistantEvent, AssistantPrompt, AssistantRequest, ChatSummary, ModelRef, ModelRole, ProviderProtocol, SavedChat, SavedTurn, Skill } from './ai'
import type { ExtensionInfo, ExtensionPanelState, ExtensionSummary, ImportResult, ImportSource } from './containers'
import type { BarItem, Bookmark, BookmarkGroup, DownloadAction, DownloadInfo, LinkCheck, PermissionDecision, TaskList, WebApp } from './library'
import type { HistoryEntry, Suggestion } from './omnibox'
import type { CrashEntry } from './reports'
import type { SyncStatus } from './sync'
import type { BookmarkEdit, OverlayState, OverlayView, SiteAction, WorkspaceEdit } from './overlay'
import type { Settings } from './settings'
import type { SidebarSiteState } from './sidebarSites'
import type { CitationTarget } from './citations'
import type { PageWatch, WatchInterval, WatchTarget } from './watch'
import type { BriefInput, BriefIssue, BriefPrefs, BriefState, BriefSummary } from './briefs'
import type { SnoozedTab } from './snooze'
import type { StudyPrefs, StudySound, StudyState, StudySubject, StudySummary } from './study'
import type { PrivacyWeek } from './privacy'
import type { RecapSpan } from './recap'
import type { GettingStartedId, OnboardingState } from './onboarding'
import type { ArchivedTab, ClosedGroup } from './archive'
import type { CoderAnswer, CoderAutomations, CoderChange, CoderCloudRun, CoderDecision, CoderEffort, CoderProjectSetup, GithubRepo, CoderEvent, CoderGithubStatus, CoderModelChoice, CoderQuestionAnswer, CoderReview, CoderRunOptions, CoderServerCheck, CoderShellResult, CoderContextBreakdown, CoderDoctorItem, CoderMode, CoderSetup, CoderStatus, CoderTodo, CoderWorktree, McpServerConfig, CoderGitState, CoderMergeMethod, CoderPrDraft, CoderPullRequest, CoderPlugin, CoderPluginPreview, CoderStatusLineInput } from './coder'
import type { Highlight } from './highlights'
import type { ReadingItem } from './readingList'
import type { LeakCheck, PasswordEntry, PasswordState, PasswordSummary, Identity, TotpCode } from './passwords'
import type { PrintChoice, PrinterChoice } from './print'
import type { ReportFormat, ReportThemeId } from './report'
import type { ReportPreset } from './reportPresets'
import type { CardProgress, QuizProgress } from './quiz'
import type { VpnAddResult, VpnMethod, VpnPingProgress, VpnScope, VpnState, VpnSummary } from './vpn'
import type { PageRect, TabId, TabsSnapshot, TabTextMatch } from './tabs'
import type { UpdateState } from './updates'
import type { DrmStatus, SiteNotification } from './siteContent'
import type { ClearKind, ClearRange } from './clearData'

/**
 * Commands the chrome UI sends to the main process. Every channel is listed here so the
 * preload bridge, the main-process handlers and the renderer stay in sync at compile time.
 */
export interface ChromeCommands {
  'tabs:create': (url?: string) => TabId
  'tabs:close': (id: TabId) => void
  'tabs:activate': (id: TabId) => void
  'tabs:navigate': (id: TabId, input: string) => void
  'tabs:back': (id: TabId) => void
  'tabs:forward': (id: TabId) => void
  'tabs:reload': (id: TabId) => void
  'tabs:stop': (id: TabId) => void
  'tabs:snapshot': () => TabsSnapshot
  'layout:page-rect': (rect: PageRect) => void
  'history:search': (query: string) => HistoryEntry[]
  'search:suggestions': (query: string) => Promise<string[]>
  /** The address bar's calculator answer. Plain text only, never read back. */
  'omnibox:copy': (text: string) => void
  /** Cut, copy, paste and Paste and go for the address bar. */
  'omnibox:context-menu': () => void
  /** Gives the keyboard back to the address bar after a row was clicked in the overlay. */
  'omnibox:refocus': () => void
  /** Shift+Delete on a history row in the address bar. */
  'history:forget': (url: string) => void
  /** Memory the tab's process uses, in KB, or null while it sleeps. */
  'tabs:memory': (id: TabId) => Promise<number | null>
  /** A small picture of the tab's page for its hover card, if there is one. */
  'tabs:preview': (id: TabId) => Promise<string | null>
  /** The pop-ups the blocker stopped on the open page, as a menu at this point. */
  'popups:menu': (x: number, y: number) => void
  /** The home page, or a new tab page, in the open tab. */
  'tabs:home': () => void
  /** Reader view's font, size, width and colours, as a menu at this point. */
  'reader:menu': (x: number, y: number) => void
  /** Folds or unfolds the branch under a tab in the tab tree. */
  'tabs:collapse': (id: TabId) => void
  /** Opens split view with this tab on the given side of the active one. */
  'tabs:split-with': (id: TabId, side: 'left' | 'right') => void
  /** A picture of the page in view, to stand in for it while a tab is dragged over it. */
  'tabs:capture': () => Promise<string | null>
  'overlay:set': (state: OverlayState) => void
  'tabs:move': (id: TabId, index: number) => void
  'tabs:mute': (id: TabId, muted: boolean) => void
  'tabs:search': () => void
  /** An installed site's window hands its page over to the full browser. */
  'tabs:open-in-browser': () => void
  'tabs:devtools-width': (width: number) => void
  'tabs:devtools-close': () => void
  'browser:new-window': () => void
  /** Splits with the next tab, or ends split view. */
  'tabs:split-toggle': () => void
  'tabs:split-ratio': (ratio: number) => void
  'tabs:split-swap': () => void
  /** Turns on or off opening the left side's links on the right. */
  'tabs:split-link': () => void
  /** Ends split view, keeping this tab open. */
  'tabs:split-keep': (id: number) => void
  'tabs:context-menu': (id: TabId) => void
  /** The menu for several tabs picked with Ctrl or Shift. */
  'tabs:selection-menu': (ids: TabId[]) => void
  /** False if it couldn't sleep, such as the last tab left. */
  'tabs:sleep': (id: TabId) => boolean
  /** Null takes the tab out of its group. An empty name starts a new group. */
  'tabs:set-group': (id: TabId, name: string | null) => void
  'tabs:rename-group': (from: string, to: string) => void
  /** Resolves with 'rename' when that's picked, so the name can be edited where it is. */
  'tabs:group-menu': (name: string) => 'rename' | null
  'tabs:open-in-background': (url: string) => void
  'bookmarks:list': () => Bookmark[]
  'bookmarks:toggle': (url: string, title: string) => void
  'bookmarks:context-menu': (id: number) => void
  'bookmarks:groups': () => BookmarkGroup[]
  'bookmarks:arrange': (items: BarItem[]) => void
  'bookmarks:set-group': (id: number, groupId: number | null) => void
  'bookmarks:move-group': (id: number, parentId: number | null) => void
  'bookmarks:group-menu': (id: number, x: number, y: number) => void
  /** Adds the page if needed, then opens the name editor beside the star. */
  'bookmarks:edit-page': (url: string, title: string) => void
  'settings:get': () => Settings
  'settings:set': (patch: Partial<Settings>) => void
  'find:query': (text: string, options: { forward: boolean; findNext: boolean; matchCase?: boolean }) => void
  'find:stop': () => void
  'zoom:reset': () => void
  /** `compact` adds what a narrow toolbar has no room for. */
  'menu:open': (x: number, y: number, compact: boolean) => void
  'downloads:open-page': () => void
  'ai:status': () => AiStatus
  'ai:send': (streamId: string, request: AssistantRequest) => void
  'ai:cancel': (streamId: string) => void
  /** Keeps one note in the assistant's memory, from a suggestion the person accepted. */
  'memory:add': (text: string) => MemoryNote | null
  'ai:set-site': (host: string, disabled: boolean) => void
  'ai:open-settings': () => void
  'ai:enable-hosted': () => void
  'ai:open-assistant': (text: string) => void
  'ai:open-chat': (id: string) => void
  /** Follows a citation or a video time in a reply. */
  'ai:open-source': (source: { tabId: number | null; url: string }, target: CitationTarget) => void
  'ai:agent-start': (streamId: string, goal: string, tabId: number) => void
  'ai:agent-answer': (approvalId: string, allow: boolean) => void
  'tabs:organise': () => void
  'chats:list': () => ChatSummary[]
  'chats:get': (id: string) => SavedChat | null
  'chats:save': (id: string, turns: SavedTurn[]) => void
  'chats:delete': (id: string) => void
  'report:save': (name: string, format: ReportFormat, content: string) => Promise<boolean>
  'privacy:toggle-site': (host: string) => void
  'reader:toggle': () => void
  'vpn:summary': () => VpnSummary
  /** Turns the VPN on for AI that couldn't get through: the person's own connection, or the starting one when they have none. */
  'vpn:use-default': () => VpnSummary
  'passwords:summary': () => PasswordState
  'flags:get': () => string[]
  'passwords:menu': (x: number, y: number) => void
  /** The native page view steps aside while a sidebar is dragged, so it can't swallow the pointer. */
  'layout:resizing': (resizing: boolean) => void
  'extensions:summary': () => ExtensionSummary
  'extensions:menu': (x: number, y: number) => void
  /** Where the toolbar's Extensions button is, for hanging panels from. */
  'extensions:anchor': (rect: PageRect) => void
  /** What pressing an extension's toolbar button does, in the panel way of working. */
  'extensions:open': (id: string) => void
  'extensions:panel-state': () => ExtensionPanelState | null
  'extensions:panel-rect': (rect: PageRect) => void
  'extensions:panel-toggle': (id: string) => void
  'extensions:panel-close': () => void
  'browser:is-private': () => boolean
  'vpn:menu': (x: number, y: number) => void
  'tabs:cleanup': () => void
  'workspaces:switch': (id: string) => void
  /** Opens the small form for a workspace, or for a new one when `id` is null. */
  'workspaces:edit': (id: string | null, x: number, y: number) => void
  /** The open site's controls, under the padlock in the address bar. */
  'site:controls': (x: number, y: number) => void
  /** Changes how a tab's site looks from a plain request, with CSS the AI writes. Returns what to say. */
  'site:tweak': (tabId: number, request: string) => string
  'updates:state': () => UpdateState
  'updates:install': () => void
  'updates:seen': () => void
  'briefs:summary': () => BriefSummary
  /** Opens the newest unread brief, or the briefs page. */
  'briefs:open': () => void
  'briefs:dismiss': () => void
  'study:summary': () => StudySummary
  /** Opens sc://focus. */
  'study:open': () => void
  /** Stops the running timer, or starts the last subject again. */
  'study:toggle': () => void
  /** The sidebar timer's menu: pick an activity, the mode, or open the page. */
  'study:menu': (x: number, y: number) => void
  'bookmarks:overflow-menu': (items: BarItem[], x: number, y: number) => void
  'profiles:menu': (x: number, y: number) => void
  /** Opens a sidebar site, or closes it if it's the one showing. */
  'sidebar-sites:toggle': (url: string) => void
  'sidebar-sites:rect': (rect: PageRect) => void
  'sidebar-sites:state': () => SidebarSiteState | null
  'sidebar-sites:action': (action: 'back' | 'reload' | 'open-tab' | 'close') => void
  /** Adds the page in the active tab to the rail. */
  'sidebar-sites:add-current': () => void
  'sidebar-sites:menu': (url: string, x: number, y: number) => void
  /** Saves the side assistant's conversation as Markdown, asking where. True once saved. */
  'chats:export': (turns: SavedTurn[]) => boolean
  /** Sums up a chat's messages so it can carry on with less, for /compact. */
  'ai:compact': (messages: AssistantMessage[]) => string
  /** Writes an answer as a Markdown note in the notes folder (or where the person picks). The file's path, or null if they cancelled. */
  'notes:save': (markdown: string, title: string) => string | null
  /** How the assistant writes replies, as a menu at this point. */
  'ai:style-menu': (x: number, y: number) => void
  /** Whether speech to text is set up, and whose service hears it. */
  'ai:voice': () => { available: boolean; service: string | null }
  /** A recording from the microphone button, as WAV in base64, turned into text. */
  'ai:transcribe': (wavBase64: string) => string
  /** Now playing: play or pause, picture in picture, or go to the tab. */
  'media:action': (tabId: TabId, action: 'toggle' | 'pip' | 'focus') => void
  /** Now playing's menu: speed, mute and the rest. */
  'media:menu': (tabId: TabId, x: number, y: number) => void
}

/** Events the main process pushes to the chrome UI. */
export interface ChromeEvents {
  'tabs:changed': TabsSnapshot
  'ui:focus-omnibox': void
  /** Something from the menu for several tabs was done, so the pick is cleared. */
  'tabs:selection-done': void
  /** The user clicked a row in the omnibox dropdown (index into the current list). */
  'omnibox:pick': number
  'bookmarks:changed': Bookmark[]
  'bookmark-groups:changed': BookmarkGroup[]
  'settings:changed': Settings
  /** Opens the find bar, with words to find in that tab when they're given. */
  'ui:open-find': { text: string; tabId: TabId } | null
  'find:result': { active: number; total: number }
  'downloads:progress': { active: number; fraction: number | null }
  'ai:changed': AiStatus
  'ai:event': AssistantEvent
  'ui:assistant-toggle': void
  'ui:assistant-prompt': AssistantPrompt
  'privacy:changed': string[]
  'vpn:changed': VpnSummary
  'extensions:changed': ExtensionSummary
  'extensions:panel': ExtensionPanelState | null
  /** Do what clicking this extension's toolbar button would. */
  'extensions:activate': string
  'passwords:changed': PasswordState
  'sidebar-sites:changed': SidebarSiteState | null
  /** The colour the active page asks for. Only sent with the Site colours flag on. */
  'ui:site-colour': string | null
  'updates:changed': UpdateState
  'briefs:changed': BriefSummary
  'study:changed': StudySummary
  /** The focus timer's end-of-round sound, played by the window in front. */
  'study:sound': { sound: StudySound; volume: number }
  /** A button on the address bar's answer card. */
  'omnibox:answer-action': 'close' | 'continue' | 'stop'
  'overlay:clear-tooltip': void
}

/** Commands the overlay view sends to the main process. */
export interface OverlayCommands {
  'overlay:pick': (index: number) => void
  'overlay:permission': (requestId: number, allow: boolean) => void
  'overlay:palette-run': (id: string) => void
  'overlay:palette-close': () => void
  'overlay:app-link-answer': (choice: 'open' | 'always' | 'cancel') => void
  'overlay:extensions-action': (action: 'open' | 'pin' | 'menu' | 'store' | 'manage', id: string, x: number, y: number) => void
  'overlay:extensions-close': () => void
  /** `find` opens the tab's find bar with these words, for a match inside the page. */
  'overlay:tab-search-pick': (id: TabId, find?: string) => void
  /** Tabs whose pages hold these words, read on this computer. */
  'overlay:tab-search-text': (query: string) => TabTextMatch[]
  'overlay:tab-search-remove': (id: TabId) => void
  'overlay:tab-search-close': () => void
  /** Returns what's wrong, or null once saved. */
  'overlay:bookmark-save': (edit: BookmarkEdit) => string | null
  'overlay:bookmark-remove': (id: number) => void
  'overlay:bookmark-close': () => void
  'overlay:answer-action': (action: ChromeEvents['omnibox:answer-action']) => void
  'overlay:answer-link': (href: string) => void
  /** Null cancels. The password goes straight to the network stack and is never kept. */
  'overlay:password-answer': (choice: 'save' | 'never' | 'dismiss') => void
  /** A saved login's id, or one of the list's other rows. */
  'overlay:password-suggest': (choice: string) => void
  'overlay:auth': (requestId: number, login: { username: string; password: string } | null) => void
  'overlay:cleanup': (ids: TabId[] | null) => void
  'overlay:workspace-save': (edit: WorkspaceEdit) => void
  'overlay:workspace-remove': (id: string) => void
  'overlay:workspace-close': () => void
  'overlay:site-action': (action: SiteAction) => void
  'overlay:site-close': () => void
  'overlay:tooltip-clear': () => void
  /** The buttons on a link preview, or a click on the page behind it. */
  'overlay:preview-action': (action: 'open' | 'background' | 'split' | 'close' | 'summarise') => void
}

/** Events the main process pushes to the overlay view. */
export interface OverlayEvents {
  /** `origin` is the overlay's top-left in window coordinates. */
  'overlay:state': { state: OverlayView; origin: { x: number; y: number } }
}

export type CommandChannel = keyof ChromeCommands
export type EventChannel = keyof ChromeEvents

export const COMMAND_CHANNELS = [
  'tabs:create',
  'tabs:close',
  'tabs:activate',
  'tabs:navigate',
  'tabs:back',
  'tabs:forward',
  'tabs:reload',
  'tabs:stop',
  'tabs:snapshot',
  'layout:page-rect',
  'history:search',
  'search:suggestions',
  'omnibox:copy',
  'omnibox:context-menu',
  'omnibox:refocus',
  'history:forget',
  'tabs:memory',
  'tabs:preview',
  'popups:menu',
  'tabs:home',
  'reader:menu',
  'tabs:collapse',
  'tabs:split-with',
  'tabs:capture',
  'overlay:set',
  'tabs:move',
  'tabs:mute',
  'tabs:search',
  'tabs:open-in-browser',
  'tabs:devtools-width',
  'tabs:devtools-close',
  'browser:new-window',
  'tabs:split-toggle',
  'tabs:split-ratio',
  'tabs:split-swap',
  'tabs:split-link',
  'tabs:split-keep',
  'tabs:context-menu',
  'tabs:selection-menu',
  'tabs:sleep',
  'tabs:set-group',
  'tabs:rename-group',
  'tabs:group-menu',
  'tabs:open-in-background',
  'bookmarks:list',
  'bookmarks:toggle',
  'bookmarks:context-menu',
  'bookmarks:groups',
  'bookmarks:arrange',
  'bookmarks:set-group',
  'bookmarks:move-group',
  'bookmarks:group-menu',
  'bookmarks:edit-page',
  'settings:get',
  'settings:set',
  'find:query',
  'find:stop',
  'zoom:reset',
  'menu:open',
  'downloads:open-page',
  'ai:status',
  'ai:send',
  'ai:cancel',
  'memory:add',
  'ai:set-site',
  'ai:open-settings',
  'ai:enable-hosted',
  'ai:open-assistant',
  'ai:open-chat',
  'ai:agent-start',
  'ai:agent-answer',
  'tabs:organise',
  'chats:list',
  'chats:get',
  'chats:save',
  'chats:delete',
  'report:save',
  'privacy:toggle-site',
  'reader:toggle',
  'vpn:summary',
  'vpn:use-default',
  'passwords:summary',
  'flags:get',
  'passwords:menu',
  'layout:resizing',
  'extensions:summary',
  'extensions:menu',
  'extensions:anchor',
  'extensions:open',
  'extensions:panel-state',
  'extensions:panel-rect',
  'extensions:panel-toggle',
  'extensions:panel-close',
  'browser:is-private',
  'vpn:menu',
  'tabs:cleanup',
  'workspaces:switch',
  'workspaces:edit',
  'site:controls',
  'site:tweak',
  'updates:state',
  'updates:install',
  'updates:seen',
  'briefs:summary',
  'briefs:open',
  'briefs:dismiss',
  'study:summary',
  'study:open',
  'study:toggle',
  'study:menu',
  'bookmarks:overflow-menu',
  'profiles:menu',
  'sidebar-sites:toggle',
  'ai:open-source',
  'sidebar-sites:rect',
  'sidebar-sites:state',
  'sidebar-sites:action',
  'sidebar-sites:add-current',
  'sidebar-sites:menu',
  'chats:export',
  'ai:compact',
  'notes:save',
  'ai:style-menu',
  'ai:voice',
  'ai:transcribe',
  'media:action',
  'media:menu'
] as const satisfies readonly CommandChannel[]

export const EVENT_CHANNELS = [
  'tabs:changed',
  'ui:focus-omnibox',
  'tabs:selection-done',
  'sidebar-sites:changed',
  'omnibox:pick',
  'bookmarks:changed',
  'bookmark-groups:changed',
  'settings:changed',
  'ui:open-find',
  'find:result',
  'downloads:progress',
  'ai:changed',
  'ai:event',
  'ui:assistant-toggle',
  'ui:assistant-prompt',
  'privacy:changed',
  'vpn:changed',
  'extensions:changed',
  'extensions:panel',
  'extensions:activate',
  'passwords:changed',
  'ui:site-colour',
  'updates:changed',
  'briefs:changed',
  'study:changed',
  'study:sound',
  'omnibox:answer-action',
  'overlay:clear-tooltip'
] as const satisfies readonly EventChannel[]

export const OVERLAY_COMMAND_CHANNELS = ['overlay:pick', 'overlay:permission', 'overlay:palette-run', 'overlay:palette-close', 'overlay:app-link-answer', 'overlay:extensions-action', 'overlay:extensions-close', 'overlay:tab-search-pick', 'overlay:tab-search-text', 'overlay:tab-search-remove', 'overlay:tab-search-close', 'overlay:bookmark-save', 'overlay:bookmark-remove', 'overlay:bookmark-close', 'overlay:answer-action', 'overlay:answer-link', 'overlay:password-answer', 'overlay:password-suggest', 'overlay:auth', 'overlay:cleanup', 'overlay:workspace-save', 'overlay:workspace-remove', 'overlay:workspace-close', 'overlay:site-action', 'overlay:site-close', 'overlay:tooltip-clear', 'overlay:preview-action'] as const satisfies readonly (keyof OverlayCommands)[]
export const OVERLAY_EVENT_CHANNELS = ['overlay:state'] as const satisfies readonly (keyof OverlayEvents)[]

/** A typed `invoke`/`on` pair over a set of command and event channels. */
export interface Bridge<Commands extends { [K in keyof Commands]: (...args: never[]) => unknown }, Events> {
  invoke<C extends keyof Commands & string>(
    channel: C,
    ...args: Parameters<Commands[C]>
  ): Promise<Awaited<ReturnType<Commands[C]>>>
  on<E extends keyof Events & string>(channel: E, listener: (payload: Events[E]) => void): () => void
  platform: 'linux' | 'win32' | 'darwin'
}

/** Commands available to `sc://` pages, checked against the calling frame in the main process. */
export interface InternalCommands {
  'settings:get': () => Settings
  'settings:set': (patch: Partial<Settings>) => void
  'settings:pick-download-dir': () => string | null
  /** Saves the settings to a file the person picks. False if they cancel. */
  'settings:export': () => boolean
  /** Reads settings from a file the person picks, and applies them. Returns how many, or null if they cancel. */
  'settings:import': () => number | null
  'history:list': (query: string, limit: number, offset: number) => HistoryEntry[]
  'history:delete': (url: string) => void
  'history:clear': () => void
  /** Clear browsing data: how far back, and which kinds. */
  'data:clear': (range: ClearRange, kinds: ClearKind[]) => void
  /** Settings is waiting for a key to give a shortcut, so the browser mustn't act on it meanwhile. */
  'shortcuts:recording': (on: boolean) => void
  /** The web addresses open in this window's tabs, to use as startup pages. */
  'startup:open-tabs': () => string[]
  /** Starts dragging a finished download's file, to drop into another app. */
  'downloads:drag': (id: string) => void
  'bookmarks:list': () => Bookmark[]
  'bookmarks:rename': (id: number, title: string) => void
  'bookmarks:remove': (id: number) => void
  /** Asks each address whether it still answers, for the tidy-up. */
  'bookmarks:check-links': (urls: string[]) => LinkCheck[]
  /** Saves every bookmark and folder as a bookmarks file (HTML, as every browser reads). False if cancelled. */
  'bookmarks:export-html': () => boolean
  /** Reads a bookmarks file another browser saved. How many were new, or null if cancelled. */
  'bookmarks:import-html': () => number | null
  'bookmarks:edit': (id: number, title: string, url: string) => void
  'bookmarks:set-group': (id: number, groupId: number | null) => void
  'bookmarks:groups': () => BookmarkGroup[]
  'bookmarks:add-group': (name: string, parentId: number | null) => number
  'bookmarks:move-group': (id: number, parentId: number | null) => void
  'bookmarks:rename-group': (id: number, name: string) => void
  'bookmarks:remove-group': (id: number) => void
  'downloads:list': () => DownloadInfo[]
  'downloads:action': (id: string, action: DownloadAction) => void
  'downloads:clear': () => void
  /** Asks the AI for a clearer name, from the file's name and address only. Only when the person presses for it. */
  'downloads:suggest-name': (id: string) => string
  'downloads:rename': (id: string, name: string) => string
  /** Languages that have a dictionary. Empty on a Mac, which uses the system's own. */
  'spelling:languages': () => string[]
  'tasks:list': () => TaskList
  'tasks:end': (pid: number) => void
  'apps:list': () => WebApp[]
  'apps:open': (url: string) => void
  'apps:remove': (id: string) => void
  'permissions:list': () => PermissionDecision[]
  'permissions:revoke': (origin: string, permission: string) => void
  'browser:is-default': () => boolean
  'browser:set-default': () => void
  'browser:open': (url: string) => void
  'browser:version': () => { app: string; chromium: string; electron: string }
  /** Widevine, for protected video and music. */
  'drm:status': () => DrmStatus
  /** Notifications sites sent lately, newest first. */
  'notifications:list': () => SiteNotification[]
  /** The screenshot waiting to be marked up on sc://markup, as a PNG data address. */
  'markup:image': () => { dataUrl: string; title: string } | null
  /** Copies the marked-up picture. False if the clipboard was busy. */
  'markup:copy': (pngDataUrl: string) => boolean
  /** Saves it as a PNG in the downloads folder. Its path. */
  'markup:save': (pngDataUrl: string, title: string) => string | null
  'ai:state': () => AiState
  'ai:save-provider': (input: {
    id: string | null
    name: string
    protocol: ProviderProtocol
    baseUrl: string
    models: string[]
    apiKey?: string
    headers?: string
  }) => string
  'ai:remove-provider': (id: string) => void
  'ai:models': (id: string) => { models: string[]; error: string | null }
  'ai:set-role': (role: ModelRole, ref: ModelRef) => void
  'ai:set-site': (host: string, disabled: boolean) => void
  'chats:clear': () => void
  'chats:list': () => ChatSummary[]
  'chats:get': (id: string) => SavedChat | null
  'chats:save': (id: string, turns: SavedTurn[]) => void
  'chats:delete': (id: string) => void
  /** The design picked for each report in a chat, by title. */
  'chats:designs': (id: string) => Record<string, ReportThemeId>
  'chats:set-design': (id: string, title: string, theme: ReportThemeId) => void
  /** How well each quiz question is known, by its key, for spaced repetition. */
  'quiz:progress': (keys: string[]) => QuizProgress
  'quiz:record': (key: string, knew: boolean) => CardProgress
  /** Report kinds the person saved from reports they liked. */
  'presets:list': () => ReportPreset[]
  'presets:save': (preset: ReportPreset) => ReportPreset[]
  'presets:delete': (id: string) => ReportPreset[]
  /** A question about a report, answered beside it without making a new draft. */
  'ai:ask-report': (report: string, question: string) => string
  /** What to say for each slide of a report being presented, written by the person's AI. */
  'report:notes': (report: string) => string[]
  'ai:status': () => AiStatus
  'ai:send': (streamId: string, request: AssistantRequest) => void
  /** Answers a tool the reply wants to use, such as one from an MCP server. */
  'ai:agent-answer': (approvalId: string, allow: boolean) => void
  'ai:cancel': (streamId: string) => void
  /** Collects a question sent over from the address bar. */
  'ai:take-prompt': () => string | null
  'ai:open-source': (source: { tabId: number | null; url: string }, target: CitationTarget) => void
  /** Web pages open in this window, for picking which to research. */
  'tabs:research-list': () => { id: number; title: string; url: string; isSleeping: boolean }[]
  'extensions:list': () => ExtensionInfo[]
  'extensions:add': () => string | null
  'extensions:remove': (id: string) => void
  'extensions:set-enabled': (id: string, enabled: boolean) => void
  'autofill:list': () => Identity[]
  'autofill:save': (identity: Identity) => string
  'autofill:remove': (id: string) => void
  'history:ask': (query: string) => HistoryEntry[] | null
  'ai:enable-hosted': () => void
  'ai:save-skills': (skills: Skill[]) => void
  'profiles:list': () => { current: string; names: string[] }
  'profiles:open': (name: string) => void
  'import:sources': () => ImportSource[]
  'import:run': (id: string) => ImportResult
  'flags:get': () => string[]
  'flags:set': (id: string, enabled: boolean) => void
  'browser:restart': () => void
  'browser:is-private': () => boolean
  'privacy:off-hosts': () => string[]
  'privacy:toggle-site': (host: string) => void
  'privacy:allow-http': (url: string) => void
  /** Returns the new picture's version, or null if nothing was chosen. */
  'newtab:pick-background': () => number | null
  'newtab:background': () => { bytes: Uint8Array; type: string } | null
  'newtab:top-sites': (limit: number) => HistoryEntry[]
  /** Opens an address or search in the new tab itself. */
  'newtab:go': (input: string) => void
  /** Rows for the new tab search box: the address bar's, with open tabs and Ask rows. */
  'newtab:suggest': (query: string) => Suggestion[]
  /** A Switch to tab row picked in the new tab search box. */
  'newtab:switch-tab': (tabId: TabId) => void
  /** An Ask row picked in the new tab search box: the question goes to the side assistant. */
  'newtab:ask': (text: string) => void
  /** Saves a conversation as Markdown, asking where. True once saved. */
  'chats:export': (turns: SavedTurn[]) => boolean
  /** Sums up a chat's messages so it can carry on with less, for /compact. */
  'ai:compact': (messages: AssistantMessage[]) => string
  /** Writes an answer as a Markdown note in the notes folder (or where the person picks). The file's path, or null if they cancelled. */
  'notes:save': (markdown: string, title: string) => string | null
  'extensions:open-store': () => void
  'sync:status': () => SyncStatus
  'sync:pick-folder': () => string | null
  'sync:enable': (folder: string, passphrase: string) => SyncStatus
  'sync:disable': () => void
  'sync:run': () => SyncStatus
  'reports:list': () => CrashEntry[]
  'reports:clear': () => void
  /** The message for the block page in this tab. */
  'blocker:message': () => string
  'blocker:proceed': (url: string) => void
  /** Starts the wait for one more minute on a blocked site. Returns the seconds to wait. */
  'blocker:grace-wait': (url: string) => number
  /** Lets the blocked site through for a minute, once the wait is over. */
  'blocker:grace': (url: string) => void
  'blocker:leave': () => void
  /** The PDF in this tab, or null if it can't be fetched. */
  'pdf:load': () => Uint8Array | null
  'pdf:save': () => void
  /** With no choice, the system's own print dialog. Says why if it couldn't print. */
  'pdf:print': (choice?: PrintChoice, pageCount?: number) => string | null
  'pdf:printers': () => PrinterChoice[]
  /** Reopens this PDF in Chromium's own viewer. */
  'pdf:basic': () => void
  'passwords:state': () => PasswordState
  /** An empty master password means sealed by the computer's keychain alone. */
  'passwords:create': (master: string) => void
  'passwords:set-master': (next: string) => void
  'passwords:remove-master': (current: string) => boolean
  'passwords:unlock': (master: string) => boolean
  'passwords:lock': () => void
  'passwords:change-master': (current: string, next: string) => boolean
  'passwords:reset': () => void
  'passwords:list': () => PasswordSummary[]
  'passwords:reveal': (id: string) => string
  'passwords:save': (entry: PasswordEntry) => string
  'passwords:remove': (id: string) => void
  'passwords:copy': (id: string) => void
  /** The current two-step code. The saved key never leaves the main process. */
  'passwords:totp': (id: string) => TotpCode
  'passwords:copy-totp': (id: string) => void
  /** Sends only the first 5 characters of each password's SHA-1 to Have I Been Pwned. */
  'passwords:check-leaks': () => LeakCheck
  'passwords:leak-status': () => LeakCheck
  /** Null if the person cancelled the file picker. */
  'passwords:import': () => number | null
  'passwords:export': () => boolean
  'vpn:state': () => VpnState
  'vpn:use-default': () => VpnSummary
  'vpn:add': (text: string, groupId: string | null) => VpnAddResult
  'vpn:subscribe': (url: string, name: string) => VpnAddResult
  'vpn:refresh': (groupId: string) => VpnAddResult
  'vpn:add-group': (name: string) => string
  'vpn:rename-group': (id: string, name: string) => void
  'vpn:remove-group': (id: string) => void
  'vpn:move': (id: string, groupId: string | null) => void
  'vpn:remove': (id: string) => void
  'vpn:select': (id: string) => void
  'vpn:set-enabled': (enabled: boolean) => void
  /** Reconnects if the VPN is on, so the new choice applies straight away. */
  'vpn:set-route': (scope: VpnScope, method: VpnMethod) => void
  /** Starts checking connections. Follow it with `vpn:ping-progress`. */
  'vpn:ping': (ids: string[]) => void
  'vpn:ping-stop': () => void
  'vpn:ping-progress': () => VpnPingProgress
  /** "Remove VPN": turns it off, stops Xray, hides its controls, and forgets the connections if asked. */
  'vpn:uninstall': (forget: boolean) => void
  /** "Install VPN": brings the VPN's controls back. */
  'vpn:install': () => void
  /** Asks where to save, and returns false if the person cancelled. */
  /** `content` is HTML for PDF and HTML, and Markdown for Markdown. */
  'report:save': (name: string, format: ReportFormat, content: string) => Promise<boolean>
  /** Serves a file the assistant wrote to a sandboxed preview frame, and returns its address. */
  'files:preview': (name: string, content: string) => string
  /** Asks where to save, and returns false if the person cancelled. */
  'files:save': (name: string, content: string) => Promise<boolean>
  'updates:state': () => UpdateState
  'updates:check': () => UpdateState
  'updates:install': () => void
  'updates:seen': () => void
  /** The release before this one, if there is one to go back to. */
  'updates:previous': () => string | null
  'updates:rollback': (version: string) => UpdateState
  /** Watched pages, without the text kept to compare against. */
  'watch:list': () => Omit<PageWatch, 'lastText'>[]
  'watch:check': (id: string) => void
  'watch:remove': (id: string) => void
  'watch:set-interval': (id: string, everyMinutes: WatchInterval) => void
  /** Only announce when the watched number passes this. Null goes back to every change. */
  'watch:set-target': (id: string, target: WatchTarget | null) => void
  /** Null marks them all as seen. */
  'watch:seen': (id: string | null) => void
  'archive:list': () => ArchivedTab[]
  /** Opens it as a tab again, and takes it out of the archive. */
  'archive:restore': (id: string) => void
  'archive:remove': (id: string) => void
  'archive:clear': () => void
  'groups:closed': () => ClosedGroup[]
  /** Named sets of tabs the person saved to come back to. */
  'tabsets:list': () => ClosedGroup[]
  'tabsets:save': (name: string) => ClosedGroup | null
  'tabsets:open': (id: string) => void
  'tabsets:remove': (id: string) => void
  /** The workspaces, by name, for choosing where a routine opens. */
  'workspaces:list': () => { id: string; name: string }[]
  'memory:list': () => MemoryNote[]
  'memory:add': (text: string) => MemoryNote | null
  'memory:update': (id: string, text: string) => void
  'memory:remove': (id: string) => void
  /** Opens the group's tabs again in the window it's asked from, and takes it off the list. */
  'groups:reopen': (id: string) => void
  'groups:forget': (id: string) => void
  /** Terra Code, agentic coding (beta). Only sc://assistant may call these. */
  'coder:status': () => CoderStatus
  'coder:pick-folder': () => string | null
  'coder:open-folder': () => void
  'coder:run': (sessionId: string, task: string, options?: CoderRunOptions) => void
  /** Stops one running command, leaving the session working. */
  'coder:stop-tool': (sessionId: string, toolId: string) => void
  /** Puts the conversation and files back to just before a message. Returns that message. */
  'coder:rewind': (sessionId: string, turnId: string, what?: 'both' | 'code' | 'conversation') => { task: string; files: number }
  /** Undoes one step that changed files, or redoes it. Returns whether it's now undone. */
  'coder:undo-step': (sessionId: string, toolId: string, redo: boolean) => { undone: boolean; files: number }
  /** Sessions working, and sessions waiting for an answer, for the session list. */
  'coder:activity': () => { running: string[]; waiting: string[] }
  /** Pins or archives a chat in the list. */
  'chats:flag': (id: string, flags: { pinned?: boolean; archived?: boolean }) => void
  /** Signs in to a remote MCP server that asks for it, in a tab. */
  'coder:mcp-signin': (name: string) => void
  'coder:mcp-signout': (name: string) => void
  /** Summarises the session so far, as /compact asks. False if there was too little to summarise. */
  'coder:compact': (sessionId: string) => boolean
  /** A copy of the session to carry on in, saved as a chat of its own. Returns its id. */
  'coder:fork': (sessionId: string) => string | null
  /** Saves a session as Markdown where the person picks. */
  'coder:export': (title: string, markdown: string) => boolean
  'coder:models': () => CoderModelChoice[]
  /** Permissions, MCP servers, agents, skills, commands and hooks for the open folder. */
  'coder:setup': () => CoderSetup
  'coder:set-rules': (rules: { allow: string[]; deny: string[] }) => void
  /** Adds a note to the project's TERRA.md. Returns the file. */
  'coder:remember': (note: string) => string
  /** Files in the project matching what's typed after @. */
  'coder:files': (query: string) => string[]
  /** Open tabs to pick with @. */
  'coder:tabs': () => { id: number; title: string; url: string }[]
  'coder:job-stop': (sessionId: string, jobId: number) => void
  /** Sessions working right now, even in the background. */
  'coder:running': () => string[]
  /** What a session's latest run did, for showing one that worked while another chat was on screen. */
  'coder:replay': (sessionId: string) => { turnId: string | null; task: string; events: CoderEvent[]; running: boolean } | null
  /** Adds or changes one of the person's own MCP servers. Empty secret values keep what was saved. */
  'coder:mcp-save': (server: McpServerConfig) => void
  'coder:mcp-remove': (name: string) => void
  /** Lets a project's own MCP server run, or stops trusting it. */
  'coder:mcp-trust': (name: string, trusted: boolean) => void
  'coder:mcp-restart': (name: string) => void
  /** Lets this project's hooks run, or stops them. */
  'coder:hooks-trust': (trusted: boolean) => void
  /** A separate git worktree for this session, on a branch of its own. */
  'coder:worktree': (sessionId: string) => CoderWorktree
  'coder:worktree-info': (sessionId: string) => CoderWorktree | null
  /** Merges the worktree's branch into the branch it came from. Returns what git said. */
  'coder:worktree-merge': (sessionId: string) => string
  'coder:worktree-remove': (sessionId: string) => void
  /** A commit message for the session's changes, written by the quick model. */
  'coder:commit-message': (sessionId: string) => string
  /** Commits the session's changes (or everything, with `all`), on a new branch if one is named. */
  'coder:commit': (sessionId: string, message: string, branch: string | null, all: boolean, force?: boolean) => string
  /** Where the session's git stands: branch, ahead and behind, conflicts, and its pull request when `withPr`. Null outside git. */
  'coder:git-state': (sessionId: string, withPr: boolean) => CoderGitState | null
  /** Pushes the branch to origin (tracking it the first time). `force` only skips the secret scan, never git's own checks. */
  'coder:git-push': (sessionId: string, force?: boolean) => string
  'coder:git-pull': (sessionId: string) => string
  'coder:git-switch': (sessionId: string, branch: string, create: boolean) => string
  /** Merges another branch into the one checked out, here. */
  'coder:git-merge': (sessionId: string, branch: string) => string
  /** Gives up a merge or rebase that stopped on conflicts. */
  'coder:git-abort': (sessionId: string) => string
  /** A title and description for a pull request, written by the quick model from the commits. */
  'coder:pr-draft': (sessionId: string, base: string) => CoderPrDraft
  'coder:pr-create': (sessionId: string, input: { title: string; body: string; base: string; draft: boolean }) => CoderPullRequest
  'coder:pr-merge': (sessionId: string, number: number, method: CoderMergeMethod, removeBranch: boolean) => string
  /** Folders besides the project Terra Code may read and edit there (/add-dir). */
  'coder:dirs': () => string[]
  /** Adds a folder (null: ask with a dialog). Returns the list, or null if the dialog was cancelled. */
  'coder:add-dir': (path: string | null) => string[] | null
  'coder:remove-dir': (path: string) => string[]
  'coder:plugins': () => CoderPlugin[]
  /** Fetches a plugin or marketplace from a Git address or folder and lists what it holds. Adds nothing. */
  'coder:plugin-preview': (source: string) => CoderPluginPreview
  'coder:plugin-install': (previewId: string, name: string) => CoderPlugin[]
  'coder:plugin-toggle': (name: string, enabled: boolean) => CoderPlugin[]
  'coder:plugin-remove': (name: string) => CoderPlugin[]
  /** Runs the person's own status line command with the session as JSON; its first line, or null. */
  'coder:status-line': (sessionId: string, input: CoderStatusLineInput) => string | null
  /** A task handed over from the command line (`scterra code …`), taken once. */
  'coder:pending': () => { task: string } | null
  /** A message for a run already under way, read at its next step. False if nothing is running. */
  'coder:steer': (sessionId: string, text: string) => boolean
  /** Keeps what the chat shows. The folder is recorded by the main process, not taken from the page. */
  'coder:save': (sessionId: string, title: string, data: string) => void
  /** Goes back to a saved chat and its folder. `data` is what was given to coder:save. */
  'coder:open': (sessionId: string) => { data: string; folder: string } | null
  'coder:answer': (approvalId: string, answer: CoderAnswer) => void
  /** The person's answers to the model's questions, one list per question; null when they closed them. */
  'coder:answer-question': (questionId: string, answers: CoderQuestionAnswer[] | null) => void
  /** The person ticked, added, changed or removed checklist steps. The model hears at its next step. */
  'coder:todo': (sessionId: string, items: CoderTodo[]) => void
  /** Terra Code's GitHub sign-in: where it comes from and whose it is, never the token. */
  'coder:github-status': () => CoderGithubStatus
  /** Uses the GitHub CLI's own sign-in, read each time it's needed. */
  'coder:github-use-cli': () => CoderGithubStatus
  /** Keeps a token pasted in, encrypted, after checking it with GitHub. */
  'coder:github-save-token': (token: string) => CoderGithubStatus
  'coder:github-disconnect': () => CoderGithubStatus
  /** GitHub's device sign-in: the code to type on github.com, which opens in a tab. */
  'coder:github-device-start': () => { code: string; url: string }
  /** Waits for the person to approve the code, then keeps the token. */
  'coder:github-device-wait': () => CoderGithubStatus
  /** Repositories the signed-in account can reach, newest first, matching the words given. */
  'coder:github-repos': (query: string) => GithubRepo[]
  /** Clones a repository into a folder the person picks, and makes it Terra Code's folder. Null if they cancelled. */
  'coder:clone': (fullName: string) => string | null
  /** Links the open folder to one of the person's repositories as origin (starting git if needed). Pushes nothing. */
  'coder:github-link': (fullName: string) => CoderGithubStatus
  /** Makes a new repository on the person's account, links the folder to it and pushes the current branch if it has commits. */
  'coder:github-create': (name: string, makePrivate: boolean) => { status: CoderGithubStatus; pushed: string | null; pushError: string | null }
  /** The open folder's first-run suggestions, or null without a folder. */
  'coder:project-setup': () => CoderProjectSetup | null
  /** Starts a task on GitHub Actions, from GitHub's copy of the current branch. */
  'coder:cloud-start': (sessionId: string, task: string, options: { pr: boolean; model?: { providerId: string; model: string } | null; effort?: CoderEffort | null; where?: 'github' | 'server' }) => CoderCloudRun
  /** Whether the server in Terra Code's settings (or this one) can be reached over SSH, with git and Node there. */
  'coder:server-check': (host: string) => CoderServerCheck
  /** A command the person typed after `!`, run in the project folder; the model hears about it with the next message. */
  'coder:shell': (sessionId: string, command: string) => CoderShellResult
  /** What fills the model's memory in this session, for /context. */
  'coder:context': (sessionId: string, mode: CoderMode) => CoderContextBreakdown
  /** Terra Code's setup, checked, for /doctor. */
  'coder:doctor': () => CoderDoctorItem[]
  /** Opens a project file in the person's editor (VS Code when it's installed), at a line if given. */
  'coder:open-file': (sessionId: string, path: string, line: number | null) => void
  /** This session's cloud runs, checked with GitHub when `check` is set. */
  'coder:cloud-runs': (sessionId: string, check: boolean) => CoderCloudRun[]
  'coder:cloud-cancel': (sessionId: string, runId: string) => CoderCloudRun[]
  /** Fetches a finished run's branch into the project, without switching to it. */
  'coder:cloud-fetch': (sessionId: string, runId: string) => string
  /** Opens a pull request for a finished run, or returns the one it opened. */
  'coder:cloud-pr': (sessionId: string, runId: string) => string
  /** What a finished run did, step by step, read back from its log on GitHub. */
  'coder:cloud-events': (sessionId: string, runId: string) => CoderEvent[]
  /** Terra Code on GitHub for the open project: what was last installed there, and its pull request. */
  'coder:automations': () => { repo: string | null; saved: CoderAutomations | null; prUrl: string | null }
  /** Installs or changes the workflow for comments and scheduled tasks, through a pull request. Returns its address. */
  'coder:automations-install': (automations: CoderAutomations) => string
  /** Tells a session's model something at its next message, such as what a cloud run did. */
  'coder:note': (sessionId: string, text: string) => void
  'coder:stop': (sessionId: string) => void
  'coder:reset': (sessionId: string) => void
  /** Files the session changed, against how they were before it. */
  'coder:changes': (sessionId: string) => CoderChange[]
  'coder:diff': (sessionId: string, path: string) => string
  /** Puts every file the session changed back as it was. Returns how many. */
  'coder:undo': (sessionId: string, path?: string) => number
  /** One changed file, split into its separate changes. */
  'coder:review': (sessionId: string, path: string) => CoderReview | null
  /** Keeps or puts back one change, or the whole file with a null hunk. Returns what's left to review. */
  'coder:decide': (sessionId: string, path: string, hunk: string | null, decision: CoderDecision) => CoderChange[]
  'highlights:list': () => Highlight[]
  'highlights:note': (id: string, note: string) => void
  'highlights:remove': (id: string) => void
  /** Opens the page with the words marked. */
  'highlights:open': (id: string) => void
  /** Hands these highlights to sc://assistant, which writes a report from them alone. */
  'highlights:report': (ids: string[]) => void
  'reading:list': () => ReadingItem[]
  'reading:open': (id: string) => void
  'reading:set-read': (id: string, read: boolean) => void
  'reading:remove': (id: string) => void
  /** Asks the AI for a summary, only when the person presses for one. Returns it. */
  'reading:summarise': (id: string) => string
  /** Hands the unread list's titles and summaries to sc://assistant for a digest. */
  'reading:digest': () => void
  /** Saves highlights as a Markdown file. False if cancelled. */
  'highlights:export': () => boolean
  /** Adds these highlights to the new tab's notes. Returns what to say. */
  'highlights:to-notes': (ids: string[]) => string
  /** Sets up a weekly brief on what's new about these highlights. */
  'highlights:brief': (ids: string[]) => void
  /** Keeps a page the assistant wrote as an app of its own. Returns its name. */
  'mini-apps:keep': (name: string, content: string) => string
  'mini-apps:list': () => { id: string; name: string; createdAt: number }[]
  'mini-apps:open': (id: string) => void
  'mini-apps:remove': (id: string) => void
  /** What was blocked in the last seven days. Null in private windows, which count nothing. */
  'privacy:week': () => PrivacyWeek | null
  /** Lines up a recap of yesterday's browsing and opens the assistant with it. False if there's nothing to recap. */
  'history:recap': (span?: RecapSpan) => boolean
  'briefs:state': () => BriefState
  'briefs:summary': () => BriefSummary
  /** The newest few, with only the start of their text, for the new tab. */
  'briefs:recent': () => BriefIssue[]
  /** Null adds a new one. */
  'briefs:save': (id: string | null, input: BriefInput) => BriefState
  'briefs:remove': (id: string) => BriefState
  'briefs:pause': (id: string, paused: boolean) => BriefState
  /** Runs it now, and resolves once the brief is written or has failed. */
  'briefs:run': (id: string) => BriefState
  /** Null marks them all as seen. */
  'briefs:seen': (id: string | null) => void
  'briefs:delete-issue': (id: string) => BriefState
  'briefs:prefs': (prefs: Partial<BriefPrefs>) => BriefState
  /** One brief in full, or null if it's gone. */
  'briefs:issue': (id: string) => BriefIssue | null
  /** A question about a brief, answered from it and its sources. Nothing is saved. */
  'briefs:ask': (id: string, question: string) => string
  /** Forgets one kept follow-up question, named by when it was asked. */
  'briefs:forget-question': (id: string, askedAt: number) => BriefState
  /** Follows a story in a web brief. */
  'briefs:follow': (scheduleId: string, story: string) => BriefState
  'briefs:unfollow': (scheduleId: string, story: string) => BriefState
  /** Adds a brief to the notes on the new tab page. Returns what to say. */
  'briefs:to-notes': (id: string) => string
  /** Saved icons for these hosts, as data addresses. Only sites that were bookmarked have one. */
  'site-icons:for': (hosts: string[]) => Record<string, string>
  'snooze:list': () => SnoozedTab[]
  /** Opens a snoozed tab now. */
  'snooze:wake': (id: string) => void
  'snooze:remove': (id: string) => void
  'study:state': () => StudyState
  'study:start': (subjectId: string) => StudyState
  'study:stop': () => StudyState
  /** Takes a break now; the timer starts again by itself when it's over. */
  'study:break': () => StudyState
  /** Null adds a new one. */
  'study:subject-save': (id: string | null, subject: Omit<StudySubject, 'id'>) => StudyState
  'study:subject-remove': (id: string) => StudyState
  'study:session-remove': (id: string) => StudyState
  'study:prefs': (prefs: Partial<StudyPrefs>) => StudyState
  'onboarding:state': () => OnboardingState
  /** Shows how one of the Get started list works, by doing it, and ticks it off. */
  'onboarding:try': (id: GettingStartedId) => void
  'onboarding:mark': (id: GettingStartedId) => void
  'onboarding:set-shown': (show: boolean) => void
  /** Leaves the first-run intro for a new tab. */
  'welcome:finish': () => void
  'welcome:replay': () => void
}

export const INTERNAL_COMMAND_CHANNELS = [
  'settings:get',
  'settings:set',
  'settings:pick-download-dir',
  'settings:export',
  'settings:import',
  'history:list',
  'history:delete',
  'history:clear',
  'data:clear',
  'shortcuts:recording',
  'startup:open-tabs',
  'downloads:drag',
  'bookmarks:list',
  'bookmarks:rename',
  'bookmarks:remove',
  'bookmarks:check-links',
  'bookmarks:export-html',
  'bookmarks:import-html',
  'bookmarks:edit',
  'bookmarks:set-group',
  'bookmarks:groups',
  'bookmarks:add-group',
  'bookmarks:move-group',
  'bookmarks:rename-group',
  'bookmarks:remove-group',
  'downloads:list',
  'downloads:action',
  'downloads:clear',
  'downloads:suggest-name',
  'downloads:rename',
  'spelling:languages',
  'tasks:list',
  'tasks:end',
  'apps:list',
  'apps:open',
  'apps:remove',
  'permissions:list',
  'permissions:revoke',
  'browser:is-default',
  'browser:set-default',
  'browser:open',
  'browser:version',
  'drm:status',
  'notifications:list',
  'markup:image',
  'markup:copy',
  'markup:save',
  'ai:state',
  'ai:save-provider',
  'ai:remove-provider',
  'ai:models',
  'ai:set-role',
  'ai:set-site',
  'chats:clear',
  'chats:list',
  'chats:get',
  'chats:save',
  'chats:delete',
  'chats:designs',
  'chats:set-design',
  'quiz:progress',
  'quiz:record',
  'presets:list',
  'presets:save',
  'presets:delete',
  'ai:ask-report',
  'report:notes',
  'ai:status',
  'ai:send',
  'ai:agent-answer',
  'ai:cancel',
  'ai:take-prompt',
  'ai:open-source',
  'tabs:research-list',
  'extensions:list',
  'extensions:add',
  'extensions:remove',
  'extensions:set-enabled',
  'autofill:list',
  'autofill:save',
  'autofill:remove',
  'history:ask',
  'ai:enable-hosted',
  'ai:save-skills',
  'profiles:list',
  'profiles:open',
  'import:sources',
  'import:run',
  'flags:get',
  'flags:set',
  'browser:restart',
  'browser:is-private',
  'privacy:off-hosts',
  'privacy:toggle-site',
  'privacy:allow-http',
  'newtab:pick-background',
  'newtab:background',
  'newtab:top-sites',
  'newtab:go',
  'newtab:suggest',
  'newtab:switch-tab',
  'newtab:ask',
  'chats:export',
  'ai:compact',
  'notes:save',
  'extensions:open-store',
  'sync:status',
  'sync:pick-folder',
  'sync:enable',
  'sync:disable',
  'sync:run',
  'reports:list',
  'reports:clear',
  'blocker:message',
  'blocker:proceed',
  'blocker:grace-wait',
  'blocker:grace',
  'blocker:leave',
  'pdf:load',
  'pdf:save',
  'pdf:print',
  'pdf:printers',
  'pdf:basic',
  'passwords:state',
  'passwords:create',
  'passwords:set-master',
  'passwords:remove-master',
  'passwords:unlock',
  'passwords:lock',
  'passwords:change-master',
  'passwords:reset',
  'passwords:list',
  'passwords:reveal',
  'passwords:save',
  'passwords:remove',
  'passwords:copy',
  'passwords:totp',
  'passwords:copy-totp',
  'passwords:check-leaks',
  'passwords:leak-status',
  'passwords:import',
  'passwords:export',
  'vpn:state',
  'vpn:use-default',
  'vpn:add',
  'vpn:subscribe',
  'vpn:refresh',
  'vpn:add-group',
  'vpn:rename-group',
  'vpn:remove-group',
  'vpn:move',
  'vpn:remove',
  'vpn:select',
  'vpn:set-enabled',
  'vpn:set-route',
  'vpn:ping',
  'vpn:ping-stop',
  'vpn:ping-progress',
  'vpn:uninstall',
  'vpn:install',
  'report:save',
  'files:preview',
  'files:save',
  'updates:state',
  'updates:check',
  'updates:install',
  'updates:seen',
  'updates:previous',
  'updates:rollback',
  'welcome:finish',
  'welcome:replay',
  'watch:list',
  'watch:check',
  'watch:remove',
  'watch:set-interval',
  'watch:set-target',
  'watch:seen',
  'archive:list',
  'archive:restore',
  'archive:remove',
  'archive:clear',
  'groups:closed',
  'tabsets:list',
  'workspaces:list',
  'tabsets:save',
  'tabsets:open',
  'tabsets:remove',
  'memory:list',
  'memory:add',
  'memory:update',
  'memory:remove',
  'groups:reopen',
  'groups:forget',
  'coder:status',
  'coder:git-state',
  'coder:git-push',
  'coder:git-pull',
  'coder:git-switch',
  'coder:git-merge',
  'coder:git-abort',
  'coder:pr-draft',
  'coder:pr-create',
  'coder:pr-merge',
  'coder:dirs',
  'coder:add-dir',
  'coder:remove-dir',
  'coder:plugins',
  'coder:plugin-preview',
  'coder:plugin-install',
  'coder:plugin-toggle',
  'coder:plugin-remove',
  'coder:status-line',
  'coder:pick-folder',
  'coder:open-folder',
  'coder:run',
  'coder:steer',
  'coder:save',
  'coder:open',
  'coder:answer',
  'coder:answer-question',
  'coder:todo',
  'coder:github-status',
  'coder:github-use-cli',
  'coder:github-save-token',
  'coder:github-disconnect',
  'coder:github-device-start',
  'coder:github-device-wait',
  'coder:github-repos',
  'coder:clone',
  'coder:github-link',
  'coder:github-create',
  'coder:project-setup',
  'coder:cloud-start',
  'coder:server-check',
  'coder:shell',
  'coder:context',
  'coder:doctor',
  'coder:open-file',
  'coder:cloud-runs',
  'coder:cloud-cancel',
  'coder:cloud-fetch',
  'coder:cloud-pr',
  'coder:cloud-events',
  'coder:note',
  'coder:automations',
  'coder:automations-install',
  'coder:stop',
  'coder:reset',
  'coder:changes',
  'coder:diff',
  'coder:undo',
  'coder:review',
  'coder:decide',
  'coder:stop-tool',
  'coder:rewind',
  'coder:undo-step',
  'coder:activity',
  'chats:flag',
  'coder:mcp-signin',
  'coder:mcp-signout',
  'coder:compact',
  'coder:fork',
  'coder:export',
  'coder:models',
  'coder:setup',
  'coder:set-rules',
  'coder:remember',
  'coder:files',
  'coder:tabs',
  'coder:job-stop',
  'coder:running',
  'coder:replay',
  'coder:mcp-save',
  'coder:mcp-remove',
  'coder:mcp-trust',
  'coder:mcp-restart',
  'coder:hooks-trust',
  'coder:worktree',
  'coder:worktree-info',
  'coder:worktree-merge',
  'coder:worktree-remove',
  'coder:commit-message',
  'coder:commit',
  'coder:pending',
  'highlights:list',
  'highlights:note',
  'highlights:remove',
  'highlights:open',
  'highlights:report',
  'reading:list',
  'reading:open',
  'reading:set-read',
  'reading:remove',
  'reading:summarise',
  'reading:digest',
  'highlights:export',
  'highlights:to-notes',
  'highlights:brief',
  'mini-apps:keep',
  'mini-apps:list',
  'mini-apps:open',
  'mini-apps:remove',
  'privacy:week',
  'history:recap',
  'briefs:state',
  'briefs:summary',
  'briefs:recent',
  'briefs:save',
  'briefs:remove',
  'briefs:pause',
  'briefs:run',
  'briefs:seen',
  'briefs:delete-issue',
  'briefs:prefs',
  'briefs:issue',
  'briefs:ask',
  'briefs:forget-question',
  'briefs:follow',
  'briefs:unfollow',
  'briefs:to-notes',
  'site-icons:for',
  'snooze:list',
  'snooze:wake',
  'snooze:remove',
  'study:state',
  'study:start',
  'study:stop',
  'study:break',
  'study:subject-save',
  'study:subject-remove',
  'study:session-remove',
  'study:prefs',
  'onboarding:state',
  'onboarding:try',
  'onboarding:mark',
  'onboarding:set-shown'
] as const satisfies readonly (keyof InternalCommands)[]

/** Shape of `window.scb`, exposed by the chrome UI preload. */
export type ChromeBridge = Bridge<ChromeCommands, ChromeEvents>

/** Shape of `window.scbOverlay`, exposed by the overlay preload. */
export type OverlayBridge = Bridge<OverlayCommands, OverlayEvents>

/** Shape of `window.scbInternal`, exposed only to `sc://` pages. */
export interface InternalBridge {
  invoke<C extends keyof InternalCommands & string>(
    channel: C,
    ...args: Parameters<InternalCommands[C]>
  ): Promise<Awaited<ReturnType<InternalCommands[C]>>>
  /** Assistant replies, for the sc://assistant page. */
  onAssistantEvent(listener: (event: AssistantEvent) => void): () => void
  /** The coding agent's steps, for sc://code. */
  onCoderEvent(listener: (event: CoderEvent) => void): () => void
}
