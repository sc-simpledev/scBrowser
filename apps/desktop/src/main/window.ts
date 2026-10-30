import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, session, shell, type Rectangle } from 'electron'
import { NATIVE_THEME } from '@scbrowser/ui/native-theme'
import {
  effectiveUrl,
  engineById,
  isNewTabUrl,
  type ChromeEvents,
  type EventChannel,
  type PermissionPrompt
} from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import { DownloadManager } from './downloads'
import { registerInternalIpc } from './internalIpc'
import { registerIpc } from './ipc'
import { attachPageMenu } from './menus'
import { Overlay } from './overlay'
import { PermissionService } from './permissions'
import { loadSession, SessionSaver } from './session'
import type { SettingsStore } from './settings'
import { attachShortcuts } from './shortcuts'
import type { BookmarksRepo } from './storage/bookmarks'
import type { DownloadsRepo } from './storage/downloads'
import type { HistoryRepo } from './storage/history'
import type { KeyValueRepo } from './storage/kv'
import type { PermissionsRepo } from './storage/permissions'
import { TabManager } from './tabs/TabManager'

const TABSTRIP_HEIGHT = 40 // keep in sync with --sc-tabstrip-height
const SLEEP_CHECK_MS = 60_000
const WINDOW_KEY = 'window'

const nativeColors = () => (nativeTheme.shouldUseDarkColors ? NATIVE_THEME.dark : NATIVE_THEME.light)

export interface Services {
  kv: KeyValueRepo
  settings: SettingsStore
  history: HistoryRepo
  bookmarks: BookmarksRepo
  downloads: DownloadsRepo
  permissions: PermissionsRepo
}

export interface BrowserWindowHandle {
  window: BrowserWindow
  tabs: TabManager
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
    title: 'scBrowser',
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
  const publishBookmarks = () => send('bookmarks:changed', bookmarks.list())

  const tabs = new TabManager(window, {
    onChange: (snapshot) => {
      // Tabs can still report in while the window is being torn down.
      if (window.isDestroyed()) return
      send('tabs:changed', snapshot)
      saver.schedule()
      const active = snapshot.tabs.find((t) => t.id === snapshot.activeId)
      window.setTitle(active?.title ? `${active.title} — scBrowser` : 'scBrowser')
    },
    onTabCreated: (contents) => {
      attachShortcuts(contents, actions)
      attachPageMenu(contents, actions, window)
      overlay.raise()
    },
    onTabClosed: () => permissionService.refresh(),
    onActivate: (tab) => {
      if (isNewTabUrl(tab.url)) focusOmnibox()
      else tabs.focusActive()
      permissionService.refresh()
    },
    onVisit: (url) => history.recordVisit(url),
    onTitle: (url, title) => history.updateTitle(url, title),
    onFound: (result) => send('find:result', result),
    onFullscreen: (fullscreen) => window.setFullScreen(fullscreen),
    engine: () => engineById(settings.get().searchEngine)
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
    toggleBookmarksBar: () => settings.set({ showBookmarksBar: !settings.get().showBookmarksBar }),
    toggleFullscreen: () => window.setFullScreen(!window.isFullScreen()),
    openPage: (page) => tabs.openInternal(`sc://${page}`),
    quit: () => app.quit()
  }

  const showPermission = (prompt: PermissionPrompt | null) =>
    overlay.setPermission(prompt && { prompt, x: tabs.page.x, y: tabs.page.y })
  const permissionService = new PermissionService(session.defaultSession, services.permissions, {
    tabIdFor: (contents) => tabs.tabIdFor(contents),
    activeTabId: () => tabs.active?.id ?? null,
    onPromptChanged: showPermission
  })
  const overlay = new Overlay(
    window,
    (index) => send('omnibox:pick', index),
    (requestId, allow) => permissionService.decide(requestId, allow)
  )
  const downloads = new DownloadManager(session.defaultSession, services.downloads, settings, (progress) =>
    send('downloads:progress', progress)
  )

  attachShortcuts(chromeUi, actions)
  const disposeIpc = registerIpc(chromeUi, {
    window,
    tabs,
    history,
    bookmarks,
    settings,
    overlay,
    actions,
    onBookmarksChanged: publishBookmarks
  })
  const disposeInternalIpc = registerInternalIpc({
    window,
    tabs,
    settings,
    history,
    bookmarks,
    downloads,
    permissions: services.permissions,
    onBookmarksChanged: publishBookmarks
  })
  const unsubscribeSettings = settings.subscribe((next) => send('settings:changed', next))

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
    saver.stop()
    unsubscribeSettings()
    nativeTheme.off('updated', syncTheme)
    disposeIpc()
    disposeInternalIpc()
    overlay.destroy()
    tabs.destroy()
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  chromeUi.once('did-finish-load', () => {
    const saved = settings.get().startup === 'restore' ? loadSession(kv) : null
    if (saved) tabs.restore(saved.tabs, saved.activeIndex)
    initialUrls.forEach((url) => tabs.create(url))
    if (!saved && initialUrls.length === 0) tabs.create()
  })

  return { window, tabs }
}
