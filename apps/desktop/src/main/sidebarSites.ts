import { session, WebContentsView, type BaseWindow, type WebContents } from 'electron'
import type { PageRect, SidebarSiteState } from '@scbrowser/shared'
import { isPreviewUrl } from './filePreview'

/** Sites kept loaded after switching away, so a chat stays connected. The oldest goes past this. */
const KEEP_LOADED = 4

interface SidebarHost {
  window: BaseWindow
  /** Shortcuts and the right-click menu, as a tab would have. */
  prepare: (contents: WebContents) => void
  onState: (state: SidebarSiteState | null) => void
  /** Anything the overlay draws has to stay above the panel. */
  raiseOverlay: () => void
  openTab: (url: string) => void
  /** Lets the site blocker see the panel's loads, handing anything blocked back to open as a tab. */
  watch: (contents: WebContents, onBlocked: (url: string) => void) => void
}

interface Loaded {
  view: WebContentsView
  usedAt: number
}

/**
 * Sites in a panel at the right edge, beside whatever page is open, like Opera's and Vivaldi's
 * web panels. They share the browser's own session, so the person is already signed in.
 */
export class SidebarSites {
  private readonly loaded = new Map<string, Loaded>()
  private shown: string | null = null
  private rect: PageRect = { x: 0, y: 0, width: 0, height: 0 }
  /** Why it's out of sight: a sidebar being dragged, or a page's video filling the window. */
  private readonly hiddenFor = new Set<'resizing' | 'fullscreen'>()

  constructor(private readonly host: SidebarHost) {}

  state(): SidebarSiteState | null {
    const contents = this.shown ? this.loaded.get(this.shown)?.view.webContents : undefined
    if (!this.shown || !contents || contents.isDestroyed()) return null
    return { url: contents.getURL() || this.shown, home: this.shown, title: contents.getTitle(), canGoBack: contents.navigationHistory.canGoBack(), loading: contents.isLoading() }
  }

  owns(contents: WebContents): boolean {
    return [...this.loaded.values()].some(({ view }) => view.webContents === contents)
  }

  toggle(url: string): void {
    if (this.shown === url) this.close()
    else this.open(url)
  }

  open(url: string): void {
    if (!/^https?:\/\//i.test(url)) return
    const previous = this.shown && this.loaded.get(this.shown)
    if (previous) previous.view.setVisible(false)
    let entry = this.loaded.get(url)
    if (!entry) {
      entry = { view: this.create(url), usedAt: Date.now() }
      this.loaded.set(url, entry)
      this.evict()
    }
    entry.usedAt = Date.now()
    this.shown = url
    entry.view.setBounds(this.rect)
    entry.view.setVisible(this.hiddenFor.size === 0 && this.rect.width > 0)
    this.host.raiseOverlay()
    this.publish()
  }

  private create(home: string): WebContentsView {
    const view = new WebContentsView({ webPreferences: { session: session.defaultSession, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const contents = view.webContents
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    this.host.window.contentView.addChildView(view)
    this.host.prepare(contents)
    this.host.watch(contents, (blocked) => {
      this.remove(home)
      this.host.openTab(blocked)
    })
    const publish = () => {
      if (this.shown === home) this.publish()
    }
    for (const event of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page'] as const) contents.on(event as 'did-stop-loading', publish)
    // A panel keeps to the web: no scTerra pages, and no previews of the assistant's files.
    contents.on('will-navigate', (event) => {
      if (!/^https?:/i.test(event.url)) event.preventDefault()
    })
    contents.on('will-redirect', (event) => {
      if (!/^https?:/i.test(event.url)) event.preventDefault()
    })
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && (event.url.startsWith('sc:') || isPreviewUrl(event.url))) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.host.openTab(url)
      return { action: 'deny' }
    })
    contents.on('render-process-gone', () => this.remove(home))
    void contents.loadURL(home).catch(() => undefined)
    return view
  }

  /** Unloads the longest unused site that isn't showing. */
  private evict(): void {
    while (this.loaded.size > KEEP_LOADED) {
      const [oldest] = [...this.loaded.entries()].filter(([url]) => url !== this.shown).sort((a, b) => a[1].usedAt - b[1].usedAt)[0] ?? []
      if (!oldest) return
      this.remove(oldest)
    }
  }

  /** Closes the panel. The site stays loaded for a while, so opening it again is quick. */
  close(): void {
    const entry = this.shown && this.loaded.get(this.shown)
    if (entry) entry.view.setVisible(false)
    this.shown = null
    this.publish()
  }

  /** Unloads a site, as when it's taken out of the rail. */
  remove(url: string): void {
    const entry = this.loaded.get(url)
    if (!entry) return
    this.loaded.delete(url)
    if (this.shown === url) this.shown = null
    if (!this.host.window.isDestroyed()) this.host.window.contentView.removeChildView(entry.view)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    this.publish()
  }

  /** Where the browser's interface left room for the page, under the panel's header. */
  setBounds(rect: PageRect): void {
    this.rect = rect
    const entry = this.shown && this.loaded.get(this.shown)
    if (!entry) return
    entry.view.setBounds(rect)
    entry.view.setVisible(this.hiddenFor.size === 0 && rect.width > 0)
  }

  setHidden(hidden: boolean, reason: 'resizing' | 'fullscreen'): void {
    if (hidden) this.hiddenFor.add(reason)
    else this.hiddenFor.delete(reason)
    const entry = this.shown && this.loaded.get(this.shown)
    if (entry) entry.view.setVisible(this.hiddenFor.size === 0 && this.rect.width > 0)
  }

  act(action: 'back' | 'reload' | 'open-tab' | 'close'): void {
    if (action === 'close') return this.close()
    const contents = this.shown ? this.loaded.get(this.shown)?.view.webContents : undefined
    if (!contents || contents.isDestroyed()) return
    if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    else if (action === 'reload') contents.reload()
    else if (action === 'open-tab') {
      const url = contents.getURL()
      this.close()
      if (/^https?:/i.test(url)) this.host.openTab(url)
    }
  }

  /** Unloads anything no longer in the rail, as when it's removed from another window or synced away. */
  prune(kept: string[]): void {
    for (const url of [...this.loaded.keys()]) if (!kept.includes(url)) this.remove(url)
  }

  destroy(): void {
    for (const url of [...this.loaded.keys()]) this.remove(url)
  }

  private publish(): void {
    this.host.onState(this.state())
  }
}
