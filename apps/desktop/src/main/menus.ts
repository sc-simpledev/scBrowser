import { clipboard, Menu, MenuItem, nativeImage, type NativeImage, type BaseWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { RewriteStyle } from '@scbrowser/ai'
import { CONTAINERS, folderTree, SUMMARISE_PROMPT, type BarItem, type Bookmark, type BookmarkGroup, type TabId, type UpdateState } from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import { listProfiles, openProfile } from './profiles'
import type { BookmarksRepo } from './storage/bookmarks'

export function attachPageMenu(
  contents: WebContents,
  actions: BrowserActions,
  window: BaseWindow,
  extensionItems: (contents: WebContents, params: ContextMenuParams) => Electron.MenuItem[]
): void {
  contents.on('context-menu', (_event, params) => {
    const template = pageMenu(contents, params, actions)
    const added = extensionItems(contents, params)
    if (template.length === 0 && added.length === 0) return
    const menu = Menu.buildFromTemplate(template)
    if (template.length > 0 && added.length > 0) menu.append(new MenuItem({ type: 'separator' }))
    added.forEach((item) => menu.append(item))
    menu.popup({ window })
  })
}

function pageMenu(contents: WebContents, params: ContextMenuParams, actions: BrowserActions): MenuItemConstructorOptions[] {
  const { tabs } = actions
  const openInTab = (url: string) => tabs.create(url, { activate: false, afterId: tabs.active?.id, container: tabs.active?.container })
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
  if (params.mediaType === 'video') {
    groups.push([
      {
        label: 'Picture in picture',
        // Browsers only allow this from a user gesture, which the second argument vouches for.
        click: () => void contents.executeJavaScript('document.querySelector("video")?.requestPictureInPicture()', true).catch(() => undefined)
      }
    ])
  }
  if (params.isEditable) {
    if (params.selectionText && params.formControlType !== 'input-password') {
      const rewrite = (label: string, style: RewriteStyle) => ({ label, click: () => actions.rewrite(contents, params.selectionText, style) })
      groups.push([
        {
          label: 'Rewrite',
          submenu: [rewrite('Proofread', 'proofread'), rewrite('Shorter', 'shorter'), rewrite('Friendlier', 'friendlier'), rewrite('More formal', 'formal')]
        }
      ])
    }
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
    groups.push([
      { role: 'copy', label: 'Copy' },
      {
        label: 'Ask about selection',
        click: () => actions.askAssistant({ text: '', selection: params.selectionText, includePage: false })
      }
    ])
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
    if (/^(https?|file):/i.test(params.pageURL)) {
      groups.push([
        {
          label: 'Summarise page',
          click: () => actions.askAssistant({ text: SUMMARISE_PROMPT, selection: null, includePage: true })
        },
        { label: 'Translate page', click: actions.translatePage }
      ])
    }
  }
  groups.push([{ label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) }])

  return groups.flatMap((group, i) => (i === 0 ? group : [{ type: 'separator' as const }, ...group]))
}

export function popupTabMenu(id: TabId, actions: BrowserActions, window: BaseWindow): void {
  const { tabs } = actions
  const { splitIds, activeId } = tabs.snapshot()
  Menu.buildFromTemplate([
    { label: 'New tab', click: () => tabs.create() },
    { label: 'Reload', click: () => tabs.reload(id) },
    { label: 'Duplicate', click: () => tabs.duplicate(id) },
    splitIds.length > 0
      ? { label: 'End split view', click: () => tabs.endSplit() }
      : { label: 'Open in split view', enabled: id !== activeId, click: () => tabs.startSplit(id) },
    {
      label: 'Open in container',
      submenu: [
        ...CONTAINERS.map((container) => ({ label: container.name, click: () => tabs.reopenInContainer(id, container.id) })),
        { type: 'separator' as const },
        { label: 'No container', click: () => tabs.reopenInContainer(id, null) }
      ]
    },
    { type: 'separator' },
    { label: 'Close', click: () => tabs.close(id) },
    { label: 'Close other tabs', click: () => tabs.closeOthers(id) },
    { type: 'separator' },
    { label: 'Organise tabs into groups', click: actions.organiseTabs },
    { label: 'Remove tab groups', click: () => tabs.clearGroups() },
    { label: 'Clean up tabs', click: actions.cleanupTabs },
    { label: 'Reopen closed tab', click: () => tabs.reopenClosed() }
  ]).popup({ window })
}

interface BookmarkMenuHooks {
  repo: BookmarksRepo
  onChange: () => void
  actions: BrowserActions
  window: BaseWindow
  edit: (bookmark: Bookmark) => void
}

export function popupBookmarkMenu(bookmark: Bookmark, { repo, onChange, actions, window, edit }: BookmarkMenuHooks): void {
  const move = (groupId: number | null) => {
    repo.setGroup(bookmark.id, groupId)
    onChange()
  }
  const groups = repo.groups()
  Menu.buildFromTemplate([
    { label: 'Open in new tab', click: () => actions.tabs.create(bookmark.url) },
    { label: 'Edit…', click: () => edit(bookmark) },
    { label: 'Copy address', click: () => clipboard.writeText(bookmark.url) },
    { type: 'separator' },
    {
      label: 'Move to folder',
      submenu: [
        { label: 'None', type: 'radio', checked: bookmark.groupId === null, click: () => move(null) },
        ...folderTree(groups).map(({ group, path }) => ({ label: path, type: 'radio' as const, checked: bookmark.groupId === group.id, click: () => move(group.id) })),
        { type: 'separator' },
        { label: 'Manage folders…', click: () => actions.openPage('bookmarks') }
      ]
    },
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

/** Native menus can't draw every format, such as SVG, so some rows go without. */
function menuIcon(icon: string | null | undefined): NativeImage | undefined {
  const image = icon ? nativeImage.createFromDataURL(icon) : null
  return image && !image.isEmpty() ? image.resize({ width: 16, height: 16 }) : undefined
}

/** A folder's contents as menu rows: subfolders first, each opening to the side. */
function folderRows(id: number, bookmarks: Bookmark[], groups: BookmarkGroup[], open: (url: string) => void): MenuItemConstructorOptions[] {
  const rows: MenuItemConstructorOptions[] = [
    ...groups.filter((group) => group.parentId === id).map((group) => ({ label: group.name, submenu: folderRows(group.id, bookmarks, groups, open) })),
    ...bookmarks.filter((bookmark) => bookmark.groupId === id).map((bookmark) => ({ label: bookmark.title || bookmark.url, icon: menuIcon(bookmark.icon), click: () => open(bookmark.url) }))
  ]
  return rows.length > 0 ? rows : [{ label: 'Nothing here yet', enabled: false }]
}

/** A folder drops down from the bar. Native menus draw above pages. */
export function popupBookmarkGroup(group: BookmarkGroup, hooks: BookmarkMenuHooks, open: (url: string) => void, x: number, y: number): void {
  const { repo, actions, window } = hooks
  const bookmarks = repo.list()
  const items = bookmarks.filter((bookmark) => bookmark.groupId === group.id)
  Menu.buildFromTemplate([
    ...folderRows(group.id, bookmarks, repo.groups(), open),
    ...(items.length > 1
      ? [{ type: 'separator' as const }, { label: `Open all ${items.length}`, click: () => items.forEach((bookmark) => actions.tabs.create(bookmark.url)) }]
      : []),
    { type: 'separator' },
    { label: 'Manage folders…', click: () => actions.openPage('bookmarks') }
  ]).popup({ window, x: Math.round(x), y: Math.round(y) })
}

/** What doesn't fit on the bookmarks bar. Folders open as submenus. */
export function popupBookmarkOverflow(items: BarItem[], hooks: BookmarkMenuHooks, open: (url: string) => void, x: number, y: number): void {
  const { repo, window } = hooks
  const bookmarks = repo.list()
  const groups = repo.groups()
  const template = items.flatMap(({ kind, id }): MenuItemConstructorOptions[] => {
    if (kind === 'bookmark') {
      const bookmark = bookmarks.find((b) => b.id === id)
      return bookmark ? [{ label: bookmark.title || bookmark.url, icon: menuIcon(bookmark.icon), click: () => open(bookmark.url) }] : []
    }
    const group = groups.find((g) => g.id === id)
    return group ? [{ label: group.name, submenu: folderRows(id, bookmarks, groups, open) }] : []
  })
  if (template.length > 0) Menu.buildFromTemplate(template).popup({ window, x: Math.round(x), y: Math.round(y) })
}

export function popupProfilesMenu(actions: BrowserActions, window: BaseWindow, x: number, y: number): void {
  const { current, names } = listProfiles()
  Menu.buildFromTemplate([
    ...names.map((name) => ({ label: name, type: 'radio' as const, checked: name === current, click: () => name !== current && openProfile(name) })),
    { type: 'separator' },
    { label: 'Manage profiles…', click: () => actions.openPage('settings') }
  ]).popup({ window, x: Math.round(x), y: Math.round(y) })
}

export function popupAppMenu(actions: BrowserActions, bookmarksBarAlways: boolean, update: UpdateState, compact: boolean, window: BaseWindow, x: number, y: number): void {
  const { tabs } = actions
  const active = tabs.active
  const onActive = (action: (id: TabId) => void) => () => active && action(active.id)
  const updateRow: MenuItemConstructorOptions[] =
    update.phase === 'ready' || update.phase === 'manual'
      ? [{ label: update.phase === 'ready' ? `Restart to update to ${update.version}` : `Get version ${update.version}`, click: actions.installUpdate }, { type: 'separator' }]
      : []
  // A narrow toolbar hides these buttons, so they're here instead of squashed.
  const spareRows: MenuItemConstructorOptions[] = compact
    ? [
        { label: 'Bookmark this page', accelerator: 'CmdOrCtrl+D', click: actions.toggleBookmark },
        { label: 'VPN', click: () => actions.openPage('vpn') },
        { label: 'Passwords', accelerator: 'CmdOrCtrl+Shift+L', click: actions.passwordMenu },
        { label: 'Extensions and profiles', click: () => actions.openPage('settings') },
        { type: 'separator' }
      ]
    : []
  Menu.buildFromTemplate([
    ...updateRow,
    ...spareRows,
    { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => tabs.create() },
    { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => tabs.reopenClosed() },
    { type: 'separator' },
    { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => actions.openPage('history') },
    { label: 'Assistant', accelerator: 'CmdOrCtrl+Shift+A', click: actions.toggleAssistant },
    { label: 'New private window', accelerator: 'CmdOrCtrl+Shift+N', click: actions.openPrivateWindow },
    { type: 'separator' },
    { label: 'Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => actions.openPage('bookmarks') },
    { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => actions.openPage('downloads') },
    { type: 'checkbox', label: 'Bookmarks bar', accelerator: 'CmdOrCtrl+Shift+B', checked: bookmarksBarAlways, click: actions.toggleBookmarksBar },
    { type: 'separator' },
    { label: 'Find in page…', accelerator: 'CmdOrCtrl+F', click: actions.openFind },
    { label: 'Reader view', accelerator: 'F9', click: actions.toggleReader },
    { label: 'Command palette', accelerator: 'CmdOrCtrl+K', click: actions.togglePalette },
    { label: 'Screenshot', accelerator: 'CmdOrCtrl+Shift+S', click: actions.screenshot },
    { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: onActive((id) => tabs.print(id)) },
    {
      label: `Zoom (${active?.zoomPercent ?? 100}%)`,
      submenu: [
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: onActive((id) => tabs.zoomBy(id, 1)) },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: onActive((id) => tabs.zoomBy(id, -1)) },
        { label: 'Reset', accelerator: 'CmdOrCtrl+0', click: onActive((id) => tabs.setZoom(id, 1)) }
      ]
    },
    { label: 'Full screen', accelerator: 'F11', click: actions.toggleFullscreen },
    { label: 'Developer tools', accelerator: 'F12', click: onActive((id) => tabs.toggleDevTools(id)) },
    { type: 'separator' },
    { label: 'Settings', click: () => actions.openPage('settings') },
    { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: actions.quit }
  ]).popup({ window, x: Math.round(x), y: Math.round(y) })
}
