import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeImage, session as electronSession, type BaseWindow, type MenuItemConstructorOptions, type NativeImage, type Session, type WebContents, type WebContentsView } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, loadAllExtensions, uninstallExtension } from 'electron-chrome-web-store'
import { EXTENSIONS_POPUP, type ExtensionInfo, type ExtensionPanelState, type ExtensionRow, type ExtensionSummary, type ExtensionsPopupState, type PageRect } from '@scbrowser/shared'
import { SidePanels } from './extensionPanel'
import { ExtensionPopover } from './extensionPopover'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'extensions:paths'
const UNPINNED_KEY = 'extensions:unpinned'
/** Turned off but still installed. Their files stay where they are, ready to load again. */
const DISABLED_KEY = 'extensions:disabled'
const POPUP_WINDOW = { width: 480, height: 640 }
const MENU_ICON_SIZE = 16

interface ExtensionHost {
  /** The browser window in use. */
  window: () => BaseWindow
  /** How extensions show themselves: a panel under the toolbar, or their own windows and side panels. */
  display: () => 'panel' | 'window'
  /** Draws a panel's border in the overlay, and keeps its view above that. */
  setFrame: (window: BaseWindow, rect: PageRect | null, view: WebContentsView | null) => void
  /** Shows the list, or takes it away if it's open, unless this is only to `refresh` what it says. */
  openPopup: (window: BaseWindow, popup: ExtensionsPopupState, refresh?: boolean) => void
  /** The window holding this tab. */
  ownerWindow: (contents: WebContents) => BaseWindow
  /** A browser window, rather than one of an extension's own. */
  isBrowserWindow: (window: BaseWindow) => boolean
  /** Opens a tab beside the active one and returns its contents, if it could be opened. */
  createTab: (url: string | undefined, active: boolean, session: Session) => WebContents | undefined
  selectTab: (contents: WebContents) => void
  closeTab: (contents: WebContents) => void
  /** The open tab in this window, or in the window in use. */
  activeTab: (window?: BaseWindow | null) => WebContents | undefined
  /** Does what clicking the extension's toolbar button would. */
  activate: (id: string) => void
  /** The extension's own pages, such as its side panel, get the usual shortcuts and menu. */
  prepareView: (contents: WebContents) => void
  raiseOverlay: (window: BaseWindow) => void
  openSettings: () => void
  onSummary: (summary: ExtensionSummary) => void
  onPanel: (state: ExtensionPanelState | null, window: BaseWindow) => void
  /** Its pages can load now, including tabs that tried to before it was ready. */
  onLoaded: (id: string, newTabPage: string | null) => void
}

const extensionsPath = () => join(app.getPath('userData'), 'Extensions')

/** What pages from an extension may open: the web, and the extension's own pages. */
const mayOpen = (url: string, extensionId: string) => {
  if (/^https?:/i.test(url)) return true
  return URL.canParse(url) && new URL(url).href.startsWith(`chrome-extension://${extensionId}/`)
}

interface DisabledExtension {
  id: string
  name: string
  version: string
  path: string
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
  private readonly popover: ExtensionPopover
  private readonly anchors = new WeakMap<BaseWindow, PageRect>()
  /** The library calls every tab it's told about the active one, which mustn't reach the real tabs. */
  private adding = false

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly host: ExtensionHost
  ) {
    const prepare = (contents: WebContents, id: string) => {
      host.prepareView(contents)
      contents.setWindowOpenHandler(({ url }) => {
        if (mayOpen(url, id)) host.createTab(url, true, contents.session)
        return { action: 'deny' }
      })
    }
    this.popover = new ExtensionPopover({
      anchor: (window) => this.anchors.get(window),
      prepare,
      frame: host.setFrame
    })
    this.panels = new SidePanels(kv, {
      window: () => host.window(),
      activeTab: host.activeTab,
      raiseOverlay: host.raiseOverlay,
      onPanel: host.onPanel,
      onSettings: () => host.onSummary(this.summary()),
      prepare,
      showInPopover: (id, url, session) => {
        if (host.display() !== 'panel') return false
        this.popover.open({ extensionId: id, url, session, window: host.window(), kind: 'tall' })
        return true
      },
      closePopover: (id) => this.popover.closeFor(id)
    })
  }

  private paths(): string[] {
    return (this.kv.get(KEY) as string[] | undefined) ?? []
  }

  private unpinned(): string[] {
    return (this.kv.get(UNPINNED_KEY) as string[] | undefined) ?? []
  }

  private disabled(): DisabledExtension[] {
    return (this.kv.get(DISABLED_KEY) as DisabledExtension[] | undefined) ?? []
  }

  private isDisabled(id: string): boolean {
    return this.disabled().some((extension) => extension.id === id)
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
    const apis = new ElectronChromeExtensions({
      session,
      createTab: async ({ url, active }) => {
        const contents = host.createTab(url, active !== false, session)
        if (!contents) throw new Error('Could not open a tab')
        return [contents, host.ownerWindow(contents) as BrowserWindow]
      },
      selectTab: (contents) => {
        if (!this.adding) host.selectTab(contents)
      },
      removeTab: (contents) => host.closeTab(contents),
      createWindow: async ({ url, type, width, height, left, top }) => {
        const urls = [url ?? []].flat()
        if ((type === 'popup' || type === 'panel') && host.display() === 'panel') return this.openInPopover(session, urls, width, height)
        if (type === 'popup' || type === 'panel') return this.openPopupWindow(session, urls, { width, height, x: left, y: top })
        // An ordinary new window's pages open as tabs in the window in use.
        for (const address of urls) host.createTab(address, true, session)
        return host.window() as BrowserWindow
      },
      // Extensions close the windows they opened, and an ordinary one is really the whole browser.
      removeWindow: (window) => {
        if (host.isBrowserWindow(window)) this.popover.closeIfWindow()
        else window.destroy()
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

  /** What would be a small window, in the panel. Sign-ins and other websites need a real tab's room. */
  private openInPopover(session: Session, urls: string[], width?: number, height?: number): BrowserWindow {
    const window = this.host.window()
    const pages = urls.filter((url) => URL.canParse(url) && new URL(url).protocol === 'chrome-extension:')
    const [first] = pages
    if (first) this.popover.open({ extensionId: new URL(first).host, url: first, session, window, kind: 'tall', width, height, asWindow: true })
    for (const url of urls.filter((other) => other !== first)) this.host.createTab(url, true, session)
    return window as BrowserWindow
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
    session.extensions.on('extension-loaded', (_event, { id }) => {
      // The Web Store library loads everything in its folder, with no way of leaving one out.
      if (this.isDisabled(id)) setImmediate(() => session.extensions.removeExtension(id))
      else this.host.onLoaded(id, this.newTabPage(session))
    })
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
        if (!this.isDisabled(extension.id) && !session.extensions.getExtension(extension.id)) void session.extensions.loadExtension(extension.path).catch(() => undefined)
      }
    })
    this.primary.extensions.on('extension-unloaded', (_event, extension) => {
      for (const session of this.sessions) {
        if (session !== this.primary && session.extensions.getExtension(extension.id)) session.extensions.removeExtension(extension.id)
      }
    })
  }

  private async confirmInstall(name: string, permissions: number): Promise<{ action: 'allow' | 'deny' }> {
    const { response } = await dialog.showMessageBox(this.host.window() as BrowserWindow, {
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
  addTab(contents: WebContents, window: BaseWindow): void {
    const apis = this.apis(contents.session)
    this.adding = true
    try {
      apis.addTab(contents, window as BrowserWindow)
      // A tab opened in the background leaves extensions seeing the one that's really open.
      const active = this.host.activeTab(window)
      // Each session has its own record, so a tab in another container isn't for this one to know.
      if (active && active !== contents && active.session === contents.session) apis.selectTab(active)
    } finally {
      this.adding = false
    }
  }

  selectTab(contents: WebContents): void {
    this.popover.close()
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
    const loaded = this.primary.extensions.getAllExtensions().filter(({ id }) => !this.isDisabled(id))
    return [
      ...loaded.map(({ id, name, version }) => ({ id, name, version, enabled: true, newTab: !!newTab?.startsWith(`chrome-extension://${id}/`) })),
      ...this.disabled().map(({ id, name, version }) => ({ id, name, version, enabled: false, newTab: false }))
    ].toSorted((a, b) => a.name.localeCompare(b.name))
  }

  summary(): ExtensionSummary {
    return { display: this.host.display(), unpinned: this.unpinned(), panelOnClick: this.panels.opensOnClick() }
  }

  /** A panel sits in one window. Others leave no room for it. */
  panelState(window?: BaseWindow): ExtensionPanelState | null {
    return !window || this.panels.ownedBy(window) ? this.panels.state(undefined) : null
  }

  togglePanel(id: string): void {
    this.panels.toggle(id, this.session)
  }

  closePanel(): void {
    this.panels.close()
  }

  setPanelBounds(rect: PageRect, window: BaseWindow): void {
    if (this.panels.ownedBy(window)) this.panels.setBounds(rect)
  }

  setPanelHidden(hidden: boolean, window: BaseWindow): void {
    if (hidden && this.popover.ownedBy(window)) this.popover.close()
    if (this.panels.ownedBy(window)) this.panels.setHidden(hidden)
  }

  setAnchor(rect: PageRect, window: BaseWindow): void {
    this.anchors.set(window, rect)
  }

  /** Whatever's open the other way shouldn't stay behind, and the toolbar has to know. */
  displayChanged(): void {
    this.panels.close()
    this.popover.close()
    this.host.onSummary(this.summary())
  }

  /** What pressing its button does: its popup, else its side panel if it asked for that, else it's told. */
  open(id: string): void {
    const { session, host } = this
    const tab = host.activeTab()
    const api = (this.apis(session) as unknown as { api: { browserAction: { getPopupUrl(id: string, tabId: number): string | null | undefined } } }).api
    const popup = tab ? api.browserAction.getPopupUrl(id, tab.id) : null
    if (host.display() === 'panel' && popup) {
      this.popover.open({ extensionId: id, url: popup, session, window: host.window(), kind: 'fit' })
    } else if (this.panels.opensOnClick().includes(id) && this.panels.has(id, session)) {
      this.panels.toggle(id, session)
    } else {
      host.activate(id)
    }
  }

  private rows(): ExtensionRow[] {
    const { unpinned } = this.summary()
    return this.session.extensions
      .getAllExtensions()
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map(({ id, name, path, manifest }) => {
        const details = asRecord(manifest)
        return {
          id,
          name,
          icon: this.menuIcon(path, details)?.toDataURL() ?? null,
          pinned: !unpinned.includes(id),
          hasAction: 'action' in details || 'browser_action' in details
        }
      })
  }

  /** The buttons in the list hanging from the toolbar. */
  listAction(action: 'open' | 'pin' | 'menu' | 'store' | 'manage', id: string, x: number, y: number, window: BaseWindow): void {
    const { host, session } = this
    if (action === 'store') return void host.createTab('https://chromewebstore.google.com/', true, this.primary)
    if (action === 'manage') return host.openSettings()
    if (!session.extensions.getExtension(id)) return
    if (action === 'open') return this.open(id)
    if (action === 'pin') {
      this.setPinned(id, this.unpinned().includes(id))
      return this.refreshList(window)
    }
    const row = this.menu().find((candidate) => candidate.id === id)
    if (Array.isArray(row?.submenu)) Menu.buildFromTemplate(row.submenu).popup({ window, x: Math.round(x), y: Math.round(y) })
  }

  private refreshList(window: BaseWindow): void {
    this.host.openPopup(window, this.popupState(window), true)
  }

  private popupState(window: BaseWindow): ExtensionsPopupState {
    const rows = this.rows()
    const anchor = this.anchors.get(window)
    const { width: windowWidth } = window.getContentBounds()
    const right = anchor ? anchor.x + anchor.width : windowWidth - 8
    const height = Math.min(EXTENSIONS_POPUP.maxHeight, EXTENSIONS_POPUP.chrome + Math.max(1, rows.length) * EXTENSIONS_POPUP.rowHeight)
    return { rows, height, x: Math.max(8, right - EXTENSIONS_POPUP.width), y: (anchor ? anchor.y + anchor.height : 44) + 4 }
  }

  windowClosed(window: BaseWindow): void {
    if (this.popover.ownedBy(window)) this.popover.close()
    if (this.panels.ownedBy(window)) this.panels.close()
  }

  private setPinned(id: string, pinned: boolean): void {
    this.kv.set(UNPINNED_KEY, pinned ? this.unpinned().filter((other) => other !== id) : [...this.unpinned(), id])
    this.host.onSummary(this.summary())
  }

  private confirmRemove(id: string, name: string): void {
    void dialog
      .showMessageBox(this.host.window() as BrowserWindow, { type: 'question', message: `Remove ${name}?`, buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1 })
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
          id,
          label: name,
          icon: this.menuIcon(path, details),
          submenu: [
            ...(hasAction && !panelOnClick.includes(id) ? [{ label: 'Open', click: () => this.open(id) }] : []),
            ...(hasPanel ? [{ label: open ? 'Close side panel' : 'Open side panel', click: () => this.togglePanel(id) }] : []),
            ...(typeof options === 'string' ? [{ label: 'Options', click: () => void host.createTab(new URL(options, `chrome-extension://${id}/`).href, true, session) }] : []),
            ...(hasAction ? [{ type: 'checkbox' as const, label: 'Pin to toolbar', checked: !unpinned.includes(id), click: () => this.setPinned(id, unpinned.includes(id)) }] : []),
            { type: 'separator' as const },
            { label: 'Turn off', click: () => void this.setEnabled(id, false) },
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
    if (this.host.display() === 'panel') {
      const window = this.host.window()
      this.host.openPopup(window, this.popupState(window))
      return
    }
    Menu.buildFromTemplate(this.menu()).popup({ window: this.host.window(), x: Math.round(x), y: Math.round(y) })
  }

  /** Turning one off unloads it everywhere and leaves its files, its settings and its place in the list. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const off = this.disabled().find((extension) => extension.id === id)
    if (enabled && off) {
      this.kv.set(DISABLED_KEY, this.disabled().filter((extension) => extension.id !== id))
      const loaded = await this.primary.extensions.loadExtension(off.path).catch(() => null)
      const worker = asRecord(asRecord(loaded?.manifest).background).service_worker
      if (loaded && worker) await this.primary.serviceWorkers.startWorkerForScope(`chrome-extension://${id}`).catch(() => undefined)
    } else if (!enabled && !off) {
      const extension = this.primary.extensions.getExtension(id)
      if (!extension) return
      const { name, version, path } = extension
      this.kv.set(DISABLED_KEY, [...this.disabled(), { id, name, version, path }])
      this.primary.extensions.removeExtension(id)
    }
    this.host.onSummary(this.summary())
  }

  /** Throws if the folder isn't a valid extension, leaving nothing saved. */
  async add(path: string): Promise<string> {
    const { id } = await this.primary.extensions.loadExtension(path)
    this.kv.set(KEY, [...new Set([...this.paths(), path])])
    return id
  }

  async remove(id: string): Promise<void> {
    const path = this.primary.extensions.getExtension(id)?.path ?? this.disabled().find((extension) => extension.id === id)?.path
    this.kv.set(DISABLED_KEY, this.disabled().filter((extension) => extension.id !== id))
    if (path?.startsWith(extensionsPath())) await uninstallExtension(id, { session: this.primary, extensionsPath: extensionsPath() })
    else this.primary.extensions.removeExtension(id)
    this.kv.set(KEY, this.paths().filter((p) => p !== path))
    this.kv.set(UNPINNED_KEY, this.unpinned().filter((other) => other !== id))
    this.panels.forget(id)
    this.host.onSummary(this.summary())
  }
}
