import { ipcMain, type BaseWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  engineById,
  MAX_SUGGESTIONS,
  type ChromeCommands,
  type CommandChannel,
  type OverlayState,
  type PageRect,
  type Settings,
  type Suggestion
} from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import { popupAppMenu, popupBookmarkMenu, popupTabMenu } from './menus'
import { fetchSearchSuggestions } from './omnibox/searchSuggestions'
import type { Overlay } from './overlay'
import type { SettingsStore } from './settings'
import type { BookmarksRepo } from './storage/bookmarks'
import type { HistoryRepo } from './storage/history'
import type { TabManager } from './tabs/TabManager'

type Handlers = { [C in CommandChannel]: (...args: Parameters<ChromeCommands[C]>) => ReturnType<ChromeCommands[C]> }
type Validators = { [C in CommandChannel]: (args: unknown[]) => args is Parameters<ChromeCommands[C]> }

const isId = (value: unknown): value is number => Number.isInteger(value)
const isRect = (value: unknown): value is PageRect =>
  typeof value === 'object' &&
  value !== null &&
  ['x', 'y', 'width', 'height'].every((k) => Number.isFinite((value as Record<string, unknown>)[k]))

const noArgs = (args: unknown[]): args is [] => args.length === 0
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
  'tabs:snapshot': noArgs,
  'layout:page-rect': (args): args is [PageRect] => args.length === 1 && isRect(args[0]),
  'history:search': queryArg,
  'search:suggestions': queryArg,
  'overlay:set': (args): args is [OverlayState] => args.length === 1 && isOverlayState(args[0]),
  'tabs:move': (args): args is [number, number] => args.length === 2 && isId(args[0]) && isId(args[1]),
  'tabs:context-menu': idArg,
  'tabs:open-in-background': (args): args is [string] =>
    args.length === 1 && typeof args[0] === 'string' && /^https?:/i.test(args[0]) && args[0].length <= 8192,
  'bookmarks:list': noArgs,
  'bookmarks:toggle': (args): args is [string, string] =>
    args.length === 2 && isShortString(args[0]) && isShortString(args[1], 1024),
  'bookmarks:context-menu': idArg,
  'settings:get': noArgs,
  'settings:set': (args): args is [Partial<Settings>] => args.length === 1 && record(args[0]),
  'find:query': (args): args is [string, { forward: boolean; findNext: boolean }] =>
    args.length === 2 &&
    isShortString(args[0], 1024) &&
    record(args[1]) &&
    typeof args[1].forward === 'boolean' &&
    typeof args[1].findNext === 'boolean',
  'find:stop': noArgs,
  'zoom:reset': noArgs,
  'menu:open': (args): args is [number, number] =>
    args.length === 2 && Number.isFinite(args[0]) && Number.isFinite(args[1]),
  'downloads:open-page': noArgs
}

interface IpcServices {
  window: BaseWindow
  tabs: TabManager
  history: HistoryRepo
  bookmarks: BookmarksRepo
  settings: SettingsStore
  overlay: Overlay
  actions: BrowserActions
  onBookmarksChanged: () => void
}

/**
 * Registers the chrome UI command handlers. Only the chrome UI's own WebContents may call
 * them, and every argument list is validated before it reaches the TabManager.
 */
export function registerIpc(chromeUi: WebContents, services: IpcServices): () => void {
  const { window, tabs, history, bookmarks, settings, overlay, actions, onBookmarksChanged } = services

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
    'search:suggestions': async (query) => {
      const { searchSuggestions, searchEngine } = settings.get()
      return searchSuggestions ? fetchSearchSuggestions(query, engineById(searchEngine)) : []
    },
    'overlay:set': (state) => overlay.set(state),
    'tabs:move': (id, index) => tabs.move(id, index),
    'tabs:context-menu': (id) => popupTabMenu(id, actions, window),
    'tabs:open-in-background': (url) => {
      tabs.create(url, { activate: false, afterId: tabs.active?.id })
    },
    'bookmarks:list': () => bookmarks.list(),
    'bookmarks:toggle': (url, title) => {
      bookmarks.toggle(url, title)
      onBookmarksChanged()
    },
    'bookmarks:context-menu': (id) => {
      const bookmark = bookmarks.list().find((b) => b.id === id)
      if (bookmark) popupBookmarkMenu(bookmark, bookmarks, onBookmarksChanged, actions, window)
    },
    'settings:get': () => settings.get(),
    'settings:set': (patch) => settings.set(patch),
    'find:query': (text, options) => tabs.find(text, options),
    'find:stop': () => tabs.stopFind(),
    'zoom:reset': () => {
      if (tabs.active) tabs.setZoom(tabs.active.id, 1)
    },
    'menu:open': (x, y) => popupAppMenu(actions, settings.get().showBookmarksBar, window, x, y),
    'downloads:open-page': () => actions.openPage('downloads')
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
