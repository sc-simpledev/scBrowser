import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, ClipboardItem, nativeTheme, session, shell, type Rectangle, type Session } from 'electron'
import { NATIVE_THEME } from '@scbrowser/ui/native-theme'
import {
  effectiveUrl,
  engineById,
  TOAST_POPUP,
  errorPageUrl,
  isReaderUrl,
  SUMMARISE_PROMPT,
  isNewTabUrl,
  type ChromeEvents,
  type EventChannel,
  type PermissionPrompt
} from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import { AiService } from './ai/service'
import type { AiStore } from './ai/store'
import { DownloadManager, uniquePath } from './downloads'
import { handleInternalPages } from './internal/protocol'
import { registerInternalIpc } from './internalIpc'
import { registerIpc } from './ipc'
import { attachPageMenu } from './menus'
import { Overlay } from './overlay'
import { extractArticle } from './ai/pageText'
import { storeArticle } from './internal/reader'
import { PrivacyService } from './privacy/service'
import { PermissionService } from './permissions'
import { currentProfile, DEFAULT_PROFILE } from './profiles'
import { loadSession, SessionSaver } from './session'
import type { SettingsStore } from './settings'
import { attachShortcuts } from './shortcuts'
import type { BookmarksRepo } from './storage/bookmarks'
import type { ChatsRepo } from './storage/chats'
import type { DownloadsRepo } from './storage/downloads'
import type { HistoryRepo } from './storage/history'
import type { KeyValueRepo } from './storage/kv'
import type { PermissionsRepo } from './storage/permissions'
import { TabManager } from './tabs/TabManager'

const TABSTRIP_HEIGHT = 40 // keep in sync with --sc-tabstrip-height
const SLEEP_CHECK_MS = 60_000
const WINDOW_KEY = 'window'
const APP_TITLE = currentProfile() === DEFAULT_PROFILE ? 'scDelta' : `scDelta (${currentProfile()})`

const nativeColors = () => (nativeTheme.shouldUseDarkColors ? NATIVE_THEME.dark : NATIVE_THEME.light)

export interface Services {
  kv: KeyValueRepo
  settings: SettingsStore
  history: HistoryRepo
  bookmarks: BookmarksRepo
  downloads: DownloadsRepo
  permissions: PermissionsRepo
  aiStore: AiStore
  chats: ChatsRepo
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
    title: 'scDelta',
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
      window.setTitle(`${active?.title ? `${active.title} — ` : ''}${APP_TITLE}`)
    },
    onTabCreated: (contents) => {
      attachShortcuts(contents, actions)
      attachPageMenu(contents, actions, window)
      overlay.raise()
    },
    onTabClosed: () => permissionService.refresh(),
    // Only focus, not a new selection: the person may already be typing.
    onNewTabLoaded: () => {
      if (!chromeUi.isDestroyed()) chromeUi.focus()
    },
    onActivate: (tab) => {
      if (isNewTabUrl(tab.url)) focusOmnibox()
      else tabs.focusActive()
      permissionService.refresh()
    },
    // Pages can still report in during shutdown, after the database has closed.
    onVisit: (url) => {
      if (!window.isDestroyed()) history.recordVisit(url)
    },
    onPageLoaded: (contents) => void privacy.applyCosmetics(contents),
    onTitle: (url, title) => {
      if (!window.isDestroyed()) history.updateTitle(url, title)
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
    toggleBookmarksBar: () => settings.set({ showBookmarksBar: !settings.get().showBookmarksBar }),
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
    screenshot: () => {
      const contents = tabs.active && tabs.contentsFor(tabs.active.id)
      if (contents) void takeScreenshot(contents)
    },
    askAssistant: (prompt) => send('ui:assistant-prompt', prompt),
    quit: () => app.quit()
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
      accent: () => settings.get().accent
    }
  )
  const onActive = (action: (id: number) => void) => () => {
    if (tabs.active) action(tabs.active.id)
  }
  const paletteActions: Record<string, () => void> = {
    'new-tab': () => tabs.create(),
    'reopen-tab': () => tabs.reopenClosed(),
    find: actions.openFind,
    bookmark: actions.toggleBookmark,
    'bookmarks-bar': actions.toggleBookmarksBar,
    reader: actions.toggleReader,
    assistant: actions.toggleAssistant,
    summarise: () => actions.askAssistant({ text: SUMMARISE_PROMPT, selection: null, includePage: true }),
    split: () => tabs.toggleSplit(),
    screenshot: actions.screenshot,
    'vertical-tabs': () =>
      settings.set({ tabLayout: settings.get().tabLayout === 'vertical' ? 'horizontal' : 'vertical' }),
    history: () => actions.openPage('history'),
    bookmarks: () => actions.openPage('bookmarks'),
    downloads: () => actions.openPage('downloads'),
    settings: () => actions.openPage('settings'),
    'ai-settings': () => actions.openPage('ai'),
    print: onActive((id) => tabs.print(id)),
    fullscreen: actions.toggleFullscreen,
    devtools: onActive((id) => tabs.toggleDevTools(id))
  }
  const privacy = new PrivacyService(settings, kv, {
    onBlocked: (id) => tabs.noteBlocked(id),
    onChanged: () => send('privacy:changed', privacy.offHosts())
  })
  const downloads = new DownloadManager(services.downloads, settings, (progress) =>
    send('downloads:progress', progress)
  )

  const prepared = new Set<Session>()
  const prepareSession = (target: Session) => {
    if (prepared.has(target)) return
    prepared.add(target)
    privacy.attach(target)
    permissionService.attach(target)
    downloads.attach(target)
    if (target !== session.defaultSession) handleInternalPages(target)
  }
  prepareSession(session.defaultSession)

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
    const { x, y, width } = tabs.page
    overlay.showToast(copied ? 'Screenshot saved and copied' : 'Screenshot saved', x + width - TOAST_POPUP.width - TOAST_POPUP.inset, y + TOAST_POPUP.inset)
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
    aiStore,
    ai,
    chats: services.chats,
    privacy
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
    privacy
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
    const saved = settings.get().startup === 'restore' ? loadSession(kv) : null
    if (saved) tabs.restore(saved.tabs, saved.activeIndex)
    initialUrls.forEach((url) => tabs.create(url))
    if (!saved && initialUrls.length === 0) tabs.create()
  })

  return { window, tabs }
}
