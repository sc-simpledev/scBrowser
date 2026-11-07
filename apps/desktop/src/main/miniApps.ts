import { randomUUID } from 'node:crypto'
import { BrowserWindow, session, type Session } from 'electron'
import { previewKind, safeFileName } from '@scbrowser/shared'
import { MAX_PREVIEW_CHARS, PREVIEW_CSP } from './filePreview'
import type { KeyValueRepo } from './storage/kv'

export const MINI_APP_SCHEME = 'sc-app'
const KEY = 'mini-apps'
const PARTITION = 'persist:scterra-mini-apps'
const MAX_APPS = 30

/**
 * Like a preview's policy: nothing can be fetched, sent or loaded from anywhere. Without the
 * sandbox, so the app has an origin of its own and its saved data lasts between runs.
 */
const APP_CSP = PREVIEW_CSP.split('; ').filter((rule) => !rule.startsWith('sandbox')).join('; ')

export interface MiniApp {
  id: string
  name: string
  content: string
  createdAt: number
}

/**
 * Pages the assistant wrote, kept to open as small windows of their own. They run in a session
 * kept apart from browsing, with no bridge to scTerra, no permissions and no way onto the network,
 * because what a model writes can be steered by the pages it read.
 */
export class MiniApps {
  private handled = false
  private readonly open = new Map<string, BrowserWindow>()

  constructor(private readonly kv: KeyValueRepo) {}

  list(): MiniApp[] {
    const saved = this.kv.get(KEY)
    return Array.isArray(saved) ? (saved as MiniApp[]) : []
  }

  /** Keeps an HTML file as an app. The same name replaces the older one, as with a new version. */
  keep(name: string, content: string): MiniApp {
    if (previewKind(name) !== 'html') throw new Error('Only web pages (.html) can be kept as apps.')
    if (content.length > MAX_PREVIEW_CHARS) throw new Error('That file is too big to keep.')
    const clean = safeFileName(name).replace(/\.html?$/i, '') || 'App'
    const all = this.list()
    const existing = all.find((app) => app.name === clean)
    if (!existing && all.length >= MAX_APPS) throw new Error(`You can keep ${MAX_APPS} apps at most. Remove one in Settings first.`)
    const app: MiniApp = { id: existing?.id ?? randomUUID(), name: clean, content, createdAt: Date.now() }
    this.kv.set(KEY, [app, ...all.filter((other) => other !== existing)])
    this.open.get(app.id)?.webContents.reload()
    return app
  }

  remove(id: string): void {
    this.kv.set(KEY, this.list().filter((app) => app.id !== id))
    this.open.get(id)?.close()
    // Its saved data goes with it.
    void this.session().clearStorageData({ origin: `${MINI_APP_SCHEME}://${id}` }).catch(() => undefined)
  }

  private session(): Session {
    const target = session.fromPartition(PARTITION)
    if (!this.handled) {
      this.handled = true
      target.protocol.handle(MINI_APP_SCHEME, (request) => {
        const app = this.list().find((candidate) => candidate.id === new URL(request.url).host)
        const headers = { 'content-security-policy': APP_CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
        return app
          ? new Response(app.content, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
          : new Response('This app has been removed.', { status: 404, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } })
      })
      // Cameras, notifications, the clipboard and the rest are never granted.
      target.setPermissionRequestHandler((_contents, _permission, respond) => respond(false))
      target.setPermissionCheckHandler(() => false)
    }
    return target
  }

  /** Opens it in a window of its own, or brings that window forward if it's already open. */
  launch(id: string, icon?: string): void {
    const app = this.list().find((candidate) => candidate.id === id)
    if (!app) throw new Error("That app isn't kept any more.")
    const existing = this.open.get(id)
    if (existing && !existing.isDestroyed()) return existing.focus()
    const window = new BrowserWindow({
      width: 900,
      height: 700,
      title: app.name,
      autoHideMenuBar: true,
      ...(icon ? { icon } : {}),
      webPreferences: { session: this.session(), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false }
    })
    window.setMenu(null)
    this.open.set(id, window)
    window.on('closed', () => this.open.delete(id))
    const contents = window.webContents
    const home = `${MINI_APP_SCHEME}://${id}/`
    // It stays on its own page: links out go nowhere, as the app can't be trusted to send people on.
    contents.on('will-navigate', (event) => {
      if (!event.url.startsWith(home)) event.preventDefault()
    })
    contents.on('will-redirect', (event) => event.preventDefault())
    contents.on('will-frame-navigate', (event) => {
      if (!event.url.startsWith(home) && !event.url.startsWith('about:')) event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      window.setTitle(title ? `${title} — ${app.name}` : app.name)
    })
    void window.loadURL(home)
  }
}
