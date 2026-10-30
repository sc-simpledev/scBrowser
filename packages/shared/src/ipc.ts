import type { HistoryEntry } from './omnibox'
import type { OverlayState } from './overlay'
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
}

/** Events the main process pushes to the chrome UI. */
export interface ChromeEvents {
  'tabs:changed': TabsSnapshot
  'ui:focus-omnibox': void
  /** The user clicked a row in the omnibox dropdown (index into the current list). */
  'omnibox:pick': number
}

/** Commands the overlay view sends to the main process. */
export interface OverlayCommands {
  'overlay:pick': (index: number) => void
}

/** Events the main process pushes to the overlay view. */
export interface OverlayEvents {
  /** `origin` is the overlay's top-left in window coordinates. */
  'overlay:state': { state: OverlayState; origin: { x: number; y: number } }
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
  'overlay:set'
] as const satisfies readonly CommandChannel[]

export const EVENT_CHANNELS = ['tabs:changed', 'ui:focus-omnibox', 'omnibox:pick'] as const satisfies readonly EventChannel[]

export const OVERLAY_COMMAND_CHANNELS = ['overlay:pick'] as const satisfies readonly (keyof OverlayCommands)[]
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

/** Shape of `window.scb`, exposed by the chrome UI preload. */
export type ChromeBridge = Bridge<ChromeCommands, ChromeEvents>

/** Shape of `window.scbOverlay`, exposed by the overlay preload. */
export type OverlayBridge = Bridge<OverlayCommands, OverlayEvents>
