import type { Input, WebContents } from 'electron'
import { buildKeymap, comboAccelerator, comboFromKey, shortcutKeys, SHORTCUTS, type ShortcutId } from '@scbrowser/shared'
import type { BrowserActions } from './actions'

let keymap = buildKeymap({})
let overrides: Record<string, readonly string[]> = {}
/** Pages where Settings is waiting for a key to give a shortcut, which mustn't run it meanwhile. */
const recording = new WeakSet<WebContents>()

/** Takes the person's own keys into use, from Settings. */
export function setShortcutOverrides(next: Record<string, readonly string[]>): void {
  overrides = next
  keymap = buildKeymap(next)
}

/** A shortcut's first key, for a menu to show beside it, or nothing if the person took its keys away. */
export function keyFor(id: ShortcutId): string | undefined {
  const first = shortcutKeys(id, overrides)[0]
  return first ? comboAccelerator(first) : undefined
}

/** The same as people read it, for the command palette. */
export const shortcutKeysNow = (id: ShortcutId): readonly string[] => shortcutKeys(id, overrides)

export function setRecordingShortcut(contents: WebContents, on: boolean): void {
  if (on) recording.add(contents)
  else recording.delete(contents)
}

/** The keys a press makes, as the shortcuts table writes them. */
export const comboOf = (input: Input): string | null =>
  comboFromKey({ key: input.key, code: input.code, ctrlKey: input.control, altKey: input.alt, shiftKey: input.shift, metaKey: input.meta }, process.platform)

/**
 * Browser-wide keyboard shortcuts. They are handled in the main process so they work
 * whether focus is in the chrome UI or inside a web page.
 */
export function handleShortcut(input: Input, actions: BrowserActions): boolean {
  const { tabs } = actions
  // Letting go of Ctrl ends a round of Ctrl Tab in recently used order.
  if (input.type === 'keyUp' && (input.key === 'Control' || (process.platform === 'darwin' && input.key === 'Meta'))) tabs.endRecentCycle()
  if (input.type !== 'keyDown') return false
  const combo = comboOf(input)
  if (!combo) return false

  // Fixed keys: a tab by its place, and a workspace by its place.
  const place = /^Ctrl\+(Alt\+)?([1-9])$/.exec(combo)
  if (place && !actions.appWindow) {
    if (place[1]) {
      const workspace = tabs.workspaceList()[Number(place[2]) - 1]
      if (workspace) tabs.switchWorkspace(workspace.id)
    } else tabs.activateIndex(Number(place[2]))
    return true
  }

  // A function key works with Ctrl or Shift held too, as it always has, unless that combination has a shortcut of its own.
  const id = keymap.get(combo) ?? (/(^|\+)F\d+$/.test(combo) ? keymap.get(combo.split('+').pop()!) : undefined)
  if (!id) return false
  // An installed site's window has one page, so only what acts on that page applies.
  if (actions.appWindow && !(SHORTCUTS.find((shortcut) => shortcut.id === id) as { app?: boolean }).app) return false
  runShortcut(id, actions)
  return true
}

function runShortcut(id: ShortcutId, actions: BrowserActions): void {
  const { tabs } = actions
  const active = tabs.active
  const onActive = (action: (id: number) => void) => void (active && action(active.id))
  switch (id) {
    case 'new-tab':
      return void tabs.create()
    case 'close-tab':
      return onActive((tab) => tabs.close(tab))
    case 'reopen-tab':
      return tabs.reopenClosed()
    case 'next-tab':
    case 'previous-tab': {
      const step = id === 'next-tab' ? 1 : -1
      return actions.recentTabOrder() ? tabs.activateRecent(step) : tabs.activateRelative(step)
    }
    case 'search-tabs':
      return actions.searchTabs()
    case 'new-window':
      return actions.openWindow()
    case 'private-window':
      return actions.openPrivateWindow()
    case 'fullscreen':
      return actions.toggleFullscreen()
    case 'quit':
      return actions.quit()
    case 'reload':
      return onActive((tab) => tabs.reload(tab, false))
    case 'hard-reload':
      return onActive((tab) => tabs.reload(tab, true))
    case 'back':
      return onActive((tab) => tabs.back(tab))
    case 'forward':
      return onActive((tab) => tabs.forward(tab))
    case 'home':
      return actions.goHome()
    case 'zoom-in':
      return onActive((tab) => tabs.zoomBy(tab, 1))
    case 'zoom-out':
      return onActive((tab) => tabs.zoomBy(tab, -1))
    case 'zoom-reset':
      return onActive((tab) => tabs.setZoom(tab, actions.defaultZoom()))
    case 'print':
      return onActive((tab) => tabs.print(tab))
    case 'save-page':
      return actions.savePage()
    case 'reader':
      return actions.toggleReader()
    case 'screenshot':
      return actions.screenshot()
    case 'view-source':
      return actions.viewSource()
    case 'devtools':
      return onActive((tab) => tabs.toggleDevTools(tab))
    case 'address-bar':
      return actions.focusOmnibox()
    case 'find':
      return actions.openFind()
    case 'palette':
      return actions.togglePalette()
    case 'link-hints':
      return actions.linkHints()
    case 'open-file':
      return actions.openFile()
    case 'assistant':
      return actions.toggleAssistant()
    case 'bookmark':
      return actions.toggleBookmark()
    case 'bookmarks-bar':
      return actions.toggleBookmarksBar()
    case 'bookmarks':
      return actions.openPage('bookmarks')
    case 'history':
      return actions.openPage('history')
    case 'downloads':
      return actions.openPage('downloads')
    case 'settings':
      return actions.openPage('settings')
    case 'clear-data':
      return actions.clearBrowsingData()
    case 'passwords':
      return actions.passwordMenu()
    case 'task-manager':
      return actions.openPage('tasks')
  }
}

export function attachShortcuts(contents: WebContents, actions: BrowserActions): void {
  contents.on('before-input-event', (event, input) => {
    if (recording.has(contents)) return
    if (handleShortcut(input, actions)) event.preventDefault()
  })
}
