import type { AiState, AiStatus, AssistantEvent, AssistantPrompt, AssistantRequest, ChatSummary, ModelRef, ModelRole, ProviderProtocol, SavedChat, SavedTurn, Skill } from './ai'
import type { ExtensionInfo, ImportResult, ImportSource } from './containers'
import type { BarItem, Bookmark, BookmarkGroup, DownloadAction, DownloadInfo, PermissionDecision } from './library'
import type { HistoryEntry } from './omnibox'
import type { CrashEntry } from './reports'
import type { SyncStatus } from './sync'
import type { BookmarkEdit, OverlayState, OverlayView } from './overlay'
import type { Settings } from './settings'
import type { VpnAddResult, VpnState, VpnSummary } from './vpn'
import type { PageRect, TabId, TabsSnapshot } from './tabs'

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
  'tabs:context-menu': (id: TabId) => void
  'tabs:open-in-background': (url: string) => void
  'bookmarks:list': () => Bookmark[]
  'bookmarks:toggle': (url: string, title: string) => void
  'bookmarks:context-menu': (id: number) => void
  'bookmarks:groups': () => BookmarkGroup[]
  'bookmarks:arrange': (items: BarItem[]) => void
  'bookmarks:set-group': (id: number, groupId: number | null) => void
  'bookmarks:group-menu': (id: number, x: number, y: number) => void
  /** Adds the page if needed, then opens the name editor beside the star. */
  'bookmarks:edit-page': (url: string, title: string) => void
  'settings:get': () => Settings
  'settings:set': (patch: Partial<Settings>) => void
  'find:query': (text: string, options: { forward: boolean; findNext: boolean }) => void
  'find:stop': () => void
  'zoom:reset': () => void
  'menu:open': (x: number, y: number) => void
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
  'privacy:toggle-site': (host: string) => void
  'reader:toggle': () => void
  'vpn:summary': () => VpnSummary
  'browser:is-private': () => boolean
  'vpn:menu': (x: number, y: number) => void
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
}

/** Commands the overlay view sends to the main process. */
export interface OverlayCommands {
  'overlay:pick': (index: number) => void
  'overlay:permission': (requestId: number, allow: boolean) => void
  'overlay:palette-run': (id: string) => void
  'overlay:palette-close': () => void
  /** Returns what's wrong, or null once saved. */
  'overlay:bookmark-save': (edit: BookmarkEdit) => string | null
  'overlay:bookmark-remove': (id: number) => void
  'overlay:bookmark-close': () => void
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
  'tabs:context-menu',
  'tabs:open-in-background',
  'bookmarks:list',
  'bookmarks:toggle',
  'bookmarks:context-menu',
  'bookmarks:groups',
  'bookmarks:arrange',
  'bookmarks:set-group',
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
  'privacy:toggle-site',
  'reader:toggle',
  'vpn:summary',
  'browser:is-private',
  'vpn:menu'
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
  'vpn:changed'
] as const satisfies readonly EventChannel[]

export const OVERLAY_COMMAND_CHANNELS = ['overlay:pick', 'overlay:permission', 'overlay:palette-run', 'overlay:palette-close', 'overlay:bookmark-save', 'overlay:bookmark-remove', 'overlay:bookmark-close'] as const satisfies readonly (keyof OverlayCommands)[]
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
  'bookmarks:add-group': (name: string) => number
  'bookmarks:rename-group': (id: number, name: string) => void
  'bookmarks:remove-group': (id: number) => void
  'downloads:list': () => DownloadInfo[]
  'downloads:action': (id: string, action: DownloadAction) => void
  'downloads:clear': () => void
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
  'vpn:ping': (ids: string[]) => Record<string, number | null>
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
  'bookmarks:rename-group',
  'bookmarks:remove-group',
  'downloads:list',
  'downloads:action',
  'downloads:clear',
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
  'vpn:ping'
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
