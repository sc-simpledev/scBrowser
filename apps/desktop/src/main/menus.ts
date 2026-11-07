import { clipboard, Menu, MenuItem, nativeImage, type NativeImage, type BaseWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { RewriteStyle } from '@scbrowser/ai'
import { appScheme, CONTAINERS, TRANSLATE_LANGUAGES, effectiveUrl, folderTree, isJavascriptUrl, summarisePromptFor, type BarItem, type Bookmark, type BookmarkGroup, type TabId, type UpdateState } from '@scbrowser/shared'
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

/** The usual language first, which also takes a translated page back to the original. */
function translateRows(actions: BrowserActions): MenuItemConstructorOptions[] {
  const usual = actions.translateLanguage()
  return [
    { label: `Into ${usual} (or back to the original)`, click: () => actions.translatePage() },
    { type: 'separator' },
    ...TRANSLATE_LANGUAGES.filter((language) => language !== usual).map((language) => ({ label: language, click: () => actions.translatePage(language) }))
  ]
}

/** Text from a page, cut to fit a menu row. On Windows and Linux an ampersand would mark a shortcut key. */
function quoted(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const short = line.length > 28 ? `${line.slice(0, 28)}…` : line
  return `“${process.platform === 'darwin' ? short : short.replaceAll('&', '&&')}”`
}

function pageMenu(contents: WebContents, params: ContextMenuParams, actions: BrowserActions): MenuItemConstructorOptions[] {
  const { tabs } = actions
  const openInTab = (url: string) => tabs.create(url, { activate: false, afterId: tabs.active?.id, container: tabs.active?.container })
  const groups: MenuItemConstructorOptions[][] = []
  const isWeb = (url: string) => /^https?:/i.test(url)
  const sourcePage = /^(https?|file):/i.test(params.pageURL)
  const secret = params.formControlType === 'input-password'
  const selection = params.selectionText.trim()

  if (isWeb(params.linkURL)) {
    groups.push([
      { label: 'Open link in new tab', click: () => openInTab(params.linkURL) },
      { label: 'Open link in new window', click: () => actions.openWindow(params.linkURL, tabs.active?.container) },
      { label: 'Open link in split view', click: () => tabs.startSplit(openInTab(params.linkURL)) },
      { label: 'Preview link', click: () => actions.previewLink(params.linkURL, contents) },
      { label: 'Save link as…', click: () => contents.downloadURL(params.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
      ...(params.linkText.trim() ? [{ label: 'Copy link text', click: () => clipboard.writeText(params.linkText.trim()) }] : [])
    ])
  } else if (appScheme(params.linkURL)) {
    groups.push([
      { label: 'Open link in app', click: () => actions.openAppLink(params.linkURL, params.pageURL, contents) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) }
    ])
  }
  if (params.mediaType === 'image' && params.srcURL) {
    groups.push([
      { label: 'Open image in new tab', click: () => openInTab(params.srcURL) },
      { label: 'Save image as…', click: () => contents.downloadURL(params.srcURL) },
      { label: 'Copy image', click: () => contents.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }
    ])
  }
  if (params.mediaType === 'video' || params.mediaType === 'audio') {
    const kind = params.mediaType
    groups.push([
      // Streams play from `blob:` addresses, which mean nothing outside the page.
      ...(isWeb(params.srcURL)
        ? [
            { label: `Open ${kind} in new tab`, click: () => openInTab(params.srcURL) },
            { label: `Save ${kind} as…`, click: () => contents.downloadURL(params.srcURL) },
            { label: `Copy ${kind} address`, click: () => clipboard.writeText(params.srcURL) }
          ]
        : []),
      ...(kind === 'video'
        ? [
            {
              label: 'Picture in picture',
              // Browsers only allow this from a user gesture, which the second argument vouches for.
              click: () => void contents.executeJavaScript(`(document.elementFromPoint(${Math.round(params.x)}, ${Math.round(params.y)})?.closest('video') ?? document.querySelector('video'))?.requestPictureInPicture()`, true).catch(() => undefined)
            }
          ]
        : [])
    ])
  }
  if (params.misspelledWord) {
    groups.push([
      ...(params.dictionarySuggestions.length > 0
        ? params.dictionarySuggestions.slice(0, 5).map((word) => ({ label: word, click: () => contents.replaceMisspelling(word) }))
        : [{ label: 'No suggestions', enabled: false }]),
      { type: 'separator' as const },
      { label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }
    ])
  }
  if (params.isEditable) {
    if (params.selectionText && !secret) {
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
      { role: 'pasteAndMatchStyle', label: 'Paste as plain text', enabled: params.editFlags.canPaste },
      { role: 'selectAll', label: 'Select all' },
      ...(secret ? [] : [{ type: 'separator' as const }, ...actions.autofillRows(contents), { type: 'checkbox' as const, label: 'Check spelling', checked: actions.spellCheck.enabled(), click: actions.spellCheck.toggle }])
    ])
  } else if (selection) {
    groups.push([
      { role: 'copy', label: 'Copy' },
      { label: `Search for ${quoted(selection)}`, click: () => actions.searchWeb(selection) },
      {
        label: 'Ask about selection',
        click: () => actions.askAssistant({ text: '', selection: params.selectionText, includePage: false })
      },
      ...(isWeb(params.pageURL) || params.pageURL.startsWith('file:') ? [{ label: 'Highlight', click: () => actions.highlight(contents, params.selectionText) }] : [])
    ])
  }
  if (groups.length === 0) {
    const { navigationHistory: history } = contents
    groups.push([
      { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
      { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
      // Through the tab where there is one, as a failed page reloads the address that failed.
      {
        label: 'Reload',
        click: () => {
          const id = tabs.tabIdFor(contents)
          if (id === null) contents.reload()
          else tabs.reload(id)
        }
      }
    ])
    groups.push([
      ...(isWeb(params.pageURL) ? [{ label: 'Save page as…', click: () => contents.downloadURL(params.pageURL) }] : []),
      {
        label: 'Print…',
        click: () => {
          const id = tabs.tabIdFor(contents)
          if (id === null) contents.print()
          else tabs.print(id)
        }
      },
      { label: 'Screenshot', click: actions.screenshot },
      { label: 'Bookmark this page', click: actions.toggleBookmark },
      { label: 'Copy page address', click: () => clipboard.writeText(params.pageURL) }
    ])
    if (isWeb(params.pageURL)) {
      groups.push([
        { label: 'Add to reading list', click: actions.addToReadingList },
        { label: 'Add page to the sidebar', click: actions.addToSidebar },
        { label: 'Watch for changes', submenu: [
          { label: 'The whole page', click: () => actions.watchPage(false) },
          { label: 'Pick a part…', click: () => actions.watchPage(true) },
          { type: 'separator' },
          { label: 'Watched pages…', click: () => actions.openPage('watching') }
        ] },
        { label: 'Hide part of this page…', click: actions.hidePart },
        ...(actions.hasHiddenParts(params.pageURL) ? [{ label: 'Show hidden parts again', click: actions.showHiddenParts }] : []),
        { label: 'Forget this site…', click: actions.forgetSite }
      ])
    }
    if (sourcePage) {
      groups.push([
        { label: 'Reader view', click: actions.toggleReader },
        {
          label: 'Summarise page',
          click: () => actions.askAssistant({ text: summarisePromptFor(params.pageURL), selection: null, includePage: true })
        },
        { label: 'Translate page', submenu: translateRows(actions) }
      ])
    }
  }
  groups.push([
    ...(sourcePage ? [{ label: 'View page source', accelerator: 'CmdOrCtrl+U', click: () => tabs.create(`view-source:${params.pageURL}`, { afterId: tabs.tabIdFor(contents) ?? undefined, container: tabs.active?.container }) }] : []),
    { label: 'Inspect', click: () => tabs.inspect(contents, params.x, params.y) }
  ])

  return groups.flatMap((group, i) => (i === 0 ? group : [{ type: 'separator' as const }, ...group]))
}

export function popupTabMenu(id: TabId, actions: BrowserActions, window: BaseWindow): void {
  const { tabs } = actions
  const { splitIds, activeId, tabs: open } = tabs.snapshot()
  const tab = open.find((other) => other.id === id)
  Menu.buildFromTemplate([
    { label: 'New tab', click: () => tabs.create() },
    { label: 'Reload', click: () => tabs.reload(id) },
    { label: 'Duplicate', click: () => tabs.duplicate(id) },
    { label: tab?.pinned ? 'Unpin tab' : 'Pin tab', click: () => tabs.setPinned(id, !tab?.pinned) },
    { label: tab?.muted ? 'Unmute tab' : 'Mute tab', click: () => tabs.setMuted(id, !tab?.muted) },
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
    { label: 'Sleep tab', enabled: !tab?.isSleeping && open.length > 1, click: () => tabs.sleep(id) },
    { label: 'Archive tab', enabled: open.length > 1 && !tab?.pinned, click: () => actions.archiveTab(id) },
    { type: 'separator' },
    { label: 'Add to new group', enabled: !tab?.pinned, click: () => tabs.setGroup([id], tabs.freshGroupName()) },
    {
      label: 'Add to group',
      enabled: !tab?.pinned && tabs.groupNames().some((name) => name !== tab?.group),
      submenu: tabs.groupNames().filter((name) => name !== tab?.group).map((name) => ({ label: name, click: () => tabs.setGroup([id], name) }))
    },
    ...(tab?.group ? [{ label: 'Remove from group', click: () => tabs.setGroup([id], null) }] : []),
    { type: 'separator' },
    { label: 'Close', click: () => tabs.close(id) },
    { label: 'Close other tabs', click: () => tabs.closeOthers(id) },
    { type: 'separator' },
    { label: 'Organise tabs into groups', click: actions.organiseTabs },
    { label: 'Remove tab groups', click: () => tabs.clearGroups() },
    { label: 'Clean up tabs', click: actions.cleanupTabs },
    { label: 'Search tabs', accelerator: 'CmdOrCtrl+Shift+E', click: actions.searchTabs },
    { label: 'Reopen closed tab', click: () => tabs.reopenClosed() },
    ...closedGroupRows(actions)
  ]).popup({ window })
}

function closedGroupRows(actions: BrowserActions): MenuItemConstructorOptions[] {
  const groups = actions.closedGroups()
  if (groups.length === 0) return []
  return [
    {
      label: 'Reopen closed group',
      submenu: [
        ...groups.slice(0, 12).map((group) => ({ label: `${group.name}  (${group.tabs.length} ${group.tabs.length === 1 ? 'tab' : 'tabs'})`, click: () => actions.reopenGroup(group.id) })),
        { type: 'separator' as const },
        { label: 'All closed groups…', click: () => actions.openPage('archive') }
      ]
    }
  ]
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
    isJavascriptUrl(bookmark.url)
      ? { label: 'Run on this page', click: () => actions.tabs.active && actions.openAddress(actions.tabs.active.id, bookmark.url) }
      : { label: 'Open in new tab', click: () => actions.tabs.create(bookmark.url) },
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
  // Scripts run on the open page, so opening a whole folder leaves them out.
  const items = bookmarks.filter((bookmark) => bookmark.groupId === group.id && !isJavascriptUrl(bookmark.url))
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
        { label: 'Passwords', accelerator: 'CmdOrCtrl+Shift+L', click: actions.passwordMenu },
        { label: 'Extensions', submenu: actions.extensionMenu() },
        { label: 'Profiles', click: () => actions.openPage('settings') },
        { type: 'separator' }
      ]
    : []
  Menu.buildFromTemplate([
    ...updateRow,
    ...spareRows,
    { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => tabs.create() },
    { label: 'New window', accelerator: 'CmdOrCtrl+N', click: () => actions.openWindow() },
    { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => tabs.reopenClosed() },
    { label: 'Open file…', accelerator: 'CmdOrCtrl+O', click: actions.openFile },
    { label: 'Search tabs', accelerator: 'CmdOrCtrl+Shift+E', click: actions.searchTabs },
    { type: 'checkbox', label: 'Split view', checked: tabs.snapshot().splitIds.length > 0, enabled: tabs.snapshot().tabs.length > 1, click: () => tabs.toggleSplit() },
    { type: 'separator' },
    { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => actions.openPage('history') },
    { label: 'Assistant', accelerator: 'CmdOrCtrl+Shift+A', click: actions.toggleAssistant },
    { label: 'Code with AI (beta)', click: () => actions.openPage('code') },
    { label: 'New private window', accelerator: 'CmdOrCtrl+Shift+N', click: actions.openPrivateWindow },
    { label: 'VPN', click: () => actions.openPage('vpn') },
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
    { label: 'View page source', accelerator: 'CmdOrCtrl+U', enabled: !!active && /^(https?|file):/i.test(effectiveUrl(active.url)), click: actions.viewSource },
    { label: 'Translate page', enabled: !!active && /^https?:/i.test(active.url), submenu: translateRows(actions) },
    { label: 'Install this site as an app…', enabled: !!active && /^https?:/i.test(effectiveUrl(active.url)), click: actions.installApp },
    { type: 'checkbox', label: 'Performance Mode', checked: actions.performanceMode.enabled(), click: actions.performanceMode.toggle },
    { label: 'Task Manager', accelerator: 'Shift+Esc', click: () => actions.openPage('tasks') },
    { label: 'Developer tools', accelerator: 'F12', click: onActive((id) => tabs.toggleDevTools(id)) },
    { type: 'separator' },
    { label: 'Settings', click: () => actions.openPage('settings') },
    { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: actions.quit }
  ]).popup({ window, x: Math.round(x), y: Math.round(y) })
}
