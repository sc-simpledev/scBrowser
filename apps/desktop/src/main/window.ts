import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, ClipboardItem, Menu, nativeTheme, net, safeStorage, session, shell, type Rectangle, type Session } from 'electron'
import { NATIVE_THEME } from '@scbrowser/ui/native-theme'
import {
  effectiveUrl,
  engineById,
  BOOKMARK_POPUP,
  TOAST_POPUP,
  byPing,
  errorPageUrl,
  isReaderUrl,
  SUMMARISE_PROMPT,
  isNewTabUrl,
  type Bookmark,
  type ChromeEvents,
  type EventChannel,
  type PermissionPrompt
} from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import { AiError, GROUP_TABS_PROMPT, groupTabsMessage, parseTabGroups } from '@scbrowser/ai'
import { rewriteSelection, togglePageTranslation } from './ai/pageTools'
import { AI_PARTITION, AiService } from './ai/service'
import type { AiStore } from './ai/store'
import { DownloadManager, uniquePath } from './downloads'
import { ExtensionManager } from './extensions'
import { handleInternalPages } from './internal/protocol'
import { pdfPageUrl } from './internal/pdf'
import { registerInternalIpc } from './internalIpc'
import { registerIpc } from './ipc'
import { attachPageMenu } from './menus'
import { SiteBlocker } from './blocker'
import { Overlay } from './overlay'
import { extractArticle } from './ai/pageText'
import { storeArticle } from './internal/reader'
import { PrivacyService } from './privacy/service'
import { PermissionService } from './permissions'
import { currentProfile, DEFAULT_PROFILE } from './profiles'
import { loadSession, SessionSaver } from './session'
import type { SettingsStore } from './settings'
import { attachShortcuts } from './shortcuts'
import { fetchIcon, fetchSiteIcon } from './siteIcons'
import { isPrivate, openPrivateWindow } from './private'
import type { Reporter } from './reporter'
import { SyncService, type KeyVault } from './sync'
import { DEFAULT_PROBE, VpnService, xrayPath, type ProbeTarget } from './vpn'
import type { BookmarksRepo } from './storage/bookmarks'
import type { ChatsRepo } from './storage/chats'
import type { DownloadsRepo } from './storage/downloads'
import type { HistoryRepo } from './storage/history'
import type { KeyValueRepo } from './storage/kv'
import type { PermissionsRepo } from './storage/permissions'
import { TabManager } from './tabs/TabManager'

const TABSTRIP_HEIGHT = 40 // keep in sync with --sc-tabstrip-height
const SLEEP_CHECK_MS = 60_000
const SYNC_FIRST_MS = 20_000
const SYNC_EVERY_MS = 10 * 60_000
const VPN_MENU_ROWS = 15
const WINDOW_KEY = 'window'
const APP_TITLE = isPrivate ? 'scTerra (Private)' : currentProfile() === DEFAULT_PROFILE ? 'scTerra' : `scTerra (${currentProfile()})`

const nativeColors = () => (nativeTheme.shouldUseDarkColors ? NATIVE_THEME.dark : NATIVE_THEME.light)

/** Tests point pings at a local page. */
function probeTarget(): ProbeTarget {
  const [host, port] = process.env.SCB_VPN_PROBE?.split(':') ?? []
  return host && port ? { host, port: Number(port) } : DEFAULT_PROBE
}

export interface Services {
  kv: KeyValueRepo
  settings: SettingsStore
  history: HistoryRepo
  bookmarks: BookmarksRepo
  downloads: DownloadsRepo
  permissions: PermissionsRepo
  aiStore: AiStore
  chats: ChatsRepo
  reporter: Reporter
}

export interface BrowserWindowHandle {
  window: BrowserWindow
  tabs: TabManager
  actions: BrowserActions
  extensions: ExtensionManager
  sync: SyncService
  vpn: VpnService
}

interface SavedWindow {
  bounds: Rectangle
  maximized: boolean
}

export function createBrowserWindow(services: Services, initialUrls: string[] = []): BrowserWindowHandle {
  const { kv, settings, history, bookmarks } = services
  const colors = nativeColors()
  const savedWindow = kv.get(WINDOW_KEY) as SavedWindow | undefined
  const window = new BrowserWindow({
    ...(savedWindow?.bounds ?? { width: 1320, height: 860 }),
    minWidth: 520,
    minHeight: 360,
    show: false,
    title: 'scTerra',
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.foreground, height: TABSTRIP_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const chromeUi = window.webContents

  const send = <E extends EventChannel>(channel: E, ...payload: ChromeEvents[E] extends void ? [] : [ChromeEvents[E]]) => {
    if (!chromeUi.isDestroyed()) chromeUi.send(channel, ...payload)
  }
  const focusOmnibox = () => {
    chromeUi.focus()
    send('ui:focus-omnibox')
  }
  const publishBookmarks = () => {
    send('bookmarks:changed', bookmarks.list())
    send('bookmark-groups:changed', bookmarks.groups())
    void fillMissingIcons()
  }
  const triedIcons = new Set<string>()
  const needsIcon = (url: string) => URL.canParse(url) && bookmarks.list().some((b) => URL.canParse(b.url) && new URL(b.url).host === new URL(url).host && !b.icon)
  const storeIcon = (url: string, icon: string | null) => {
    if (!icon || window.isDestroyed()) return
    bookmarks.setIcon(new URL(url).host, icon)
    send('bookmarks:changed', bookmarks.list())
  }
  /** Bookmarks added from elsewhere have never been visited, so ask each site for its icon once. */
  const fillMissingIcons = async () => {
    for (const { url, icon } of bookmarks.list()) {
      if (icon || !/^https?:/.test(url) || !URL.canParse(url) || triedIcons.has(new URL(url).host)) continue
      triedIcons.add(new URL(url).host)
      storeIcon(url, await fetchSiteIcon(session.defaultSession, url))
    }
  }

  const tabs = new TabManager(window, {
    onChange: (snapshot) => {
      // Tabs can still report in while the window is being torn down.
      if (window.isDestroyed()) return
      send('tabs:changed', snapshot)
      saver.schedule()
      const active = snapshot.tabs.find((t) => t.id === snapshot.activeId)
      window.setTitle(`${active?.title ? `${active.title} — ` : ''}${APP_TITLE}`)
    },
    onTabCreated: (contents) => {
      attachShortcuts(contents, actions)
      attachPageMenu(contents, actions, window, (page, params) => extensions.menuItems(page, params))
      extensions.addTab(contents)
      if (vpn.summary().enabled) contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      overlay.raise()
    },
    onTabClosed: () => permissionService.refresh(),
    // Only focus, not a new selection: the person may already be typing.
    onNewTabLoaded: () => {
      if (!chromeUi.isDestroyed()) chromeUi.focus()
    },
    onActivate: (tab) => {
      const contents = tabs.contentsFor(tab.id)
      if (contents) extensions.selectTab(contents)
      if (isNewTabUrl(tab.url)) focusOmnibox()
      else tabs.focusActive()
      permissionService.refresh()
    },
    // Pages can still report in during shutdown, after the database has closed.
    onVisit: (url) => {
      if (!window.isDestroyed() && !isPrivate) history.recordVisit(url)
    },
    onPageLoaded: (contents) => void privacy.applyCosmetics(contents),
    onTitle: (url, title) => {
      if (!window.isDestroyed() && !isPrivate) history.updateTitle(url, title)
    },
    // Only sites already bookmarked, so this keeps no record of browsing.
    onFavicon: (contents, pageUrl, iconUrl) => {
      if (!isPrivate && !window.isDestroyed() && needsIcon(pageUrl)) void fetchIcon(contents.session, iconUrl).then((icon) => storeIcon(pageUrl, icon))
    },
    onFound: (result) => send('find:result', result),
    onFullscreen: (fullscreen) => window.setFullScreen(fullscreen),
    engine: () => engineById(settings.get().searchEngine),
    errorUrl: (url, reason) => errorPageUrl(url, reason, privacy.upgradedFrom(url)),
    prepareSession: (target) => prepareSession(target)
  })
  const saver = new SessionSaver(kv, tabs)

  const actions: BrowserActions = {
    tabs,
    focusOmnibox,
    openFind: () => {
      chromeUi.focus()
      send('ui:open-find')
    },
    toggleBookmark: () => {
      const active = tabs.active
      if (!active || !/^(https?|file):/.test(effectiveUrl(active.url))) return
      bookmarks.toggle(effectiveUrl(active.url), active.title)
      publishBookmarks()
    },
    toggleBookmarksBar: () => settings.set({ bookmarksBar: settings.get().bookmarksBar === 'always' ? 'bookmarks-page' : 'always' }),
    toggleFullscreen: () => window.setFullScreen(!window.isFullScreen()),
    openPage: (page) => tabs.openInternal(`sc://${page}`),
    toggleAssistant: () => send('ui:assistant-toggle'),
    toggleReader: () => {
      const active = tabs.active
      if (!active) return
      if (isReaderUrl(active.url)) {
        tabs.exitReader(active.id)
        return
      }
      const contents = tabs.contentsFor(active.id)
      if (!contents || !/^https?:/i.test(active.url)) return
      void extractArticle(contents).then((article) => {
        if (article) void contents.loadURL(storeArticle(article))
      })
    },
    togglePalette: () => overlay.togglePalette(),
    organiseTabs: () => void runTask('Organising tabs…', async () => {
      const candidates = tabs
        .snapshot()
        .tabs.filter((tab) => /^https?:/.test(tab.url) && !aiStore.disabledHosts().includes(new URL(tab.url).host))
      if (candidates.length < 2) return 'Open a few more tabs first'
      const groups = parseTabGroups(await ai.complete(GROUP_TABS_PROMPT, groupTabsMessage(candidates)), candidates)
      if (groups.length === 0) return "Couldn't sort these tabs"
      tabs.applyGroups(groups)
      return `Sorted into ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`
    }),
    translatePage: () => {
      const active = tabs.active
      const contents = active && tabs.contentsFor(active.id)
      if (!contents || !/^https?:/.test(active.url)) return
      if (aiStore.disabledHosts().includes(new URL(active.url).host)) return notify('AI is off for this site')
      void runTask('Translating…', async () => {
        const outcome = await togglePageTranslation(contents, ai, settings.get().translateTo)
        return { restored: 'Showing the original', translated: 'Translated', partly: 'Translated the start of this page', failed: "Couldn't translate this page" }[outcome]
      })
    },
    rewrite: (contents, text, style) => {
      const url = contents.getURL()
      if (URL.canParse(url) && aiStore.disabledHosts().includes(new URL(url).host)) return notify('AI is off for this site')
      void runTask('Rewriting…', async () =>
        (await rewriteSelection(contents, ai, text, style)) ? 'Rewritten. Undo with Ctrl Z' : 'The selection changed, so nothing was replaced'
      )
    },
    screenshot: () => {
      const contents = tabs.active && tabs.contentsFor(tabs.active.id)
      if (contents) void takeScreenshot(contents)
    },
    askAssistant: (prompt) => send('ui:assistant-prompt', prompt),
    quit: () => app.quit(),
    openPrivateWindow: () => openPrivateWindow(settings.get(), bookmarks.list())
  }
  const { aiStore } = services
  const ai = new AiService(aiStore, (id) => tabs.contentsFor(id))

  const showPermission = (prompt: PermissionPrompt | null) =>
    overlay.setPermission(prompt && { prompt, x: tabs.page.x, y: tabs.page.y })
  const permissionService = new PermissionService(services.permissions, {
    tabIdFor: (contents) => tabs.tabIdFor(contents),
    activeTabId: () => tabs.active?.id ?? null,
    onPromptChanged: showPermission
  })
  const overlay = new Overlay(
    window,
    (index) => send('omnibox:pick', index),
    (requestId, allow) => permissionService.decide(requestId, allow),
    {
      onPaletteRun: (id) => paletteActions[id]?.(),
      onPaletteClose: () => tabs.focusActive(),
      accent: () => settings.get().accent,
      onBookmarkSave: ({ id, title, url, groupId }) => {
        if (!URL.canParse(url) || !/^(https?|file):/i.test(url)) return 'Enter a full web address.'
        try {
          bookmarks.edit(id, title, url)
        } catch {
          return 'Another bookmark already has this address.'
        }
        if (bookmarks.list().find((b) => b.id === id)?.groupId !== groupId) bookmarks.setGroup(id, groupId)
        publishBookmarks()
        return null
      },
      onBookmarkRemove: (id) => {
        bookmarks.remove(id)
        publishBookmarks()
      },
      onBookmarkClose: () => tabs.focusActive()
    }
  )
  const onActive = (action: (id: number) => void) => () => {
    if (tabs.active) action(tabs.active.id)
  }
  const paletteActions: Record<string, () => void> = {
    'new-tab': () => tabs.create(),
    'private-window': actions.openPrivateWindow,
    'reopen-tab': () => tabs.reopenClosed(),
    find: actions.openFind,
    bookmark: actions.toggleBookmark,
    'bookmarks-bar': actions.toggleBookmarksBar,
    reader: actions.toggleReader,
    assistant: actions.toggleAssistant,
    summarise: () => actions.askAssistant({ text: SUMMARISE_PROMPT, selection: null, includePage: true }),
    split: () => tabs.toggleSplit(),
    screenshot: actions.screenshot,
    translate: actions.translatePage,
    'organise-tabs': actions.organiseTabs,
    'ungroup-tabs': () => tabs.clearGroups(),
    'vertical-tabs': () =>
      settings.set({ tabLayout: settings.get().tabLayout === 'vertical' ? 'horizontal' : 'vertical' }),
    history: () => actions.openPage('history'),
    bookmarks: () => actions.openPage('bookmarks'),
    downloads: () => actions.openPage('downloads'),
    settings: () => actions.openPage('settings'),
    'ai-settings': () => actions.openPage('ai'),
    'focus-mode': () => {
      const focusMode = !settings.get().focusMode
      settings.set({ focusMode })
      notify(focusMode ? 'Focus Mode is on' : 'Focus Mode is off')
    },
    'site-blocker': () => actions.openPage('blocker'),
    vpn: () => actions.openPage('vpn'),
    print: onActive((id) => tabs.print(id)),
    fullscreen: actions.toggleFullscreen,
    devtools: onActive((id) => tabs.toggleDevTools(id))
  }
  const extensions = new ExtensionManager(kv, {
    window,
    createTab: (url, active) => {
      const id = tabs.create(url, { activate: active, afterId: tabs.active?.id })
      return tabs.contentsFor(id)
    },
    selectTab: (contents) => {
      const id = tabs.tabIdFor(contents)
      if (id !== null) tabs.activate(id)
    },
    closeTab: (contents) => {
      const id = tabs.tabIdFor(contents)
      if (id !== null) tabs.close(id)
    }
  })
  const blocker = new SiteBlocker(settings, kv, {
    ready: () => aiStore.status().ready,
    disabled: (host) => aiStore.disabledHosts().includes(host),
    complete: (system, user) => ai.complete(system, user)
  })
  const privacy = new PrivacyService(settings, kv, {
    onBlocked: (id) => tabs.noteBlocked(id),
    screen: (url, contents): string | null | Promise<string | null> => (tabs.owns(contents) ? blocker.screen(url) : null),
    onScreenedOut: (url, reason, contents) => void contents.loadURL(blocker.pageFor(url, reason)).catch(() => undefined),
    isTab: (contents): boolean => tabs.owns(contents),
    onPdf: (url, contents) => {
      if (!isPrivate) history.recordVisit(url)
      void contents.loadURL(pdfPageUrl(url)).catch(() => undefined)
    },
    onChanged: () => send('privacy:changed', privacy.offHosts())
  })
  const downloads = new DownloadManager(services.downloads, settings, (progress) =>
    send('downloads:progress', progress)
  )

  const prepared = new Set<Session>()
  let proxyRules: string | null = null
  const applySessionProxy = (target: Session) => {
    // Tests serve pages from this computer, which Chromium would otherwise send direct.
    const proxyBypassRules = process.env.SCB_E2E ? '<-loopback>' : ''
    return target.setProxy(proxyRules ? { mode: 'fixed_servers', proxyRules, proxyBypassRules } : { mode: 'direct' })
  }
  const prepareSession = (target: Session) => {
    if (prepared.has(target)) return
    prepared.add(target)
    privacy.attach(target)
    permissionService.attach(target)
    downloads.attach(target)
    void extensions.attach(target)
    // A container opened while the VPN is on joins it straight away.
    if (proxyRules) void applySessionProxy(target)
    if (target !== session.defaultSession) handleInternalPages(target)
  }
  prepareSession(session.defaultSession)

  const vault: KeyVault = {
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("This system can't store this securely yet.")
      return safeStorage.encryptString(value).toString('base64')
    },
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
  const sync = new SyncService({
    kv,
    settings,
    history,
    bookmarks,
    vault,
    basePath: join(app.getPath('userData'), 'sync-base.json'),
    onBookmarksChanged: publishBookmarks
  })
  const vpn = new VpnService({
    kv,
    vault,
    corePath: () => xrayPath(process.resourcesPath, app.getAppPath(), app.isPackaged),
    applyProxy: async (rules) => {
      // Tests serve pages from this computer, which Chromium would otherwise send direct.
      proxyRules = rules
      // The assistant has its own session, and its requests should take the same route as tabs.
      for (const target of [...prepared, session.fromPartition(AI_PARTITION)]) {
        await applySessionProxy(target)
        await target.closeAllConnections()
      }
      // WebRTC would otherwise reveal the real address by skipping the proxy.
      const policy = rules ? 'disable_non_proxied_udp' : 'default'
      for (const { id } of tabs.snapshot().tabs) tabs.contentsFor(id)?.setWebRTCIPHandlingPolicy(policy)
    },
    probeTarget: probeTarget(),
    fetchText: async (url) => {
      const response = await net.fetch(url)
      if (!response.ok) throw new Error(`The subscription answered with error ${response.status}.`)
      return response.text()
    },
    onChange: () => send('vpn:changed', vpn.summary())
  })
  const openVpnMenu = (x: number, y: number) => {
    const { enabled, connections, activeId, groups, pings } = vpn.state()
    const pick = (id: string) => void vpn.select(id).then(() => (vpn.summary().enabled ? undefined : vpn.setEnabled(true)))
    const row = (connection: (typeof connections)[number]) => ({
      label: `${connection.name}${pings[connection.id] ? `  ${pings[connection.id]} ms` : pings[connection.id] === null ? '  not working' : ''}`,
      type: 'radio' as const,
      checked: connection.id === activeId,
      click: () => pick(connection.id)
    })
    const list = (items: typeof connections) => byPing(items, pings).slice(0, VPN_MENU_ROWS).map(row)
    const pingAll = async () => {
      notify('Pinging…')
      await vpn.ping(connections.map(({ id }) => id), settings.get().vpnPingTimeout)
      notify('Finished pinging')
    }
    Menu.buildFromTemplate([
      { label: enabled ? 'Turn off' : 'Turn on', click: () => void vpn.setEnabled(!enabled) },
      { type: 'separator' },
      ...list(connections.filter((connection) => connection.groupId === null)),
      ...groups.map((group) => ({ label: group.name, submenu: list(connections.filter((connection) => connection.groupId === group.id)) })),
      { type: 'separator' },
      { label: 'Ping all', click: () => void pingAll() },
      { label: 'Manage connections…', click: () => actions.openPage('vpn') }
    ]).popup({ window, x: Math.round(x), y: Math.round(y) })
  }
  const syncFirst = setTimeout(() => void sync.run(), SYNC_FIRST_MS)
  const syncTimer = setInterval(() => void sync.run(), SYNC_EVERY_MS)

  const notify = (text: string) => {
    const { x, y, width } = tabs.page
    overlay.showToast(text, x + width - TOAST_POPUP.width - TOAST_POPUP.inset, y + TOAST_POPUP.inset)
  }
  const runTask = async (working: string, task: () => Promise<string>) => {
    notify(working)
    try {
      notify(await task())
    } catch (error) {
      notify(error instanceof AiError ? error.message : 'That AI task failed')
    }
  }

  const takeScreenshot = async (contents: Electron.WebContents) => {
    const image = await contents.capturePage()
    const png = image.toPNG()
    const copied = await clipboard
      .write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
      .then(() => true)
      .catch(() => false)
    const dir = settings.get().downloadDir || app.getPath('downloads')
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-').replace('T', ' ')
    await writeFile(uniquePath(dir, `Screenshot ${stamp}.png`, existsSync), png)
    notify(copied ? 'Screenshot saved and copied' : 'Screenshot saved')
  }

  const editBookmark = (bookmark: Bookmark, fromBar: boolean) => {
    const { x, y, width } = tabs.page
    const { id, title, url, groupId } = bookmark
    overlay.openBookmarkEditor({
      id,
      title,
      url,
      groupId,
      groups: bookmarks.groups(),
      editUrl: fromBar,
      x: x + width - BOOKMARK_POPUP.width - BOOKMARK_POPUP.inset,
      y: y + BOOKMARK_POPUP.inset
    })
  }

  attachShortcuts(chromeUi, actions)
  const disposeIpc = registerIpc(chromeUi, {
    window,
    tabs,
    history,
    bookmarks,
    settings,
    overlay,
    actions,
    onBookmarksChanged: publishBookmarks,
    editBookmark,
    aiStore,
    ai,
    chats: services.chats,
    privacy,
    vpn,
    openVpnMenu
  })
  const disposeInternalIpc = registerInternalIpc({
    window,
    tabs,
    settings,
    history,
    bookmarks,
    downloads,
    permissions: services.permissions,
    onBookmarksChanged: publishBookmarks,
    aiStore,
    ai,
    chats: services.chats,
    privacy,
    extensions,
    sync,
    reporter: services.reporter,
    blocker,
    vpn
  })
  const unsubscribeSettings = settings.subscribe((next) => send('settings:changed', next))
  chromeUi.once('did-finish-load', () => send('privacy:changed', privacy.offHosts()))
  const unsubscribeAi = aiStore.subscribe(() => send('ai:changed', aiStore.status()))

  // The chrome UI itself must never navigate away or open windows.
  chromeUi.on('will-navigate', (event) => event.preventDefault())
  chromeUi.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // If the UI process dies, reload it: tabs live in the main process and reappear.
  chromeUi.on('render-process-gone', () => chromeUi.reload())

  const syncTheme = () => {
    const { background, foreground } = nativeColors()
    window.setBackgroundColor(background)
    window.setTitleBarOverlay({ color: background, symbolColor: foreground, height: TABSTRIP_HEIGHT })
  }
  nativeTheme.on('updated', syncTheme)

  const sleepTimer = setInterval(() => {
    const minutes = settings.get().sleepAfterMinutes
    if (minutes > 0) tabs.sleepIdle(minutes * 60_000)
  }, SLEEP_CHECK_MS)

  // Windows: mouse back/forward buttons arrive as app commands.
  window.on('app-command', (_event, command) => {
    const active = tabs.active
    if (!active) return
    if (command === 'browser-backward') tabs.back(active.id)
    if (command === 'browser-forward') tabs.forward(active.id)
  })
  window.on('resize', () => tabs.applyBounds())

  window.once('ready-to-show', () => {
    if (savedWindow?.maximized) window.maximize()
    window.show()
  })
  window.on('close', () => {
    saver.flush()
    kv.set(WINDOW_KEY, { bounds: window.getNormalBounds(), maximized: window.isMaximized() } satisfies SavedWindow)
  })
  window.on('closed', () => {
    clearInterval(sleepTimer)
    clearTimeout(syncFirst)
    clearInterval(syncTimer)
    sync.stop()
    vpn.stop()
    saver.stop()
    unsubscribeSettings()
    unsubscribeAi()
    nativeTheme.off('updated', syncTheme)
    disposeIpc()
    disposeInternalIpc()
    overlay.destroy()
    tabs.destroy()
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  chromeUi.once('did-finish-load', () => {
    if (!isPrivate) void fillMissingIcons()
    const saved = settings.get().startup === 'restore' ? loadSession(kv) : null
    if (saved) tabs.restore(saved.tabs, saved.activeIndex)
    initialUrls.forEach((url) => tabs.create(url))
    if (!saved && initialUrls.length === 0) tabs.create()
  })

  return { window, tabs, actions, extensions, sync, vpn }
}
