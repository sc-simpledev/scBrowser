import { clipboard, Menu, type BaseWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { Bookmark, TabId } from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import type { BookmarksRepo } from './storage/bookmarks'

export function attachPageMenu(contents: WebContents, actions: BrowserActions, window: BaseWindow): void {
  contents.on('context-menu', (_event, params) => {
    const template = pageMenu(contents, params, actions)
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window })
  })
}

function pageMenu(contents: WebContents, params: ContextMenuParams, { tabs }: BrowserActions): MenuItemConstructorOptions[] {
  const openInTab = (url: string) => tabs.create(url, { activate: false, afterId: tabs.active?.id })
  const groups: MenuItemConstructorOptions[][] = []

  if (params.linkURL && /^https?:/i.test(params.linkURL)) {
    groups.push([
      { label: 'Open link in new tab', click: () => openInTab(params.linkURL) },
      { label: 'Save link as…', click: () => contents.downloadURL(params.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) }
    ])
  }
  if (params.mediaType === 'image' && params.srcURL) {
    groups.push([
      { label: 'Open image in new tab', click: () => openInTab(params.srcURL) },
      { label: 'Save image as…', click: () => contents.downloadURL(params.srcURL) },
      { label: 'Copy image', click: () => contents.copyImageAt(params.x, params.y) }
    ])
  }
  if (params.isEditable) {
    groups.push([
      { role: 'undo', label: 'Undo', enabled: params.editFlags.canUndo },
      { role: 'redo', label: 'Redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Cut', enabled: params.editFlags.canCut },
      { role: 'copy', label: 'Copy', enabled: params.editFlags.canCopy },
      { role: 'paste', label: 'Paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', label: 'Select all' }
    ])
  } else if (params.selectionText) {
    groups.push([{ role: 'copy', label: 'Copy' }])
  }
  if (groups.length === 0) {
    const { navigationHistory: history } = contents
    groups.push([
      { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
      { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
      { label: 'Reload', click: () => contents.reload() },
      { type: 'separator' },
      { label: 'Print…', click: () => contents.print() }
    ])
  }
  groups.push([{ label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) }])

  return groups.flatMap((group, i) => (i === 0 ? group : [{ type: 'separator' as const }, ...group]))
}

export function popupTabMenu(id: TabId, actions: BrowserActions, window: BaseWindow): void {
  const { tabs } = actions
  Menu.buildFromTemplate([
    { label: 'New tab', click: () => tabs.create() },
    { label: 'Reload', click: () => tabs.reload(id) },
    { label: 'Duplicate', click: () => tabs.duplicate(id) },
    { type: 'separator' },
    { label: 'Close', click: () => tabs.close(id) },
    { label: 'Close other tabs', click: () => tabs.closeOthers(id) },
    { label: 'Reopen closed tab', click: () => tabs.reopenClosed() }
  ]).popup({ window })
}

export function popupBookmarkMenu(bookmark: Bookmark, repo: BookmarksRepo, onChange: () => void, actions: BrowserActions, window: BaseWindow): void {
  Menu.buildFromTemplate([
    { label: 'Open in new tab', click: () => actions.tabs.create(bookmark.url) },
    { label: 'Copy address', click: () => clipboard.writeText(bookmark.url) },
    { type: 'separator' },
    {
      label: 'Delete',
      click: () => {
        repo.remove(bookmark.id)
        onChange()
      }
    }
  ]).popup({ window })
}

export function popupAppMenu(actions: BrowserActions, showBookmarksBar: boolean, window: BaseWindow, x: number, y: number): void {
  const { tabs } = actions
  const active = tabs.active
  const onActive = (action: (id: TabId) => void) => () => active && action(active.id)
  Menu.buildFromTemplate([
    { label: 'New tab', accelerator: 'Ctrl+T', click: () => tabs.create() },
    { label: 'Reopen closed tab', accelerator: 'Ctrl+Shift+T', click: () => tabs.reopenClosed() },
    { type: 'separator' },
    { label: 'History', accelerator: 'Ctrl+H', click: () => actions.openPage('history') },
    { label: 'Bookmarks', accelerator: 'Ctrl+Shift+O', click: () => actions.openPage('bookmarks') },
    { label: 'Downloads', accelerator: 'Ctrl+J', click: () => actions.openPage('downloads') },
    { type: 'checkbox', label: 'Bookmarks bar', accelerator: 'Ctrl+Shift+B', checked: showBookmarksBar, click: actions.toggleBookmarksBar },
    { type: 'separator' },
    { label: 'Find in page…', accelerator: 'Ctrl+F', click: actions.openFind },
    { label: 'Print…', accelerator: 'Ctrl+P', click: onActive((id) => tabs.print(id)) },
    {
      label: `Zoom (${active?.zoomPercent ?? 100}%)`,
      submenu: [
        { label: 'Zoom in', accelerator: 'Ctrl+=', click: onActive((id) => tabs.zoomBy(id, 1)) },
        { label: 'Zoom out', accelerator: 'Ctrl+-', click: onActive((id) => tabs.zoomBy(id, -1)) },
        { label: 'Reset', accelerator: 'Ctrl+0', click: onActive((id) => tabs.setZoom(id, 1)) }
      ]
    },
    { label: 'Full screen', accelerator: 'F11', click: actions.toggleFullscreen },
    { label: 'Developer tools', accelerator: 'F12', click: onActive((id) => tabs.toggleDevTools(id)) },
    { type: 'separator' },
    { label: 'Settings', click: () => actions.openPage('settings') },
    { label: 'Quit', accelerator: 'Ctrl+Q', click: actions.quit }
  ]).popup({ window, x: Math.round(x), y: Math.round(y) })
}
