import { join } from 'node:path'
import { app, dialog, session as electronSession, type BaseWindow, type BrowserWindow, type Session, type WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, loadAllExtensions, uninstallExtension } from 'electron-chrome-web-store'
import type { ExtensionInfo } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'extensions:paths'

interface ExtensionHost {
  window: BaseWindow
  /** Opens a tab and returns its contents, if it could be opened. */
  createTab: (url: string | undefined, active: boolean) => WebContents | undefined
  selectTab: (contents: WebContents) => void
  closeTab: (contents: WebContents) => void
}

const extensionsPath = () => join(app.getPath('userData'), 'Extensions')

/**
 * Chrome extensions, from the Web Store or unpacked folders. Each session gets the extension
 * APIs and the same set of extensions, so containers have them too. Only the default session
 * can install from the store; what it installs is copied to the others.
 */
export class ExtensionManager {
  private readonly sessions = new Set<Session>()

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly host: ExtensionHost
  ) {}

  private paths(): string[] {
    return (this.kv.get(KEY) as string[] | undefined) ?? []
  }

  private get primary(): Session {
    return electronSession.defaultSession
  }

  private apis(session: Session): ElectronChromeExtensions {
    const { host } = this
    const browserWindow = host.window as BrowserWindow
    return (
      ElectronChromeExtensions.fromSession(session) ??
      new ElectronChromeExtensions({
        session,
        createTab: async ({ url, active }) => {
          const contents = host.createTab(url, active !== false)
          if (!contents) throw new Error('Could not open a tab')
          return [contents, browserWindow]
        },
        selectTab: (contents) => host.selectTab(contents),
        removeTab: (contents) => host.closeTab(contents),
        // There's one window for now, so extension windows, such as sign-in prompts, open as tabs.
        createWindow: async ({ url }) => {
          for (const address of [url ?? []].flat()) host.createTab(address, true)
          return browserWindow
        }
      })
    )
  }

  async attach(session: Session): Promise<void> {
    if (this.sessions.has(session)) return
    this.sessions.add(session)
    this.apis(session)
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
  }

  /** Items extensions added to the right-click menu. */
  menuItems(contents: WebContents, params: Electron.ContextMenuParams): Electron.MenuItem[] {
    return this.apis(contents.session).getContextMenuItems(contents, params)
  }

  list(): ExtensionInfo[] {
    return this.primary.extensions.getAllExtensions().map(({ id, name, version }) => ({ id, name, version }))
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
  }
}
