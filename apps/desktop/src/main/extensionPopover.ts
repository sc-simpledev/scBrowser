import { BrowserWindow, WebContentsView, type BaseWindow, type Input, type Session, type WebContents } from 'electron'
import type { PageRect } from '@scbrowser/shared'

/** Chrome's own limits for an extension's popup. */
const FIT = { minWidth: 200, maxWidth: 800, minHeight: 80, maxHeight: 600, width: 320, height: 420 }
const TALL = { width: 400, height: 640 }
const GAP = 4
const EDGE = 8
/** A click outside closes it by taking focus, and that same click mustn't then open it again. */
const REOPEN_AFTER_MS = 250
/** Popups often draw themselves after loading, so it looks again for a few seconds. */
const MEASURE_AFTER_MS = [0, 150, 400, 900, 1800, 3000]
/** Its own isolated world, as the page's scripts have no need to see this. */
const MEASURE_WORLD = 1005
/** A page that fills whatever it's given has no size of its own to go by, so that's left alone. */
const MEASURE = `(() => {
  const root = document.documentElement
  const body = document.body
  if (!body) return null
  const style = getComputedStyle(body)
  const box = body.getBoundingClientRect()
  const edges = (a, b) => parseFloat(style[a]) + parseFloat(style[b])
  return {
    width: Math.max(root.scrollWidth > innerWidth ? root.scrollWidth : 0, Math.ceil(box.width + edges('marginLeft', 'marginRight'))),
    height: Math.max(root.scrollHeight > innerHeight ? root.scrollHeight : 0, Math.ceil(box.height + edges('marginTop', 'marginBottom')))
  }
})()`

interface PopoverHost {
  /** Where the toolbar's Extensions button is in this window, if it's showing. */
  anchor: (window: BaseWindow) => PageRect | undefined
  /** The page's own shortcuts, menu and links. */
  prepare: (contents: WebContents, extensionId: string) => void
  /** Draws its border and shadow in the overlay, with this view kept above that. */
  frame: (window: BaseWindow, rect: PageRect | null, view: WebContentsView | null) => void
}

export interface PopoverRequest {
  extensionId: string
  url: string
  session: Session
  window: BaseWindow
  /** A popup sizes to its page. Side panels and small windows expect room to work in. */
  kind: 'fit' | 'tall'
  width?: number
  height?: number
  /** It stands in for a window the extension made, so the extension can close it the same way. */
  asWindow?: boolean
}

/**
 * An extension's page in a small panel hanging from the toolbar, which closes when focus moves on,
 * as Chrome's and Firefox's do. It's a view in the window rather than a window of its own.
 */
export class ExtensionPopover {
  private view: WebContentsView | null = null
  private request: PopoverRequest | null = null
  private size = { width: FIT.width, height: FIT.height }
  private closedId: string | null = null
  private closedAt = 0

  constructor(private readonly host: PopoverHost) {}

  get extensionId(): string | null {
    return this.request?.extensionId ?? null
  }

  ownedBy(window: BaseWindow): boolean {
    return this.request?.window === window
  }

  open(request: PopoverRequest): void {
    const same = this.request?.extensionId === request.extensionId
    if (same && this.request?.url === request.url) return this.close()
    if (this.closedId === request.extensionId && Date.now() - this.closedAt < REOPEN_AFTER_MS) return
    this.close()

    const view = new WebContentsView({
      webPreferences: { session: request.session, sandbox: true, contextIsolation: true, nodeIntegration: false, enablePreferredSizeMode: request.kind === 'fit' }
    })
    const contents = view.webContents
    this.view = view
    this.request = request
    this.size = request.kind === 'fit' ? { width: FIT.width, height: FIT.height } : { width: request.width ?? TALL.width, height: request.height ?? TALL.height }
    view.setBorderRadius(10)
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    request.window.contentView.addChildView(view)
    this.host.prepare(contents, request.extensionId)

    const show = () => {
      if (this.view !== view || view.getVisible()) return
      this.place()
      view.setVisible(true)
      contents.focus()
    }
    const fit = (size: { width: number; height: number } | null) => {
      if (this.view !== view || !size || size.width <= 0 || size.height <= 0) return
      this.size = {
        width: Math.min(FIT.maxWidth, Math.max(FIT.minWidth, size.width)),
        height: Math.min(FIT.maxHeight, Math.max(FIT.minHeight, size.height))
      }
      this.place()
    }
    if (request.kind === 'fit') {
      // Chromium's own report doesn't reliably come for a view inside a window, so this measures too.
      contents.on('preferred-size-changed' as never, (_event: unknown, size: { width: number; height: number }) => fit(size))
      contents.once('did-finish-load', () => {
        for (const delay of MEASURE_AFTER_MS) {
          setTimeout(() => {
            if (this.view !== view || contents.isDestroyed()) return
            void contents.executeJavaScriptInIsolatedWorld(MEASURE_WORLD, [{ code: MEASURE }]).then(fit, () => undefined)
          }, delay)
        }
      })
    }
    contents.once('did-finish-load', show)
    contents.once('did-fail-load', show)
    contents.on('blur', () => this.maybeClose(view))
    contents.on('before-input-event', (event, input: Input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.close()
      }
    })
    // A page asking to close its own window, which is how popups say they're done.
    contents.on('close' as never, () => {
      if (this.view === view) this.close()
    })
    contents.on('render-process-gone', () => {
      if (this.view === view) this.close()
    })
    void contents.loadURL(request.url).catch(() => undefined)
  }

  /** Stays put while someone's in another app or looking at its developer tools. */
  private maybeClose(view: WebContentsView): void {
    if (this.view !== view || view.webContents.isDevToolsOpened()) return
    if (!BrowserWindow.getAllWindows().some((window) => window.isFocused())) return
    this.close()
  }

  private place(): void {
    const { view, request } = this
    if (!view || !request) return
    const { width: windowWidth, height: windowHeight } = request.window.getContentBounds()
    const anchor = this.host.anchor(request.window)
    const right = anchor ? anchor.x + anchor.width : windowWidth - EDGE
    const top = (anchor ? anchor.y + anchor.height : 44) + GAP
    const width = Math.min(this.size.width, windowWidth - EDGE * 2)
    const height = Math.min(this.size.height, windowHeight - top - EDGE)
    const rect = { x: Math.max(EDGE, Math.min(right, windowWidth - EDGE) - width), y: top, width, height: Math.max(FIT.minHeight, height) }
    view.setBounds(rect)
    this.host.frame(request.window, rect, view)
  }

  close(): void {
    const { view, request } = this
    if (!view || !request) return
    this.view = null
    this.request = null
    this.closedId = request.extensionId
    this.closedAt = Date.now()
    if (!request.window.isDestroyed()) {
      this.host.frame(request.window, null, null)
      request.window.contentView.removeChildView(view)
    }
    const contents = view.webContents as WebContents | undefined
    if (contents && !contents.isDestroyed()) contents.close()
  }

  /** For `chrome.windows.remove`, which is only meant to reach a window the extension asked for. */
  closeIfWindow(): void {
    if (this.request?.asWindow) this.close()
  }

  closeFor(extensionId: string): void {
    if (this.request?.extensionId === extensionId) this.close()
  }
}
