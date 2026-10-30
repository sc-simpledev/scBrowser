import { join } from 'node:path'
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { NATIVE_THEME } from '@scbrowser/ui/native-theme'
import { isNewTabUrl, type ChromeEvents, type EventChannel } from '@scbrowser/shared'
import { registerIpc } from './ipc'
import { Overlay } from './overlay'
import { attachShortcuts } from './shortcuts'
import type { HistoryRepo } from './storage/history'
import { TabManager } from './tabs/TabManager'

const TABSTRIP_HEIGHT = 40 // keep in sync with --sc-tabstrip-height

const nativeColors = () => (nativeTheme.shouldUseDarkColors ? NATIVE_THEME.dark : NATIVE_THEME.light)

export interface BrowserWindowHandle {
  window: BrowserWindow
  tabs: TabManager
}

export function createBrowserWindow(history: HistoryRepo, initialUrls: string[] = []): BrowserWindowHandle {
  const colors = nativeColors()
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
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

  const tabs = new TabManager(window, {
    onChange: (snapshot) => {
      send('tabs:changed', snapshot)
      const active = snapshot.tabs.find((t) => t.id === snapshot.activeId)
      window.setTitle(active?.title ? `${active.title} — scBrowser` : 'scBrowser')
    },
    onTabCreated: (contents) => {
      attachShortcuts(contents, { tabs, focusOmnibox })
      overlay.raise()
    },
    onActivate: (tab) => (isNewTabUrl(tab.url) ? focusOmnibox() : tabs.focusActive()),
    onVisit: (url) => history.recordVisit(url),
    onTitle: (url, title) => history.updateTitle(url, title)
  })
  const overlay = new Overlay(window, (index) => send('omnibox:pick', index))

  attachShortcuts(chromeUi, { tabs, focusOmnibox })
  const disposeIpc = registerIpc(chromeUi, { tabs, history, overlay })

  // The chrome UI itself must never navigate away or open windows.
  chromeUi.on('will-navigate', (event) => event.preventDefault())
  chromeUi.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const syncTheme = () => {
    const { background, foreground } = nativeColors()
    window.setBackgroundColor(background)
    window.setTitleBarOverlay({ color: background, symbolColor: foreground, height: TABSTRIP_HEIGHT })
  }
  nativeTheme.on('updated', syncTheme)

  // Windows: mouse back/forward buttons arrive as app commands.
  window.on('app-command', (_event, command) => {
    const active = tabs.active
    if (!active) return
    if (command === 'browser-backward') tabs.back(active.id)
    if (command === 'browser-forward') tabs.forward(active.id)
  })

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    nativeTheme.off('updated', syncTheme)
    disposeIpc()
    overlay.destroy()
    tabs.destroy()
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  chromeUi.once('did-finish-load', () => {
    if (initialUrls.length === 0) tabs.create()
    initialUrls.forEach((url, i) => tabs.create(url, { activate: i === 0 }))
  })

  return { window, tabs }
}
