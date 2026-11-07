import { WebContentsView, type BaseWindow, type Input, type Session, type WebContents } from 'electron'
import { linkPreviewLayout, type LinkPreviewState, type PageRect } from '@scbrowser/shared'
import { isPreviewUrl } from './filePreview'

interface PreviewHost {
  window: BaseWindow
  /** The area pages fill, which the preview sits in the middle of. */
  page: () => PageRect
  /** Draws the backdrop, card and header in the overlay, with the page's view kept above it. */
  show: (state: LinkPreviewState | null, view: WebContentsView | null) => void
  /** Shortcuts and the right-click menu, as a tab would have. */
  prepare: (contents: WebContents) => void
  /** Links that want a window of their own, and pages the site blocker stops, go to real tabs. */
  openTab: (url: string, how: 'open' | 'background' | 'split') => void
  /** Lets the site blocker see this page's loads, as it does for tabs. */
  watch: (contents: WebContents, onBlocked: (url: string) => void) => void
}

/**
 * A link opened over the page without making a tab, like Arc's peek. Shift-click a link, or pick
 * Preview link from its menu. It shares the tab's session, so the person stays signed in.
 */
export class LinkPreview {
  private view: WebContentsView | null = null
  private state: LinkPreviewState | null = null

  constructor(private readonly host: PreviewHost) {}

  get isOpen(): boolean {
    return this.view !== null
  }

  owns(contents: WebContents): boolean {
    return this.view?.webContents === contents
  }

  open(url: string, session: Session): void {
    if (!/^https?:/i.test(url)) return
    this.close()
    const view = new WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const contents = view.webContents
    this.view = view
    // The card's corners, less its border, as the page fills its lower part.
    view.setBorderRadius(9)
    view.setBackgroundColor('#ffffff')
    this.host.window.contentView.addChildView(view)
    this.host.prepare(contents)
    this.host.watch(contents, (blocked) => this.promote('open', blocked))

    const update = (patch: Partial<LinkPreviewState>) => {
      if (this.view !== view || !this.state) return
      this.state = { ...this.state, ...patch }
      this.host.show(this.state, view)
    }
    contents.on('page-title-updated', (_event, title) => update({ title }))
    contents.on('did-start-loading', () => update({ loading: true }))
    contents.on('did-stop-loading', () => update({ loading: false, url: contents.getURL() || this.state?.url }))
    contents.on('did-navigate', (_event, address) => update({ url: address }))
    contents.on('did-navigate-in-page', (_event, address, isMainFrame) => isMainFrame && update({ url: address }))
    contents.on('before-input-event', (event, input: Input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.close()
      }
    })
    // The same walls a tab has: no scTerra pages, no previews of the assistant's files.
    contents.on('will-navigate', (event) => {
      if (!/^https?:/i.test(event.url)) event.preventDefault()
    })
    contents.on('will-redirect', (event) => {
      if (!/^https?:/i.test(event.url)) event.preventDefault()
    })
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && (event.url.startsWith('sc:') || isPreviewUrl(event.url))) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/i.test(target)) this.host.openTab(target, 'open')
      return { action: 'deny' }
    })
    contents.on('render-process-gone', () => {
      if (this.view === view) this.close()
    })

    this.state = { ...this.layout(), title: '', url, loading: true }
    this.place()
    this.host.show(this.state, view)
    contents.focus()
    void contents.loadURL(url).catch(() => undefined)
  }

  private layout(): Pick<LinkPreviewState, 'backdrop' | 'card'> {
    const page = this.host.page()
    return { backdrop: page, card: linkPreviewLayout(page).card }
  }

  /** Follows the page area as the window or sidebars change size. */
  place(): void {
    if (!this.view || !this.state) return
    this.view.setBounds(linkPreviewLayout(this.host.page()).view)
    this.state = { ...this.state, ...this.layout() }
    this.host.show(this.state, this.view)
  }

  /** Hidden while a sidebar is dragged, like the tabs, so it can't swallow the pointer. */
  setHidden(hidden: boolean): void {
    this.view?.setVisible(!hidden)
  }

  /** Turns it into a real tab at the address it's on now, and closes the preview. */
  promote(how: 'open' | 'background' | 'split', address?: string): void {
    const url = address ?? (this.view?.webContents.getURL() || this.state?.url)
    this.close()
    if (url && /^https?:/i.test(url)) this.host.openTab(url, how)
  }

  close(): void {
    const { view } = this
    if (!view) return
    this.view = null
    this.state = null
    this.host.show(null, null)
    if (!this.host.window.isDestroyed()) this.host.window.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
}
