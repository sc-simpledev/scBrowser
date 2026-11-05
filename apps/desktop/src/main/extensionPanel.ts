import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, WebContentsView, type BaseWindow, type IpcMainInvokeEvent, type IpcMainServiceWorkerInvokeEvent, type Session, type WebContents } from 'electron'
import { SIDE_PANEL_CHANNEL, type ExtensionPanelState, type PageRect } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'extensions:side-panels'

interface PanelOptions {
  path?: string
  enabled?: boolean
}

/** What an extension has asked for that Chrome would remember between runs. */
interface SavedPanel extends PanelOptions {
  openOnClick?: boolean
}

interface PanelHost {
  /** The browser window in use, where a panel opens. */
  window: () => BaseWindow
  activeTab: (window?: BaseWindow | null) => WebContents | undefined
  /** The panel's page, for shortcuts, the right-click menu and links. */
  prepare: (contents: WebContents, extensionId: string) => void
  /** Anything drawn over pages has to stay above the panel. */
  raiseOverlay: (window: BaseWindow) => void
  onPanel: (state: ExtensionPanelState | null, window: BaseWindow) => void
  onSettings: () => void
  /** Shows it in the panel under the toolbar, if that's how extensions are set to open. */
  showInPopover: (id: string, url: string, session: Session) => boolean
  closePopover: (id: string) => void
}

const idFromUrl = (url: string | undefined): string | null => {
  if (!url || !URL.canParse(url)) return null
  const { protocol, host } = new URL(url)
  return protocol === 'chrome-extension:' ? host : null
}

/**
 * `chrome.sidePanel`: one extension's page at a time, beside the page. Chrome can keep a panel to
 * one tab, but here it stays open across tabs unless an extension has turned it off for a tab.
 */
export class SidePanels {
  private view: WebContentsView | null = null
  private owner: BaseWindow | null = null
  private extensionId: string | null = null
  private url: string | null = null
  private rect: PageRect = { x: 0, y: 0, width: 0, height: 0 }
  private hidden = false
  private readonly tabOptions = new Map<string, Map<number, PanelOptions>>()
  private readonly workers = new WeakSet<object>()

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly host: PanelHost
  ) {
    ipcMain.removeHandler(SIDE_PANEL_CHANNEL)
    ipcMain.handle(SIDE_PANEL_CHANNEL, (event: IpcMainInvokeEvent, method: string, ...args: unknown[]) => {
      const id = idFromUrl(event.senderFrame?.url)
      if (!id) throw new Error('Only extension pages can use the side panel')
      return this.call(id, event.sender.session, method, args[0] as Record<string, unknown> | undefined)
    })
  }

  /** Workers talk over their own channel, which has to be set up as each one starts. */
  listenToWorkers(session: Session): void {
    session.serviceWorkers.on('running-status-changed', ({ runningStatus, versionId }) => {
      if (runningStatus !== 'starting') return
      const worker = session.serviceWorkers.getWorkerFromVersionID(versionId)
      if (!worker?.scope.startsWith('chrome-extension://') || this.workers.has(worker)) return
      this.workers.add(worker)
      worker.ipc.handle(SIDE_PANEL_CHANNEL, (_event: IpcMainServiceWorkerInvokeEvent, method: string, ...args: unknown[]) => {
        const id = idFromUrl(worker.scope)
        if (!id) throw new Error('Only extensions can use the side panel')
        return this.call(id, session, method, args[0] as Record<string, unknown> | undefined)
      })
    })
  }

  private call(id: string, session: Session, method: string, details: Record<string, unknown> = {}): unknown {
    switch (method) {
      case 'open':
        return void this.open(id, session)
      case 'close':
        if (this.extensionId === id) this.close()
        this.host.closePopover(id)
        return undefined
      case 'setPanelBehavior':
        this.save(id, { openOnClick: details.openPanelOnActionClick === true })
        return this.host.onSettings()
      case 'getPanelBehavior':
        return { openPanelOnActionClick: this.saved()[id]?.openOnClick === true }
      case 'setOptions':
        return this.setOptions(id, details)
      case 'getOptions': {
        const tabId = typeof details.tabId === 'number' ? details.tabId : undefined
        const options = { ...this.saved()[id], ...(tabId === undefined ? {} : this.tabOptions.get(id)?.get(tabId)) }
        return { path: options.path ?? this.defaultPath(id, session), enabled: options.enabled !== false, ...(tabId === undefined ? {} : { tabId }) }
      }
      default:
        throw new Error(`chrome.sidePanel.${method} isn't available`)
    }
  }

  private setOptions(id: string, { tabId, path, enabled }: Record<string, unknown>): void {
    const options: PanelOptions = {
      ...(typeof path === 'string' ? { path } : {}),
      ...(typeof enabled === 'boolean' ? { enabled } : {})
    }
    if (typeof tabId === 'number') {
      const tabs = this.tabOptions.get(id) ?? new Map<number, PanelOptions>()
      tabs.set(tabId, { ...tabs.get(tabId), ...options })
      this.tabOptions.set(id, tabs)
    } else {
      this.save(id, options)
    }
    if (this.extensionId === id) this.followActiveTab()
  }

  private saved(): Record<string, SavedPanel> {
    return (this.kv.get(KEY) as Record<string, SavedPanel> | undefined) ?? {}
  }

  private save(id: string, change: SavedPanel): void {
    const all = this.saved()
    this.kv.set(KEY, { ...all, [id]: { ...all[id], ...change } })
  }

  private defaultPath(id: string, session: Session): string | undefined {
    const folder = session.extensions.getExtension(id)?.path
    if (!folder) return undefined
    try {
      // Electron leaves this key out of the manifest it hands back, as Chromium's side panel isn't part of it.
      const path = (JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as { side_panel?: { default_path?: unknown } }).side_panel?.default_path
      return typeof path === 'string' ? path : undefined
    } catch {
      return undefined
    }
  }

  /** What the extension's panel should show on this tab, or null if it has none there. */
  private urlFor(id: string, session: Session, tab: WebContents | undefined): string | null {
    const options = { ...this.saved()[id], ...(tab ? this.tabOptions.get(id)?.get(tab.id) : undefined) }
    const path = options.path ?? this.defaultPath(id, session)
    if (options.enabled === false || !path) return null
    const root = `chrome-extension://${id}/`
    const { href } = new URL(path, root)
    return href.startsWith(root) ? href : null
  }

  has(id: string, session: Session): boolean {
    return this.urlFor(id, session, this.host.activeTab(this.owner)) !== null
  }

  opensOnClick(): string[] {
    return Object.entries(this.saved()).flatMap(([id, panel]) => (panel.openOnClick ? [id] : []))
  }

  state(session: Session | undefined): ExtensionPanelState | null {
    const id = this.extensionId
    const name = id && (session ?? this.view?.webContents.session)?.extensions.getExtension(id)?.name
    return id ? { extensionId: id, name: name || 'Extension' } : null
  }

  open(id: string, session: Session): void {
    const window = this.host.window()
    const url = this.urlFor(id, session, this.host.activeTab(window))
    if (!url) throw new Error('This extension has no side panel here')
    if (this.host.showInPopover(id, url, session)) return
    if (this.view && (this.view.webContents.session !== session || this.owner !== window)) this.close()
    if (!this.view) {
      this.owner = window
      this.view = new WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } })
      this.view.setVisible(!this.hidden)
      this.view.setBounds(this.rect)
      window.contentView.addChildView(this.view)
      this.host.raiseOverlay(window)
    }
    const changed = this.extensionId !== id
    this.extensionId = id
    if (changed) this.host.prepare(this.view.webContents, id)
    if (url !== this.url) this.load(url)
    this.host.onPanel(this.state(session), window)
  }

  toggle(id: string, session: Session): void {
    if (this.extensionId === id) this.close()
    else this.open(id, session)
  }

  close(): void {
    const { view, owner } = this
    if (!view || !owner) return
    if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
    this.view = null
    this.owner = null
    this.extensionId = null
    this.url = null
    if (!owner.isDestroyed()) this.host.onPanel(null, owner)
  }

  private load(url: string): void {
    this.url = url
    void this.view?.webContents.loadURL(url).catch(() => undefined)
  }

  /** Each tab can have its own panel page, or none, and tabs in a container have their own session. */
  followActiveTab(): void {
    if (!this.view || !this.extensionId) return
    const tab = this.host.activeTab(this.owner)
    const session = this.view.webContents.session
    const url = tab?.session === session ? this.urlFor(this.extensionId, session, tab) : null
    if (!url) this.close()
    else if (url !== this.url) this.load(url)
  }

  ownedBy(window: BaseWindow): boolean {
    return this.owner === window
  }

  setBounds(rect: PageRect): void {
    this.rect = rect
    this.view?.setBounds(rect)
  }

  /** For dragging a sidebar's edge, and for video that fills the window. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden
    this.view?.setVisible(!hidden)
  }

  /** The extension is going away, so nothing of its panel should be left behind. */
  unloaded(id: string): void {
    if (this.extensionId === id) this.close()
    this.tabOptions.delete(id)
  }

  forget(id: string): void {
    const { [id]: _removed, ...others } = this.saved()
    this.kv.set(KEY, others)
  }
}
