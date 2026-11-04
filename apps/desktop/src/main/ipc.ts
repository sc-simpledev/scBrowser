import { ipcMain, type BaseWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  engineById,
  MAX_MENTIONED_TABS,
  MAX_SUGGESTIONS,
  type AssistantRequest,
  type BarItem,
  type Bookmark,
  type ChromeCommands,
  type CommandChannel,
  type OverlayState,
  type PageRect,
  type SavedTurn,
  type Settings,
  type Suggestion
} from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import type { AiService } from './ai/service'
import type { AiStore } from './ai/store'
import { readFlags } from './flags'
import type { PasswordVault } from './passwords'
import { isPrivate } from './private'
import { isReportSave, saveReport } from './reportExport'
import { popupAppMenu, popupBookmarkGroup, popupBookmarkMenu, popupBookmarkOverflow, popupProfilesMenu, popupTabMenu } from './menus'
import { fetchSearchSuggestions } from './omnibox/searchSuggestions'
import type { Overlay } from './overlay'
import type { PrivacyService } from './privacy/service'
import type { UpdateService } from './updater'
import type { SettingsStore } from './settings'
import type { BookmarksRepo } from './storage/bookmarks'
import type { ChatsRepo } from './storage/chats'
import type { HistoryRepo } from './storage/history'
import type { TabManager } from './tabs/TabManager'
import type { VpnService } from './vpn'

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
    (action.type === 'navigate' && isShortString(action.url)) || (action.type === 'switch-tab' && isId(action.tabId)) ||
    ((action.type === 'ask' || action.type === 'ask-page') && isShortString(action.text))
  return validAction && isShortString(value.id) && isShortString(value.kind, 32) && isShortString(value.title) &&
    (value.detail === undefined || isShortString(value.detail))
}

const MAX_CONVERSATION_CHARS = 2_000_000

export const isAssistantRequest = (value: unknown): value is AssistantRequest => {
  if (!record(value) || !Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > 500) return false
  const messagesOk = value.messages.every(
    (m: unknown) =>
      record(m) && (m.role === 'user' || m.role === 'assistant') && isShortString(m.content, MAX_CONVERSATION_CHARS)
  )
  return (
    messagesOk &&
    (value.tabId === null || isId(value.tabId)) &&
    Array.isArray(value.extraTabIds) &&
    value.extraTabIds.length <= MAX_MENTIONED_TABS &&
    value.extraTabIds.every(isId) &&
    typeof value.includePage === 'boolean' &&
    (value.selection === null || isShortString(value.selection, MAX_CONVERSATION_CHARS))
  )
}

export const isTurns = (value: unknown): value is SavedTurn[] =>
  Array.isArray(value) &&
  value.length <= 500 &&
  value.every(
    (t: unknown) =>
      record(t) &&
      (t.role === 'user' || t.role === 'assistant') &&
      isShortString(t.content, MAX_CONVERSATION_CHARS) &&
      (t.pageTitle === undefined || isShortString(t.pageTitle, 2048)) &&
      (t.source === undefined || ['page', 'transcript', 'pdf'].includes(t.source as string)) &&
      (t.truncated === undefined || typeof t.truncated === 'boolean')
  )

const chatIdArg = (args: unknown[]): args is [string] => args.length === 1 && isShortString(args[0], 64)

const isAnswer = (value: unknown): boolean =>
  record(value) &&
  isShortString(value.question, 4000) &&
  isShortString(value.text, MAX_CONVERSATION_CHARS) &&
  typeof value.streaming === 'boolean' &&
  typeof value.canContinue === 'boolean' &&
  (value.error === null || isShortString(value.error, 2000))

const isOverlayState = (value: unknown): value is OverlayState => {
  if (!record(value)) return false
  const { omnibox, tooltip } = value
  const omniboxOk =
    omnibox === null ||
    (record(omnibox) &&
      isRect(omnibox.anchor) &&
      (omnibox.answer === null || isAnswer(omnibox.answer)) &&
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
  'bookmarks:groups': noArgs,
  'vpn:summary': noArgs,
  'browser:is-private': noArgs,
  'passwords:summary': noArgs,
  'flags:get': noArgs,
  'passwords:menu': (args): args is [number, number] => args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number',
  'layout:resizing': (args): args is [boolean] => args.length === 1 && typeof args[0] === 'boolean',
  'bookmarks:move-group': (args): args is [number, number | null] => args.length === 2 && isId(args[0]) && (args[1] === null || isId(args[1])),
  'vpn:menu': (args): args is [number, number] => args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number',
  'bookmarks:arrange': (args): args is [BarItem[]] =>
    args.length === 1 &&
    Array.isArray(args[0]) &&
    args[0].length <= 10_000 &&
    args[0].every((item: BarItem) => record(item) && (item.kind === 'bookmark' || item.kind === 'group') && isId(item.id)),
  'bookmarks:set-group': (args): args is [number, number | null] => args.length === 2 && isId(args[0]) && (args[1] === null || isId(args[1])),
  'bookmarks:group-menu': (args): args is [number, number, number] => args.length === 3 && isId(args[0]) && typeof args[1] === 'number' && typeof args[2] === 'number',
  'bookmarks:edit-page': (args): args is [string, string] => args.length === 2 && isShortString(args[0]) && isShortString(args[1]),
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
  'menu:open': (args): args is [number, number, boolean] =>
    args.length === 3 && Number.isFinite(args[0]) && Number.isFinite(args[1]) && typeof args[2] === 'boolean',
  'downloads:open-page': noArgs,
  'ai:status': noArgs,
  'ai:send': (args): args is [string, AssistantRequest] =>
    args.length === 2 && isShortString(args[0], 64) && isAssistantRequest(args[1]),
  'ai:cancel': (args): args is [string] => args.length === 1 && isShortString(args[0], 64),
  'ai:set-site': (args): args is [string, boolean] =>
    args.length === 2 && isShortString(args[0], 512) && typeof args[1] === 'boolean',
  'ai:open-settings': noArgs,
  'ai:enable-hosted': noArgs,
  'ai:open-assistant': (args): args is [string] => args.length === 1 && isShortString(args[0]),
  'ai:open-chat': chatIdArg,
  'ai:agent-start': (args): args is [string, string, number] =>
    args.length === 3 && isShortString(args[0], 64) && isShortString(args[1], 4000) && isId(args[2]),
  'ai:agent-answer': (args): args is [string, boolean] => args.length === 2 && isShortString(args[0], 64) && typeof args[1] === 'boolean',
  'tabs:organise': noArgs,
  'chats:list': noArgs,
  'chats:get': chatIdArg,
  'chats:save': (args): args is [string, SavedTurn[]] =>
    args.length === 2 && isShortString(args[0], 64) && isTurns(args[1]),
  'chats:delete': chatIdArg,
  'report:save': isReportSave,
  'privacy:toggle-site': (args): args is [string] => args.length === 1 && isShortString(args[0], 512),
  'reader:toggle': noArgs,
  'tabs:cleanup': noArgs,
  'workspaces:switch': (args): args is [string] => args.length === 1 && isShortString(args[0], 64),
  'workspaces:edit': (args): args is [string | null, number, number] =>
    args.length === 3 && (args[0] === null || isShortString(args[0], 64)) && Number.isFinite(args[1]) && Number.isFinite(args[2]),
  'updates:state': noArgs,
  'updates:install': noArgs,
  'bookmarks:overflow-menu': (args): args is [BarItem[], number, number] =>
    args.length === 3 &&
    Array.isArray(args[0]) &&
    args[0].length <= 10_000 &&
    args[0].every((item: BarItem) => record(item) && (item.kind === 'bookmark' || item.kind === 'group') && isId(item.id)) &&
    Number.isFinite(args[1]) &&
    Number.isFinite(args[2]),
  'profiles:menu': (args): args is [number, number] => args.length === 2 && Number.isFinite(args[0]) && Number.isFinite(args[1])
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
  /** `fromBar` also offers the address. */
  editBookmark: (bookmark: Bookmark, fromBar: boolean) => void
  vpn: VpnService
  openVpnMenu: (x: number, y: number) => void
  openPasswordMenu: (x?: number, y?: number) => void
  passwords: PasswordVault
  updates: UpdateService
  editWorkspace: (id: string | null, x: number, y: number) => void
  aiStore: AiStore
  ai: AiService
  chats: ChatsRepo
  privacy: PrivacyService
}

/**
 * Registers the chrome UI command handlers. Only the chrome UI's own WebContents may call
 * them, and every argument list is validated before it reaches the TabManager.
 */
export function registerIpc(chromeUi: WebContents, services: IpcServices): () => void {
  const { passwords, openPasswordMenu, window, tabs, history, bookmarks, settings, overlay, actions, onBookmarksChanged, editBookmark, aiStore, ai, chats, privacy, vpn, openVpnMenu, updates, editWorkspace } = services
  const menuHooks = { repo: bookmarks, onChange: onBookmarksChanged, actions, window, edit: (bookmark: Bookmark) => editBookmark(bookmark, true) }

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
      if (bookmark) popupBookmarkMenu(bookmark, menuHooks)
    },
    'bookmarks:groups': () => bookmarks.groups(),
    'vpn:summary': () => vpn.summary(),
    'browser:is-private': () => isPrivate,
    'vpn:menu': (x, y) => openVpnMenu(x, y),
    'passwords:summary': () => passwords.state(),
    'flags:get': () => readFlags(),
    'passwords:menu': (x, y) => openPasswordMenu(x, y),
    'layout:resizing': (resizing) => tabs.setResizing(resizing),
    'bookmarks:move-group': (id, parentId) => {
      bookmarks.moveGroup(id, parentId)
      onBookmarksChanged()
    },
    'bookmarks:arrange': (items) => {
      bookmarks.arrange(items)
      onBookmarksChanged()
    },
    'bookmarks:set-group': (id, groupId) => {
      bookmarks.setGroup(id, groupId)
      onBookmarksChanged()
    },
    'bookmarks:group-menu': (id, x, y) => {
      const group = bookmarks.groups().find((g) => g.id === id)
      const open = (url: string) => {
        if (tabs.active) tabs.navigate(tabs.active.id, url)
      }
      if (group) popupBookmarkGroup(group, menuHooks, open, x, y)
    },
    'bookmarks:edit-page': (url, title) => {
      if (!bookmarks.has(url)) {
        bookmarks.toggle(url, title)
        onBookmarksChanged()
      }
      const bookmark = bookmarks.list().find((b) => b.url === url)
      if (bookmark) editBookmark(bookmark, false)
    },
    'settings:get': () => settings.get(),
    'settings:set': (patch) => settings.set(patch),
    'find:query': (text, options) => tabs.find(text, options),
    'find:stop': () => tabs.stopFind(),
    'zoom:reset': () => {
      if (tabs.active) tabs.setZoom(tabs.active.id, 1)
    },
    'menu:open': (x, y, compact) => popupAppMenu(actions, settings.get().bookmarksBar === 'always', updates.state(), compact, window, x, y),
    'downloads:open-page': () => actions.openPage('downloads'),
    'ai:status': () => aiStore.status(),
    'ai:send': (streamId, request) => {
      void ai.send(streamId, request, (event) => {
        if (!chromeUi.isDestroyed()) chromeUi.send('ai:event', event)
      })
    },
    'ai:cancel': (streamId) => ai.cancel(streamId),
    'ai:set-site': (host, disabled) => aiStore.setSiteDisabled(host, disabled),
    'ai:open-settings': () => actions.openPage('ai'),
    'ai:enable-hosted': () => aiStore.enableHosted(),
    'ai:open-assistant': (text) => {
      ai.setPendingPrompt(text)
      if (tabs.active) tabs.navigate(tabs.active.id, 'sc://assistant')
    },
    'ai:open-chat': (id) => {
      tabs.create(`sc://assistant/?chat=${encodeURIComponent(id)}`, { afterId: tabs.active?.id })
    },
    'ai:agent-start': (streamId, goal, tabId) => {
      void ai.runAgent(streamId, goal, tabId, (event) => {
        if (!chromeUi.isDestroyed()) chromeUi.send('ai:event', event)
      })
    },
    'ai:agent-answer': (approvalId, allow) => ai.answerApproval(approvalId, allow),
    'tabs:organise': () => actions.organiseTabs(),
    'chats:list': () => chats.list(),
    'chats:get': (id) => chats.get(id),
    'chats:save': (id, turns) => {
      if (settings.get().saveChats) chats.save(id, turns)
    },
    'chats:delete': (id) => chats.delete(id),
    'report:save': (name, format, content) => saveReport(window, name, format, content),
    'privacy:toggle-site': (host) => {
      privacy.toggleSite(host)
      if (tabs.active) tabs.reload(tabs.active.id)
    },
    'reader:toggle': () => actions.toggleReader(),
    'tabs:cleanup': () => actions.cleanupTabs(),
    'workspaces:switch': (id) => tabs.switchWorkspace(id),
    'workspaces:edit': (id, x, y) => editWorkspace(id, x, y),
    'updates:state': () => updates.state(),
    'updates:install': () => updates.install(),
    'bookmarks:overflow-menu': (items, x, y) => {
      const open = (url: string) => {
        if (tabs.active) tabs.navigate(tabs.active.id, url)
      }
      popupBookmarkOverflow(items, menuHooks, open, x, y)
    },
    'profiles:menu': (x, y) => popupProfilesMenu(actions, window, x, y)
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
