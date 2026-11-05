import type { AiState, AiStatus, AssistantEvent, AssistantPrompt, AssistantRequest, ChatSummary, ModelRef, ModelRole, ProviderProtocol, SavedChat, SavedTurn, Skill } from './ai'
import type { ExtensionInfo, ExtensionPanelState, ExtensionSummary, ImportResult, ImportSource } from './containers'
import type { BarItem, Bookmark, BookmarkGroup, DownloadAction, DownloadInfo, PermissionDecision, TaskList, WebApp } from './library'
import type { HistoryEntry, Suggestion } from './omnibox'
import type { CrashEntry } from './reports'
import type { SyncStatus } from './sync'
import type { BookmarkEdit, OverlayState, OverlayView, WorkspaceEdit } from './overlay'
import type { Settings } from './settings'
import type { PasswordEntry, PasswordState, PasswordSummary, Identity } from './passwords'
import type { ReportFormat } from './report'
import type { VpnAddResult, VpnMethod, VpnPingProgress, VpnScope, VpnState, VpnSummary } from './vpn'
import type { PageRect, TabId, TabsSnapshot } from './tabs'
import type { UpdateState } from './updates'

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
  'overlay:set': (state: OverlayState) => void
  'tabs:move': (id: TabId, index: number) => void
  'tabs:mute': (id: TabId, muted: boolean) => void
  'tabs:search': () => void
  /** An installed site's window hands its page over to the full browser. */
  'tabs:open-in-browser': () => void
  'tabs:devtools-width': (width: number) => void
  'browser:new-window': () => void
  /** Splits with the next tab, or ends split view. */
  'tabs:split-toggle': () => void
  'tabs:split-ratio': (ratio: number) => void
  'tabs:context-menu': (id: TabId) => void
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
  'find:query': (text: string, options: { forward: boolean; findNext: boolean }) => void
  'find:stop': () => void
  'zoom:reset': () => void
  /** `compact` adds what a narrow toolbar has no room for. */
  'menu:open': (x: number, y: number, compact: boolean) => void
  'downloads:open-page': () => void
  'ai:status': () => AiStatus
  'ai:send': (streamId: string, request: AssistantRequest) => void
  'ai:cancel': (streamId: string) => void
  'ai:set-site': (host: string, disabled: boolean) => void
  'ai:open-settings': () => void
  'ai:enable-hosted': () => void
  'ai:open-assistant': (text: string) => void
  'ai:open-chat': (id: string) => void
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
  'updates:state': () => UpdateState
  'updates:install': () => void
  'bookmarks:overflow-menu': (items: BarItem[], x: number, y: number) => void
  'profiles:menu': (x: number, y: number) => void
}

/** Events the main process pushes to the chrome UI. */
export interface ChromeEvents {
  'tabs:changed': TabsSnapshot
  'ui:focus-omnibox': void
  /** The user clicked a row in the omnibox dropdown (index into the current list). */
  'omnibox:pick': number
  'bookmarks:changed': Bookmark[]
  'bookmark-groups:changed': BookmarkGroup[]
  'settings:changed': Settings
  'ui:open-find': void
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
  /** The colour the active page asks for. Only sent with the Site colours flag on. */
  'ui:site-colour': string | null
  'updates:changed': UpdateState
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
  'overlay:tab-search-pick': (id: TabId) => void
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
  'overlay:auth': (requestId: number, login: { username: string; password: string } | null) => void
  'overlay:cleanup': (ids: TabId[] | null) => void
  'overlay:workspace-save': (edit: WorkspaceEdit) => void
  'overlay:workspace-remove': (id: string) => void
  'overlay:workspace-close': () => void
  'overlay:tooltip-clear': () => void
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
  'overlay:set',
  'tabs:move',
  'tabs:mute',
  'tabs:search',
  'tabs:open-in-browser',
  'tabs:devtools-width',
  'browser:new-window',
  'tabs:split-toggle',
  'tabs:split-ratio',
  'tabs:context-menu',
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
  'updates:state',
  'updates:install',
  'bookmarks:overflow-menu',
  'profiles:menu'
] as const satisfies readonly CommandChannel[]

export const EVENT_CHANNELS = [
  'tabs:changed',
  'ui:focus-omnibox',
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
  'omnibox:answer-action',
  'overlay:clear-tooltip'
] as const satisfies readonly EventChannel[]

export const OVERLAY_COMMAND_CHANNELS = ['overlay:pick', 'overlay:permission', 'overlay:palette-run', 'overlay:palette-close', 'overlay:app-link-answer', 'overlay:extensions-action', 'overlay:extensions-close', 'overlay:tab-search-pick', 'overlay:tab-search-remove', 'overlay:tab-search-close', 'overlay:bookmark-save', 'overlay:bookmark-remove', 'overlay:bookmark-close', 'overlay:answer-action', 'overlay:answer-link', 'overlay:password-answer', 'overlay:auth', 'overlay:cleanup', 'overlay:workspace-save', 'overlay:workspace-remove', 'overlay:workspace-close', 'overlay:tooltip-clear'] as const satisfies readonly (keyof OverlayCommands)[]
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
  'history:list': (query: string, limit: number, offset: number) => HistoryEntry[]
  'history:delete': (url: string) => void
  'history:clear': () => void
  'bookmarks:list': () => Bookmark[]
  'bookmarks:rename': (id: number, title: string) => void
  'bookmarks:remove': (id: number) => void
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
  'ai:status': () => AiStatus
  'ai:send': (streamId: string, request: AssistantRequest) => void
  'ai:cancel': (streamId: string) => void
  /** Collects a question sent over from the address bar. */
  'ai:take-prompt': () => string | null
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
  /** Rows for the new tab search box: the address bar's, minus tabs and the assistant. */
  'newtab:suggest': (query: string) => Suggestion[]
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
  'blocker:leave': () => void
  /** The PDF in this tab, or null if it can't be fetched. */
  'pdf:load': () => Uint8Array | null
  'pdf:save': () => void
  'pdf:print': () => void
  /** Reopens this PDF in Chromium's own viewer. */
  'pdf:basic': () => void
  'passwords:state': () => PasswordState
  'passwords:create': (master: string) => void
  'passwords:unlock': (master: string) => boolean
  'passwords:lock': () => void
  'passwords:change-master': (current: string, next: string) => boolean
  'passwords:reset': () => void
  'passwords:list': () => PasswordSummary[]
  'passwords:reveal': (id: string) => string
  'passwords:save': (entry: PasswordEntry) => string
  'passwords:remove': (id: string) => void
  'passwords:copy': (id: string) => void
  /** Null if the person cancelled the file picker. */
  'passwords:import': () => number | null
  'passwords:export': () => boolean
  'vpn:state': () => VpnState
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
  /** Asks where to save, and returns false if the person cancelled. */
  /** `content` is HTML for PDF and HTML, and Markdown for Markdown. */
  'report:save': (name: string, format: ReportFormat, content: string) => Promise<boolean>
  'updates:state': () => UpdateState
  'updates:check': () => UpdateState
  'updates:install': () => void
  /** Leaves the first-run intro for a new tab. */
  'welcome:finish': () => void
  'welcome:replay': () => void
}

export const INTERNAL_COMMAND_CHANNELS = [
  'settings:get',
  'settings:set',
  'settings:pick-download-dir',
  'history:list',
  'history:delete',
  'history:clear',
  'bookmarks:list',
  'bookmarks:rename',
  'bookmarks:remove',
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
  'ai:status',
  'ai:send',
  'ai:cancel',
  'ai:take-prompt',
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
  'blocker:leave',
  'pdf:load',
  'pdf:save',
  'pdf:print',
  'pdf:basic',
  'passwords:state',
  'passwords:create',
  'passwords:unlock',
  'passwords:lock',
  'passwords:change-master',
  'passwords:reset',
  'passwords:list',
  'passwords:reveal',
  'passwords:save',
  'passwords:remove',
  'passwords:copy',
  'passwords:import',
  'passwords:export',
  'vpn:state',
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
  'report:save',
  'updates:state',
  'updates:check',
  'updates:install',
  'welcome:finish',
  'welcome:replay'
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
}
