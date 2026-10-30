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
}

/** Events the main process pushes to the chrome UI. */
export interface ChromeEvents {
  'tabs:changed': TabsSnapshot
  'ui:focus-omnibox': void
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
  'layout:page-rect'
] as const satisfies readonly CommandChannel[]

export const EVENT_CHANNELS = ['tabs:changed', 'ui:focus-omnibox'] as const satisfies readonly EventChannel[]

/** Shape of `window.scb`, exposed by the chrome UI preload. */
export interface ChromeBridge {
  invoke<C extends CommandChannel>(
    channel: C,
    ...args: Parameters<ChromeCommands[C]>
  ): Promise<ReturnType<ChromeCommands[C]>>
  on<E extends EventChannel>(channel: E, listener: (payload: ChromeEvents[E]) => void): () => void
  platform: 'linux' | 'win32' | 'darwin'
}
