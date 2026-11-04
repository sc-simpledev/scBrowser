import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeImage, session as electronSession, type BaseWindow, type MenuItemConstructorOptions, type NativeImage, type Session, type WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, loadAllExtensions, uninstallExtension } from 'electron-chrome-web-store'
import type { ExtensionInfo, ExtensionPanelState, ExtensionSummary, PageRect } from '@scbrowser/shared'
import { SidePanels } from './extensionPanel'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'extensions:paths'
const UNPINNED_KEY = 'extensions:unpinned'
const POPUP_WINDOW = { width: 480, height: 640 }
const MENU_ICON_SIZE = 16

interface ExtensionHost {
  window: BaseWindow
  /** Opens a tab beside the active one and returns its contents, if it could be opened. */
  createTab: (url: string | undefined, active: boolean, session: Session) => WebContents | undefined
  selectTab: (contents: WebContents) => void
  closeTab: (contents: WebContents) => void
  activeTab: () => WebContents | undefined
  /** Does what clicking the extension's toolbar button would. */
  activate: (id: string) => void
  /** The extension's own pages, such as its side panel, get the usual shortcuts and menu. */
  prepareView: (contents: WebContents) => void
  raiseOverlay: () => void
  openSettings: () => void
  onSummary: (summary: ExtensionSummary) => void
  onPanel: (state: ExtensionPanelState | null) => void
  /** Its pages can load now, including tabs that tried to before it was ready. */
  onLoaded: (id: string, newTabPage: string | null) => void
}

const extensionsPath = () => join(app.getPath('userData'), 'Extensions')

/** What pages from an extension may open: the web, and the extension's own pages. */
const mayOpen = (url: string, extensionId: string) => {
  if (/^https?:/i.test(url)) return true
  return URL.canParse(url) && new URL(url).href.startsWith(`chrome-extension://${extensionId}/`)
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

/** The manifest's picture closest in size to a menu icon, without going under it where there's a choice. */
function iconPath(manifest: Record<string, unknown>): string | null {
  const action = asRecord(manifest.action ?? manifest.browser_action)
  if (typeof action.default_icon === 'string') return action.default_icon
  const sizes = { ...asRecord(manifest.icons), ...asRecord(action.default_icon) }
  const sorted = Object.entries(sizes)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([a], [b]) => Number(a) - Number(b))
  return (sorted.find(([size]) => Number(size) >= MENU_ICON_SIZE) ?? sorted.at(-1))?.[1] ?? null
}

/**
 * Chrome extensions, from the Web Store or unpacked folders. Each session gets the extension
 * APIs and the same set of extensions, so containers have them too. Only the default session
 * can install from the store; what it installs is copied to the others.
 */
export class ExtensionManager {
  private readonly sessions = new Set<Session>()
  private readonly panels: SidePanels

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly host: ExtensionHost
  ) {
    this.panels = new SidePanels(kv, {
      window: host.window,
      activeTab: host.activeTab,
      raiseOverlay: host.raiseOverlay,
      onPanel: host.onPanel,
      onSettings: () => host.onSummary(this.summary()),
      prepare: (contents, id) => {
        host.prepareView(contents)
        contents.setWindowOpenHandler(({ url }) => {
          if (mayOpen(url, id)) host.createTab(url, true, contents.session)
          return { action: 'deny' }
        })
      }
    })
  }

  private paths(): string[] {
    return (this.kv.get(KEY) as string[] | undefined) ?? []
  }

  private unpinned(): string[] {
    return (this.kv.get(UNPINNED_KEY) as string[] | undefined) ?? []
  }

  private get primary(): Session {
    return electronSession.defaultSession
  }

  private get session(): Session {
    return this.host.activeTab()?.session ?? this.primary
  }

  private apis(session: Session): ElectronChromeExtensions {
    const existing = ElectronChromeExtensions.fromSession(session)
    if (existing) return existing
    // Goes in first: the library's own script, added below, freezes the `chrome` object.
    session.registerPreloadScript({ id: 'scb-extensions-frame', type: 'frame', filePath: join(__dirname, '../preload/extensions.js') })
    session.registerPreloadScript({ id: 'scb-extensions-worker', type: 'service-worker', filePath: join(__dirname, '../preload/extensions.js') })
    this.panels.listenToWorkers(session)
    const { host } = this
    const browserWindow = host.window as BrowserWindow
    const apis = new ElectronChromeExtensions({
      session,
      createTab: async ({ url, active }) => {
        const contents = host.createTab(url, active !== false, session)
        if (!contents) throw new Error('Could not open a tab')
        return [contents, browserWindow]
      },
      selectTab: (contents) => host.selectTab(contents),
      removeTab: (contents) => host.closeTab(contents),
      createWindow: async ({ url, type, width, height, left, top }) => {
        const urls = [url ?? []].flat()
        if (type === 'popup' || type === 'panel') return this.openPopupWindow(session, urls, { width, height, x: left, y: top })
        // There's one main window for now, so an ordinary new window's pages open as tabs.
        for (const address of urls) host.createTab(address, true, session)
        return browserWindow
      },
      // Extensions close the windows they opened, and an ordinary one is really the whole browser.
      removeWindow: (window) => {
        if (window !== browserWindow) window.destroy()
      }
    })
    // Without this, a link in a popup would open a bare window with no address bar.
    apis.on('browser-action-popup-created', (popup: { extensionId: string; browserWindow?: BrowserWindow }) => {
      popup.browserWindow?.webContents.setWindowOpenHandler(({ url }) => {
        if (mayOpen(url, popup.extensionId)) host.createTab(url, true, session)
        return { action: 'deny' }
      })
    })
    return apis
  }

  /** A small window of its own, as password managers and wallets use for prompts. */
  private async openPopupWindow(session: Session, urls: string[], bounds: { width?: number; height?: number; x?: number; y?: number }): Promise<BrowserWindow> {
    const [first, ...others] = urls
    const id = first && URL.canParse(first) ? new URL(first).host : ''
    const window = new BrowserWindow({
      ...POPUP_WINDOW,
      ...Object.fromEntries(Object.entries(bounds).filter(([, value]) => typeof value === 'number')),
      autoHideMenuBar: true,
      webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    window.removeMenu()
    const { webContents: contents } = window
    this.host.prepareView(contents)
    contents.setWindowOpenHandler(({ url }) => {
      if (mayOpen(url, id)) this.host.createTab(url, true, session)
      return { action: 'deny' }
    })
    this.apis(session).addTab(contents, window)
    void contents.loadURL(first ?? 'about:blank').catch(() => undefined)
    for (const url of others) this.host.createTab(url, true, session)
    return window
  }

  async attach(session: Session): Promise<void> {
    if (this.sessions.has(session)) return
    this.sessions.add(session)
    this.apis(session)
    session.extensions.on('extension-loaded', (_event, { id }) => this.host.onLoaded(id, this.newTabPage(session)))
    session.extensions.on('extension-unloaded', (_event, { id }) => this.panels.unloaded(id))
    if (session === this.primary) {
      ElectronChromeExtensions.handleCRXProtocol(session)
      this.followPrimary()
      await installChromeWebStore({
        session,
        extensionsPath: extensionsPath(),
        // Automated tests must not reach the network.
        autoUpdate: !process.env.SCB_E2E,
        beforeInstall: (details) => this.confirmInstall(details.localizedName, details.manifest.permissions?.length ?? 0)
      })
    } else {
      await loadAllExtensions(session, extensionsPath()).catch(() => undefined)
    }
    // One broken or deleted extension shouldn't stop the others.
    await Promise.all(this.paths().map((path) => session.extensions.loadExtension(path).catch(() => undefined)))
  }

  /** Keeps containers in step with installs and removals in the default session. */
  private followPrimary(): void {
    this.primary.extensions.on('extension-loaded', (_event, extension) => {
      for (const session of this.sessions) {
        if (!session.extensions.getExtension(extension.id)) void session.extensions.loadExtension(extension.path).catch(() => undefined)
      }
    })
    this.primary.extensions.on('extension-unloaded', (_event, extension) => {
      for (const session of this.sessions) {
        if (session !== this.primary && session.extensions.getExtension(extension.id)) session.extensions.removeExtension(extension.id)
      }
    })
  }

  private async confirmInstall(name: string, permissions: number): Promise<{ action: 'allow' | 'deny' }> {
    const { response } = await dialog.showMessageBox(this.host.window as BrowserWindow, {
      type: 'question',
      message: `Add ${name}?`,
      detail: `Extensions can read and change the pages you visit. This one asks for ${permissions} ${permissions === 1 ? 'permission' : 'permissions'}.`,
      buttons: ['Add extension', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    return { action: response === 0 ? 'allow' : 'deny' }
  }

  /** Makes a tab known to `chrome.tabs`. */
  addTab(contents: WebContents): void {
    this.apis(contents.session).addTab(contents, this.host.window)
  }

  selectTab(contents: WebContents): void {
    this.apis(contents.session).selectTab(contents)
    this.panels.followActiveTab()
  }

  /** Items extensions added to the right-click menu. */
  menuItems(contents: WebContents, params: Electron.ContextMenuParams): Electron.MenuItem[] {
    return this.apis(contents.session).getContextMenuItems(contents, params)
  }

  /** The page an extension wants in place of the new tab page. The last one added gets its way, as in Chrome. */
  newTabPage(session: Session): string | null {
    for (const { id, manifest } of session.extensions.getAllExtensions().toReversed()) {
      const path = asRecord(asRecord(manifest).chrome_url_overrides).newtab
      if (typeof path === 'string') return new URL(path, `chrome-extension://${id}/`).href
    }
    return null
  }

  list(): ExtensionInfo[] {
    const newTab = this.newTabPage(this.primary)
    return this.primary.extensions.getAllExtensions().map(({ id, name, version }) => ({ id, name, version, newTab: !!newTab?.startsWith(`chrome-extension://${id}/`) }))
  }

  summary(): ExtensionSummary {
    return { unpinned: this.unpinned(), panelOnClick: this.panels.opensOnClick() }
  }

  panelState(): ExtensionPanelState | null {
    return this.panels.state(undefined)
  }

  togglePanel(id: string): void {
    this.panels.toggle(id, this.session)
  }

  closePanel(): void {
    this.panels.close()
  }

  setPanelBounds(rect: PageRect): void {
    this.panels.setBounds(rect)
  }

  setPanelHidden(hidden: boolean): void {
    this.panels.setHidden(hidden)
  }

  private setPinned(id: string, pinned: boolean): void {
    this.kv.set(UNPINNED_KEY, pinned ? this.unpinned().filter((other) => other !== id) : [...this.unpinned(), id])
    this.host.onSummary(this.summary())
  }

  private confirmRemove(id: string, name: string): void {
    void dialog
      .showMessageBox(this.host.window as BrowserWindow, { type: 'question', message: `Remove ${name}?`, buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1 })
      .then(({ response }) => (response === 0 ? this.remove(id) : undefined))
  }

  private menuIcon(path: string, manifest: Record<string, unknown>): NativeImage | undefined {
    const file = iconPath(manifest)
    if (!file) return undefined
    const icon = nativeImage.createFromPath(join(path, file))
    return icon.isEmpty() ? undefined : icon.resize({ width: MENU_ICON_SIZE, height: MENU_ICON_SIZE })
  }

  /** A row for each extension, with what can be done with it. Shared by the toolbar button and More. */
  menu(): MenuItemConstructorOptions[] {
    const { session, host } = this
    const { unpinned, panelOnClick } = this.summary()
    const rows = session.extensions
      .getAllExtensions()
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map(({ id, name, path, manifest }): MenuItemConstructorOptions => {
        const details = asRecord(manifest)
        const hasAction = 'action' in details || 'browser_action' in details
        const hasPanel = this.panels.has(id, session)
        const options = asRecord(details.options_ui).page ?? details.options_page
        const open = this.panelState()?.extensionId === id
        return {
          label: name,
          icon: this.menuIcon(path, details),
          submenu: [
            ...(hasAction && !panelOnClick.includes(id) ? [{ label: 'Open', click: () => host.activate(id) }] : []),
            ...(hasPanel ? [{ label: open ? 'Close side panel' : 'Open side panel', click: () => this.togglePanel(id) }] : []),
            ...(typeof options === 'string' ? [{ label: 'Options', click: () => void host.createTab(new URL(options, `chrome-extension://${id}/`).href, true, session) }] : []),
            ...(hasAction ? [{ type: 'checkbox' as const, label: 'Pin to toolbar', checked: !unpinned.includes(id), click: () => this.setPinned(id, unpinned.includes(id)) }] : []),
            { type: 'separator' as const },
            { label: 'Remove…', click: () => this.confirmRemove(id, name) }
          ]
        }
      })
    return [
      ...(rows.length > 0 ? rows : [{ label: 'No extensions yet', enabled: false }]),
      { type: 'separator' },
      { label: 'Get more extensions', click: () => void host.createTab('https://chromewebstore.google.com/', true, this.primary) },
      { label: 'Manage extensions…', click: host.openSettings }
    ]
  }

  popupMenu(x: number, y: number): void {
    Menu.buildFromTemplate(this.menu()).popup({ window: this.host.window, x: Math.round(x), y: Math.round(y) })
  }

  /** Throws if the folder isn't a valid extension, leaving nothing saved. */
  async add(path: string): Promise<string> {
    const { id } = await this.primary.extensions.loadExtension(path)
    this.kv.set(KEY, [...new Set([...this.paths(), path])])
    return id
  }

  async remove(id: string): Promise<void> {
    const path = this.primary.extensions.getExtension(id)?.path
    if (path?.startsWith(extensionsPath())) await uninstallExtension(id, { session: this.primary, extensionsPath: extensionsPath() })
    else this.primary.extensions.removeExtension(id)
    this.kv.set(KEY, this.paths().filter((p) => p !== path))
    this.kv.set(UNPINNED_KEY, this.unpinned().filter((other) => other !== id))
    this.panels.forget(id)
    this.host.onSummary(this.summary())
  }
}
