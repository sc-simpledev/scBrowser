import { keyFor } from './shortcuts'
import { clipboard, Menu, MenuItem, nativeImage, type NativeImage, type BaseWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { RewriteStyle } from '@scbrowser/ai'
import { SNOOZE_CHOICES, SNOOZE_LABELS, snoozeUntil, appScheme, CONTAINERS, isVideoPage, MAX_MENTIONED_TABS, presetById, presetPrompt, videoReportPrompt, TRANSLATE_LANGUAGES, effectiveUrl, folderTree, isJavascriptUrl, summarisePromptFor, treeFolds, resolveOmniboxInput, DEFAULT_SEARCH_ENGINE, cleanUrl, highlightLink, type BarItem, type Bookmark, type BookmarkGroup, type TabId, type UpdateState } from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import { listProfiles, openProfile } from './profiles'
import type { BookmarksRepo } from './storage/bookmarks'

/** Quick things to ask about selected words, sent straight to the sidebar assistant. */
const SELECTION_PROMPTS = [
  { label: 'Explain', text: 'Explain the selected text simply.' },
  { label: 'Summarise', text: 'Summarise the selected text in a few bullet points.' },
  { label: 'Simplify', text: 'Rewrite the selected text in plain, simple English.' },
  { label: 'Translate to English', text: 'Translate the selected text into English.' },
  { label: 'Check the facts', text: 'Which claims in the selected text can be checked, and are they right? Say what you are unsure of.' }
]

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
      // Only where there's something to take off, like utm_source or fbclid.
      ...(cleanUrl(params.linkURL) !== params.linkURL ? [{ label: 'Copy clean link', click: () => clipboard.writeText(cleanUrl(params.linkURL)) }] : []),
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
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
      ...(sourcePage ? [{ type: 'separator' as const }, { label: 'Ask AI about this image', click: () => actions.askAboutImage(contents, params.srcURL, params.x, params.y) }] : [])
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
        label: 'Ask AI',
        submenu: [
          { label: 'Ask about selection…', click: () => actions.askAssistant({ text: '', selection: params.selectionText, includePage: false }) },
          { type: 'separator' as const },
          ...SELECTION_PROMPTS.map(({ label, text }) => ({ label, click: () => actions.askAssistant({ text, selection: params.selectionText, includePage: false }) })),
          // Only the selected words go along, as the material for the notes.
          { label: 'Make study notes from this', click: () => actions.askAssistant({ text: presetPrompt(presetById('study')!, 'the selected text', false), selection: params.selectionText, includePage: false }) },
          { label: 'Explain with the page for context', click: () => actions.askAssistant({ text: 'Explain the selected text, using the rest of the page for context.', selection: params.selectionText, includePage: true }) }
        ]
      },
      ...(isWeb(params.pageURL) || params.pageURL.startsWith('file:') ? [{ label: 'Highlight', click: () => actions.highlight(contents, params.selectionText) }] : []),
      ...(highlightLink(params.pageURL, selection)
        ? [
            {
              label: 'Copy link to highlight',
              click: () => {
                clipboard.writeText(highlightLink(cleanUrl(params.pageURL), selection)!)
                actions.notify('Link copied. It opens the page at these words')
              }
            }
          ]
        : [])
    ])
  }
  if (groups.length === 0) {
    const { navigationHistory: history } = contents
    groups.push([
      { label: 'Back', accelerator: keyFor('back'), registerAccelerator: false, enabled: history.canGoBack(), click: () => history.goBack() },
      { label: 'Forward', accelerator: keyFor('forward'), registerAccelerator: false, enabled: history.canGoForward(), click: () => history.goForward() },
      // Through the tab where there is one, as a failed page reloads the address that failed.
      {
        label: 'Reload',
        accelerator: keyFor('reload'),
        registerAccelerator: false, 
        click: () => {
          const id = tabs.tabIdFor(contents)
          if (id === null) contents.reload()
          else tabs.reload(id)
        }
      }
    ])
    groups.push([
      ...(isWeb(params.pageURL) ? [{ label: 'Save page as…', accelerator: keyFor('save-page'), registerAccelerator: false, click: actions.savePage }] : []),
      {
        label: 'Print…',
        accelerator: keyFor('print'),
        registerAccelerator: false, 
        click: () => {
          const id = tabs.tabIdFor(contents)
          if (id === null) contents.print()
          else tabs.print(id)
        }
      },
      { label: 'Screenshot', accelerator: keyFor('screenshot'), registerAccelerator: false, click: actions.screenshot },
      ...(isWeb(params.pageURL) ? [{ label: 'Ask AI about part of the page…', click: actions.askAboutRegion }] : []),
      { label: 'Bookmark this page', accelerator: keyFor('bookmark'), registerAccelerator: false, click: actions.toggleBookmark },
      { label: 'Copy page address', click: () => clipboard.writeText(params.pageURL) },
      ...(cleanUrl(params.pageURL) !== params.pageURL ? [{ label: 'Copy clean page address', click: () => clipboard.writeText(cleanUrl(params.pageURL)) }] : []),
      ...(isWeb(params.pageURL) ? [{ label: 'QR code for this page', click: actions.showQr }] : [])
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
        { label: 'Change how this site looks with AI…', click: actions.tweakSiteHelp },
        ...(actions.hasHiddenParts(params.pageURL) ? [{ label: 'Show hidden parts again', click: actions.showHiddenParts }] : []),
        { label: 'Forget this site…', click: actions.forgetSite }
      ])
    }
    if (sourcePage) {
      groups.push([
        { label: 'Reader view', accelerator: keyFor('reader'), registerAccelerator: false, click: actions.toggleReader },
        { label: 'Read aloud', click: actions.readAloud },
        {
          label: 'Summarise page',
          click: () => actions.askAssistant({ text: summarisePromptFor(params.pageURL), selection: null, includePage: true })
        },
        ...(isVideoPage(params.pageURL)
          ? [
              {
                label: 'Make a report from this video',
                // Its transcript goes along as the page, so the report's times can be jumped to.
                submenu: ['study', 'brief', 'explainer'].flatMap((id) => {
                  const preset = presetById(id)
                  return preset ? [{ label: preset.name, click: () => actions.askAssistant({ text: videoReportPrompt(preset), selection: null, includePage: true }) }] : []
                })
              }
            ]
          : []),
        { label: 'Translate page', submenu: translateRows(actions) }
      ])
    }
  }
  groups.push([
    ...(sourcePage ? [{ label: 'View page source', accelerator: keyFor('view-source'), click: () => tabs.create(`view-source:${params.pageURL}`, { afterId: tabs.tabIdFor(contents) ?? undefined, container: tabs.active?.container }) }] : []),
    { label: 'Inspect', accelerator: keyFor('devtools'), registerAccelerator: false, click: () => tabs.inspect(contents, params.x, params.y) }
  ])

  return groups.flatMap((group, i) => (i === 0 ? group : [{ type: 'separator' as const }, ...group]))
}

export function popupTabMenu(id: TabId, actions: BrowserActions, window: BaseWindow): void {
  const { tabs } = actions
  const { splitIds, activeId, tabs: open } = tabs.snapshot()
  const tab = open.find((other) => other.id === id)
  Menu.buildFromTemplate([
    { label: 'New tab', accelerator: keyFor('new-tab'), registerAccelerator: false, click: () => tabs.create() },
    { label: 'Reload', accelerator: keyFor('reload'), registerAccelerator: false, click: () => tabs.reload(id) },
    { label: 'Duplicate', click: () => tabs.duplicate(id) },
    { label: tab?.pinned ? 'Unpin tab' : 'Pin tab', click: () => tabs.setPinned(id, !tab?.pinned) },
    { label: tab?.muted ? 'Unmute tab' : 'Mute tab', click: () => tabs.setMuted(id, !tab?.muted) },
    ...(tab && /^https?:/i.test(tab.url) ? [{ label: actions.siteMuted(tab.url) ? 'Unmute site' : 'Mute site', click: () => actions.toggleSiteMute(id) }] : []),
    ...(treeFolds(open).parents.has(id) ? [{ label: tab?.collapsed ? 'Expand branch' : 'Collapse branch', click: () => tabs.toggleCollapsed(id) }] : []),
    { type: 'separator' },
    splitIds.length > 0
      ? { label: 'End split view', click: () => tabs.endSplit() }
      : { label: 'Open in split view', enabled: id !== activeId, click: () => tabs.startSplit(id) },
    {
      label: 'Move to window',
      submenu: [
        { label: 'New window', click: () => actions.moveTabToWindow(id, 'new') },
        ...actions.otherWindows().map((other) => ({ label: other.title.length > 50 ? `${other.title.slice(0, 49)}…` : other.title, click: () => actions.moveTabToWindow(id, other.index) }))
      ]
    },
    {
      label: 'Open in container',
      submenu: [
        ...CONTAINERS.map((container) => ({ label: container.name, click: () => tabs.reopenInContainer(id, container.id) })),
        { type: 'separator' as const },
        { label: 'No container', click: () => tabs.reopenInContainer(id, null) }
      ]
    },
    { type: 'separator' },
    {
      label: 'Snooze tab',
      enabled: open.length > 1 && !tab?.pinned && /^(https?|file):/i.test(tab?.url ?? ''),
      submenu: SNOOZE_CHOICES.filter((choice) => snoozeUntil(choice, Date.now()) !== null).map((choice) => ({ label: SNOOZE_LABELS[choice], click: () => actions.snoozeTab(id, choice) }))
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
    ...(tabs.groupNames().length > 0 ? [{ label: 'Remove all tab groups', click: () => tabs.clearGroups() }] : []),
    { type: 'separator' },
    {
      label: 'With AI',
      submenu: [
        ...researchRows(tab, open, tabs),
        { type: 'separator' as const },
        { label: 'Organise tabs into groups', click: actions.organiseTabs },
        { label: 'Tidy tab titles', click: actions.tidyTitles },
        ...(open.some((other) => other.shortTitle) ? [{ label: 'Show full tab titles', click: actions.restoreTitles }] : []),
        { label: 'Clean up tabs', click: actions.cleanupTabs }
      ]
    },
    { type: 'separator' },
    { label: 'Close', accelerator: keyFor('close-tab'), registerAccelerator: false, click: () => tabs.close(id) },
    // Pinned tabs stay when the others close, so only unpinned ones count.
    { label: 'Close other tabs', enabled: open.some((other) => other.id !== id && !other.pinned), click: () => tabs.closeOthers(id) },
    { label: actions.verticalTabs() ? 'Close tabs below' : 'Close tabs to the right', enabled: open.slice(open.findIndex((other) => other.id === id) + 1).some((other) => !other.pinned), click: () => tabs.closeAfter(id) },
    { label: 'Close duplicate tabs', click: actions.closeDuplicates },
    { label: 'Copy links of all tabs', click: () => actions.copyTabLinks() },
    { label: 'Bookmark all tabs…', accelerator: keyFor('bookmark-all-tabs'), click: actions.bookmarkAllTabs },
    { type: 'separator' },
    ...closedTabRows(tabs),
    { label: 'Search tabs', accelerator: keyFor('search-tabs'), click: actions.searchTabs },
    ...closedGroupRows(actions)
  ]).popup({ window })
}

/** For several tabs picked with Ctrl or Shift: what can be done to all of them at once. */
export function popupSelectionMenu(ids: TabId[], actions: BrowserActions, window: BaseWindow, done: () => void): void {
  const { tabs } = actions
  const { tabs: open, activeWorkspace, workspaces } = tabs.snapshot()
  const picked = open.filter((tab) => ids.includes(tab.id))
  if (picked.length === 0) return
  const count = `${picked.length} tabs`
  const readable = picked.filter((tab) => /^https?:/i.test(tab.url)).slice(0, MAX_MENTIONED_TABS)
  const unpinned = picked.filter((tab) => !tab.pinned).map((tab) => tab.id)
  const all = picked.map((tab) => tab.id)
  const then = (action: () => void) => () => {
    action()
    done()
  }
  Menu.buildFromTemplate([
    { label: `Add ${count} to a new group`, enabled: unpinned.length > 0, click: then(() => tabs.setGroup(unpinned, tabs.freshGroupName())) },
    ...(tabs.groupNames().length > 0 ? [{ label: 'Add to group', enabled: unpinned.length > 0, submenu: tabs.groupNames().map((name) => ({ label: name, click: then(() => tabs.setGroup(unpinned, name)) })) }] : []),
    ...(workspaces.length > 1 ? [{ label: 'Move to workspace', submenu: workspaces.filter((one) => one.id !== activeWorkspace).map((one) => ({ label: one.name, click: then(() => tabs.moveToWorkspace(all, one.id)) })) }] : []),
    { type: 'separator' },
    { label: `Ask AI about ${readable.length === picked.length ? 'these' : `the ${readable.length} web`} tabs`, enabled: readable.length > 0, click: then(() => tabs.create(`sc://assistant/?tabs=${readable.map((tab) => tab.id).join(',')}`)) },
    { label: 'Research them into one report', enabled: readable.length > 1, click: then(() => tabs.create(`sc://assistant/?preset=brief&tabs=${readable.map((tab) => tab.id).join(',')}`)) },
    { type: 'separator' },
    { label: picked.every((tab) => tab.pinned) ? `Unpin ${count}` : `Pin ${count}`, click: then(() => all.forEach((id) => tabs.setPinned(id, !picked.every((tab) => tab.pinned)))) },
    { label: picked.every((tab) => tab.muted) ? `Unmute ${count}` : `Mute ${count}`, click: then(() => all.forEach((id) => tabs.setMuted(id, !picked.every((tab) => tab.muted)))) },
    { label: `Reload ${count}`, click: then(() => all.forEach((id) => tabs.reload(id))) },
    { label: `Copy links of ${count}`, click: then(() => actions.copyTabLinks(all)) },
    { type: 'separator' },
    { label: `Close ${count}`, click: then(() => all.forEach((id) => tabs.close(id))) }
  ]).popup({ window })
}

type SnapshotTab = ReturnType<BrowserActions['tabs']['snapshot']>['tabs'][number]

/** One report from several pages: the assistant opens with them picked and the research brief chosen. */
function researchRows(tab: SnapshotTab | undefined, open: SnapshotTab[], tabs: BrowserActions['tabs']): MenuItemConstructorOptions[] {
  const readable = (other: SnapshotTab) => /^https?:/i.test(other.url)
  const report = (picked: SnapshotTab[]) => () => tabs.create(`sc://assistant/?preset=brief&tabs=${picked.slice(0, MAX_MENTIONED_TABS).map((other) => other.id).join(',')}`)
  const group = tab?.group ? open.filter((other) => other.group === tab.group && readable(other)) : []
  const all = open.filter(readable)
  return [
    ...(group.length > 1 ? [{ label: `Make a report from this group (${Math.min(group.length, MAX_MENTIONED_TABS)})`, click: report(group) }] : []),
    { label: all.length > MAX_MENTIONED_TABS ? `Make a report from the first ${MAX_MENTIONED_TABS} tabs` : 'Make a report from all tabs', enabled: all.length > 1, click: report(all) }
  ]
}

const MENU_TITLE = 48

/** Reopen closed tab, and beside it the last few to pick from once there's more than one. */
function closedTabRows(tabs: BrowserActions['tabs']): MenuItemConstructorOptions[] {
  const closed = tabs.recentlyClosed(10)
  const name = ({ title, url }: { title: string; url: string }) => {
    const text = title || url
    return text.length > MENU_TITLE ? `${text.slice(0, MENU_TITLE - 1)}…` : text
  }
  return [
    { label: 'Reopen closed tab', accelerator: keyFor('reopen-tab'), enabled: closed.length > 0, click: () => tabs.reopenClosed() },
    ...(closed.length > 1
      ? [{ label: 'Recently closed', submenu: closed.map((tab, index) => ({ label: name(tab), click: () => tabs.reopenClosed(index) })) }]
      : [])
  ]
}

/** The address bar's right-click menu. Paste and go never runs a pasted script. */
export async function popupOmniboxMenu(actions: BrowserActions, window: BaseWindow): Promise<void> {
  const pasted = (await Promise.resolve(clipboard.readText())).trim().replace(/^javascript:/i, '').slice(0, 4096)
  const isSearch = !!pasted && resolveOmniboxInput(pasted) === DEFAULT_SEARCH_ENGINE.template.replace('%s', encodeURIComponent(pasted))
  const active = actions.tabs.active
  Menu.buildFromTemplate([
    { role: 'undo', label: 'Undo' },
    { role: 'redo', label: 'Redo' },
    { type: 'separator' },
    { role: 'cut', label: 'Cut' },
    { role: 'copy', label: 'Copy' },
    { role: 'paste', label: 'Paste', enabled: !!pasted },
    { label: isSearch ? 'Paste and search' : 'Paste and go', enabled: !!pasted && !!active, click: () => active && actions.openAddress(active.id, pasted) },
    { type: 'separator' },
    { role: 'selectAll', label: 'Select all' }
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
    { label: 'Manage profiles…', click: () => actions.openPage('settings', 'data') }
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
        { label: 'Bookmark this page', accelerator: keyFor('bookmark'), click: actions.toggleBookmark },
        { label: 'Passwords', accelerator: keyFor('passwords'), click: actions.passwordMenu },
        { label: 'Extensions', submenu: actions.extensionMenu() },
        { label: 'Profiles', click: () => actions.openPage('settings', 'data') },
        { type: 'separator' }
      ]
    : []
  const onPage = !!active && /^https?:/i.test(effectiveUrl(active.url))
  Menu.buildFromTemplate([
    ...updateRow,
    ...spareRows,
    { label: 'New tab', accelerator: keyFor('new-tab'), click: () => tabs.create() },
    { label: 'New window', accelerator: keyFor('new-window'), click: () => actions.openWindow() },
    { label: 'New private window', accelerator: keyFor('private-window'), click: actions.openPrivateWindow },
    { type: 'separator' },
    ...closedTabRows(tabs),
    { label: 'Search tabs', accelerator: keyFor('search-tabs'), click: actions.searchTabs },
    { type: 'checkbox', label: 'Split view', checked: tabs.snapshot().splitIds.length > 0, enabled: tabs.snapshot().tabs.length > 1, click: () => tabs.toggleSplit() },
    { type: 'separator' },
    { label: 'History', accelerator: keyFor('history'), click: () => actions.openPage('history') },
    { label: 'Downloads', accelerator: keyFor('downloads'), click: () => actions.openPage('downloads') },
    { label: 'Notifications', submenu: actions.notificationRows() },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'All bookmarks', accelerator: keyFor('bookmarks'), click: () => actions.openPage('bookmarks') },
        { type: 'checkbox', label: 'Bookmarks bar', accelerator: keyFor('bookmarks-bar'), checked: bookmarksBarAlways, click: actions.toggleBookmarksBar },
        { label: 'Bookmark all tabs…', accelerator: keyFor('bookmark-all-tabs'), click: actions.bookmarkAllTabs }
      ]
    },
    {
      label: 'Library',
      submenu: [
        { label: 'Reading list', click: () => actions.openPage('reading') },
        { label: 'Highlights', click: () => actions.openPage('highlights') },
        { label: 'Watched pages', click: () => actions.openPage('watching') },
        { label: 'Archived and snoozed tabs', click: () => actions.openPage('archive') }
      ]
    },
    { type: 'separator' },
    {
      label: 'AI',
      submenu: [
        { label: 'Assistant', accelerator: keyFor('assistant'), click: actions.toggleAssistant },
        { label: 'AI Briefs', click: () => actions.openPage('briefs') },
        { label: 'Terra Code (beta)', click: () => actions.openCode() },
        { label: 'Translate page', enabled: onPage, submenu: translateRows(actions) },
        { type: 'separator' },
        { label: 'AI settings', click: () => actions.openPage('ai') }
      ]
    },
    {
      label: 'Focus',
      submenu: [
        { label: 'Focus timer', click: () => actions.openPage('focus') },
        { label: 'Start or stop the timer', click: actions.toggleStudy },
        { label: 'Site blocker', click: () => actions.openPage('blocker') }
      ]
    },
    ...(actions.vpnInstalled() ? [{ label: 'VPN', click: () => actions.openPage('vpn') }] : []),
    { type: 'separator' },
    {
      label: `Zoom (${active?.zoomPercent ?? 100}%)`,
      submenu: [
        { label: 'Zoom in', accelerator: keyFor('zoom-in'), click: onActive((id) => tabs.zoomBy(id, 1)) },
        { label: 'Zoom out', accelerator: keyFor('zoom-out'), click: onActive((id) => tabs.zoomBy(id, -1)) },
        { label: 'Reset', accelerator: keyFor('zoom-reset'), click: onActive((id) => tabs.setZoom(id, 1)) }
      ]
    },
    { label: 'Find in page…', accelerator: keyFor('find'), click: actions.openFind },
    { label: 'Reader view', accelerator: keyFor('reader'), click: actions.toggleReader },
    { label: 'Print…', accelerator: keyFor('print'), click: onActive((id) => tabs.print(id)) },
    { label: 'Screenshot', accelerator: keyFor('screenshot'), click: actions.screenshot },
    { label: 'Screenshot and mark up…', click: actions.screenshotMarkup },
    { label: 'Full screen', accelerator: keyFor('fullscreen'), click: actions.toggleFullscreen },
    { type: 'separator' },
    {
      label: 'More tools',
      submenu: [
        { label: 'Command palette', accelerator: keyFor('palette'), click: actions.togglePalette },
        { label: 'Open file…', accelerator: keyFor('open-file'), click: actions.openFile },
        { label: 'Install this site as an app…', enabled: onPage, click: actions.installApp },
        { type: 'checkbox', label: 'Performance Mode', checked: actions.performanceMode.enabled(), click: actions.performanceMode.toggle },
        { type: 'separator' },
        { label: 'Task Manager', accelerator: keyFor('task-manager'), click: () => actions.openPage('tasks') },
        { label: 'View page source', accelerator: keyFor('view-source'), enabled: !!active && /^(https?|file):/i.test(effectiveUrl(active.url)), click: actions.viewSource },
        { label: 'Developer tools', accelerator: keyFor('devtools'), click: onActive((id) => tabs.toggleDevTools(id)) }
      ]
    },
    { type: 'separator' },
    { label: 'Settings', accelerator: keyFor('settings'), click: () => actions.openPage('settings') },
    { label: 'Quit', accelerator: keyFor('quit'), click: actions.quit }
  ]).popup({ window, x: Math.round(x), y: Math.round(y) })
}
