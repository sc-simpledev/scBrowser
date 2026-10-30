import type { AiState, AiStatus, AssistantEvent, AssistantPrompt, AssistantRequest, ChatSummary, ModelRef, ModelRole, ProviderProtocol, SavedChat, SavedTurn } from './ai'
import type { Bookmark, DownloadAction, DownloadInfo, PermissionDecision } from './library'
import type { HistoryEntry } from './omnibox'
import type { OverlayState, OverlayView } from './overlay'
import type { Settings } from './settings'
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
  'chats:list': () => ChatSummary[]
  'chats:get': (id: string) => SavedChat | null
  'chats:save': (id: string, turns: SavedTurn[]) => void
  'chats:delete': (id: string) => void
  'privacy:toggle-site': (host: string) => void
  'reader:toggle': () => void
}

/** Events the main process pushes to the chrome UI. */
export interface ChromeEvents {
  'tabs:changed': TabsSnapshot
  'ui:focus-omnibox': void
  /** The user clicked a row in the omnibox dropdown (index into the current list). */
  'omnibox:pick': number
  'bookmarks:changed': Bookmark[]
  'settings:changed': Settings
  'ui:open-find': void
  'find:result': { active: number; total: number }
  'downloads:progress': { active: number; fraction: number | null }
  'ai:changed': AiStatus
  'ai:event': AssistantEvent
  'ui:assistant-toggle': void
  'ui:assistant-prompt': AssistantPrompt
  'privacy:changed': string[]
}

/** Commands the overlay view sends to the main process. */
export interface OverlayCommands {
  'overlay:pick': (index: number) => void
  'overlay:permission': (requestId: number, allow: boolean) => void
  'overlay:palette-run': (id: string) => void
  'overlay:palette-close': () => void
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
  'chats:list',
  'chats:get',
  'chats:save',
  'chats:delete',
  'privacy:toggle-site',
  'reader:toggle'
] as const satisfies readonly CommandChannel[]

export const EVENT_CHANNELS = [
  'tabs:changed',
  'ui:focus-omnibox',
  'omnibox:pick',
  'bookmarks:changed',
  'settings:changed',
  'ui:open-find',
  'find:result',
  'downloads:progress',
  'ai:changed',
  'ai:event',
  'ui:assistant-toggle',
  'ui:assistant-prompt',
  'privacy:changed'
] as const satisfies readonly EventChannel[]

export const OVERLAY_COMMAND_CHANNELS = ['overlay:pick', 'overlay:permission', 'overlay:palette-run', 'overlay:palette-close'] as const satisfies readonly (keyof OverlayCommands)[]
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
  'privacy:off-hosts': () => string[]
  'privacy:toggle-site': (host: string) => void
  'privacy:allow-http': (url: string) => void
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
  'privacy:off-hosts',
  'privacy:toggle-site',
  'privacy:allow-http'
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
}
