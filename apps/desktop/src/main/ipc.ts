import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  MAX_SUGGESTIONS,
  type ChromeCommands,
  type CommandChannel,
  type OverlayState,
  type PageRect,
  type Suggestion
} from '@scbrowser/shared'
import { fetchSearchSuggestions } from './omnibox/searchSuggestions'
import type { Overlay } from './overlay'
import type { HistoryRepo } from './storage/history'
import type { TabManager } from './tabs/TabManager'

type Handlers = { [C in CommandChannel]: (...args: Parameters<ChromeCommands[C]>) => ReturnType<ChromeCommands[C]> }
type Validators = { [C in CommandChannel]: (args: unknown[]) => args is Parameters<ChromeCommands[C]> }

const isId = (value: unknown): value is number => Number.isInteger(value)
const isRect = (value: unknown): value is PageRect =>
  typeof value === 'object' &&
  value !== null &&
  ['x', 'y', 'width', 'height'].every((k) => Number.isFinite((value as Record<string, unknown>)[k]))

const idArg = (args: unknown[]): args is [number] => args.length === 1 && isId(args[0])
const queryArg = (args: unknown[]): args is [string] =>
  args.length === 1 && typeof args[0] === 'string' && args[0].length <= 2048

const isShortString = (value: unknown, max = 8192): value is string => typeof value === 'string' && value.length <= max
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isSuggestion = (value: unknown): value is Suggestion => {
  if (!record(value) || !record(value.action)) return false
  const { action } = value
  const validAction =
    (action.type === 'navigate' && isShortString(action.url)) || (action.type === 'switch-tab' && isId(action.tabId))
  return validAction && isShortString(value.id) && isShortString(value.kind, 32) && isShortString(value.title) &&
    (value.detail === undefined || isShortString(value.detail))
}

const isOverlayState = (value: unknown): value is OverlayState => {
  if (!record(value)) return false
  const { omnibox, tooltip } = value
  const omniboxOk =
    omnibox === null ||
    (record(omnibox) &&
      isRect(omnibox.anchor) &&
      Number.isInteger(omnibox.selectedIndex) &&
      Array.isArray(omnibox.suggestions) &&
      omnibox.suggestions.length <= MAX_SUGGESTIONS &&
      omnibox.suggestions.every(isSuggestion))
  const tooltipOk =
    tooltip === null ||
    (record(tooltip) &&
      isRect(tooltip.anchor) &&
      isShortString(tooltip.label, 200) &&
      (tooltip.shortcut === undefined || isShortString(tooltip.shortcut, 40)))
  return omniboxOk && tooltipOk
}

const validators: Validators = {
  'tabs:create': (args): args is [string?] => args.length === 0 || (args.length === 1 && typeof args[0] === 'string'),
  'tabs:close': idArg,
  'tabs:activate': idArg,
  'tabs:navigate': (args): args is [number, string] =>
    args.length === 2 && isId(args[0]) && typeof args[1] === 'string' && args[1].length <= 8192,
  'tabs:back': idArg,
  'tabs:forward': idArg,
  'tabs:reload': idArg,
  'tabs:stop': idArg,
  'tabs:snapshot': (args): args is [] => args.length === 0,
  'layout:page-rect': (args): args is [PageRect] => args.length === 1 && isRect(args[0]),
  'history:search': queryArg,
  'search:suggestions': queryArg,
  'overlay:set': (args): args is [OverlayState] => args.length === 1 && isOverlayState(args[0])
}

interface IpcServices {
  tabs: TabManager
  history: HistoryRepo
  overlay: Overlay
}

/**
 * Registers the chrome UI command handlers. Only the chrome UI's own WebContents may call
 * them, and every argument list is validated before it reaches the TabManager.
 */
export function registerIpc(chromeUi: WebContents, { tabs, history, overlay }: IpcServices): () => void {
  const handlers: Handlers = {
    'tabs:create': (url) => tabs.create(url),
    'tabs:close': (id) => tabs.close(id),
    'tabs:activate': (id) => tabs.activate(id),
    'tabs:navigate': (id, input) => tabs.navigate(id, input),
    'tabs:back': (id) => tabs.back(id),
    'tabs:forward': (id) => tabs.forward(id),
    'tabs:reload': (id) => tabs.reload(id),
    'tabs:stop': (id) => tabs.stop(id),
    'tabs:snapshot': () => tabs.snapshot(),
    'layout:page-rect': (rect) =>
      tabs.setPageRect({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height))
      }),
    'history:search': (query) => history.search(query),
    'search:suggestions': (query) => fetchSearchSuggestions(query),
    'overlay:set': (state) => overlay.set(state)
  }

  const channels = Object.keys(handlers) as CommandChannel[]
  for (const channel of channels) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== chromeUi) throw new Error(`Rejected ${channel} from untrusted sender`)
      if (!validators[channel](args)) throw new Error(`Invalid arguments for ${channel}`)
      return (handlers[channel] as (...a: unknown[]) => unknown)(...args)
    })
  }
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel))
}
