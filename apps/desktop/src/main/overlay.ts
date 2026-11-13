import { join } from 'node:path'
import { reloadAfterCrash } from './crashReload'
import { WebContentsView, type BaseWindow } from 'electron'
import {
  EMPTY_OVERLAY,
  type LinkPreviewState,
  overlayBounds,
  type AccentId,
  type AppLinkPromptState,
  type AuthPopupState,
  type PasswordPromptState,
  type PasswordSuggestState,
  type BookmarkEdit,
  type BookmarkEditorState,
  type ChromeEvents,
  type CleanupPopupState,
  type ExtensionsPopupState,
  type PageRect,
  type OverlayState,
  type OverlayView,
  type PermissionPopupState,
  type TabId,
  type TabSearchRow,
  type TabSearchState,
  type WorkspaceEdit,
  type WorkspaceEditorState,
  type SiteControlsState,
  type SiteAction,
  isSiteAction,
  PALETTE_POPUP, isWorkspaceSchedule } from '@scbrowser/shared'

import { route, unroute } from './ipcRouter'

const TOAST_MS = 3000

/**
 * A transparent view kept above every tab so chrome UI popups can draw over web pages.
 * It's resized to just the area its popups cover, so the rest of the page stays clickable.
 */
export class Overlay {
  readonly view: WebContentsView
  private state: OverlayState = EMPTY_OVERLAY
  private permission: PermissionPopupState | null = null
  private palette: { x: number; y: number } | null = null
  private tabSearch: TabSearchState | null = null
  private appLink: AppLinkPromptState | null = null
  private extensionsPopup: ExtensionsPopupState | null = null
  private extensionsPopupClosedAt = 0
  private extensionFrame: PageRect | null = null
  /** An extension's panel, kept above this view so that its frame can draw behind it. */
  private above: WebContentsView | null = null
  /** A link preview's page, kept above the card the overlay draws for it. */
  private previewView: WebContentsView | null = null
  private linkPreview: LinkPreviewState | null = null
  private toast: OverlayView['toast'] = null
  private bookmarkEditor: BookmarkEditorState | null = null
  private auth: AuthPopupState | null = null
  private passwordPrompt: PasswordPromptState | null = null
  private passwordSuggest: PasswordSuggestState | null = null
  private cleanup: CleanupPopupState | null = null
  private workspaceEditor: WorkspaceEditorState | null = null
  private siteControls: SiteControlsState | null = null
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private destroyed = false
  private readonly channels: string[] = []
  /** Kept for tearing down: by then the view's own may be gone. */
  private readonly routed: Electron.WebContents

  constructor(
    private readonly window: BaseWindow,
    onPick: (index: number) => void,
    onPermission: (requestId: number, allow: boolean) => void,
    private readonly hooks: {
      onPaletteRun: (id: string) => void
      onPaletteClose: () => void
      onAppLinkAnswer: (choice: 'open' | 'always' | 'cancel') => void
      onExtensionsAction: (action: 'open' | 'pin' | 'menu' | 'store' | 'manage', id: string, x: number, y: number) => void
      onTabSearchPick: (id: TabId) => void
      onTabSearchRemove: (id: TabId) => void
      accent: () => AccentId
      performance: () => boolean
      onBookmarkSave: (edit: BookmarkEdit) => string | null
      onBookmarkRemove: (id: number) => void
      onBookmarkClose: () => void
      onAnswerAction: (action: ChromeEvents['omnibox:answer-action']) => void
      onAnswerLink: (href: string) => void
      onAuth: (requestId: number, login: { username: string; password: string } | null) => void
      onPasswordAnswer: (choice: 'save' | 'never' | 'dismiss') => void
      onPasswordSuggest: (choice: string) => void
      onCleanup: (ids: TabId[] | null) => void
      onWorkspaceSave: (edit: WorkspaceEdit) => void
      onWorkspaceRemove: (id: string) => void
      onSiteAction: (action: SiteAction) => void
      onPopupClosed: () => void
      onTooltipCleared: () => void
      onPreviewAction: (action: 'open' | 'background' | 'split' | 'close') => void
    }
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.view.setBackgroundColor('#00000000')
    this.view.setVisible(false)
    window.contentView.addChildView(this.view)

    const contents = this.view.webContents
    this.routed = contents
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    route(contents, 'overlay:pick', (event, index: unknown) => {
      if (event.sender !== contents) throw new Error('Rejected overlay:pick from untrusted sender')
      if (!Number.isInteger(index)) throw new Error('Invalid arguments for overlay:pick')
      onPick(index as number)
    })
    route(contents, 'overlay:permission', (event, requestId: unknown, allow: unknown) => {
      if (event.sender !== contents) throw new Error('Rejected overlay:permission from untrusted sender')
      if (!Number.isInteger(requestId) || typeof allow !== 'boolean') throw new Error('Invalid arguments')
      onPermission(requestId as number, allow)
    })
    const fromOverlay = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== contents) throw new Error('Rejected bookmark edit from untrusted sender')
    }
    route(contents, 'overlay:bookmark-save', (event, edit: unknown) => {
      fromOverlay(event)
      const { id, title, url, groupId } = (edit ?? {}) as BookmarkEdit
      if (!Number.isInteger(id) || typeof title !== 'string' || title.length > 1024 || typeof url !== 'string' || url.length > 8192) throw new Error('Invalid bookmark')
      if (groupId !== null && !Number.isInteger(groupId)) throw new Error('Invalid group')
      const problem = this.hooks.onBookmarkSave({ id, title, url, groupId })
      if (!problem) this.closeBookmarkEditor()
      return problem
    })
    route(contents, 'overlay:bookmark-remove', (event, id: unknown) => {
      fromOverlay(event)
      if (!Number.isInteger(id)) throw new Error('Invalid bookmark')
      this.hooks.onBookmarkRemove(id as number)
      this.closeBookmarkEditor()
    })
    route(contents, 'overlay:bookmark-close', (event) => {
      fromOverlay(event)
      this.closeBookmarkEditor()
    })
    route(contents, 'overlay:palette-run', (event, id: unknown) => {
      if (event.sender !== contents) throw new Error('Rejected overlay:palette-run from untrusted sender')
      if (typeof id !== 'string') throw new Error('Invalid arguments')
      this.closePalette()
      hooks.onPaletteRun(id)
    })
    route(contents, 'overlay:palette-close', (event) => {
      if (event.sender !== contents) throw new Error('Rejected overlay:palette-close from untrusted sender')
      this.closePalette()
    })
    const handle = (channel: string, listener: (...args: unknown[]) => void) => {
      this.channels.push(channel)
      route(contents, channel, (_event, ...args: unknown[]) => listener(...args))
    }
    handle('overlay:answer-action', (action) => {
      if (action === 'close' || action === 'continue' || action === 'stop') this.hooks.onAnswerAction(action)
    })
    handle('overlay:answer-link', (href) => {
      if (typeof href === 'string' && href.length <= 8192) this.hooks.onAnswerLink(href)
    })
    handle('overlay:auth', (requestId, login) => {
      if (!Number.isInteger(requestId)) throw new Error('Invalid arguments')
      const { username, password } = (login ?? {}) as { username?: unknown; password?: unknown }
      const answer = typeof username === 'string' && typeof password === 'string' && username.length <= 1024 && password.length <= 4096 ? { username, password } : null
      this.hooks.onAuth(requestId as number, answer)
      this.hooks.onPopupClosed()
    })
    handle('overlay:password-answer', (choice) => {
      if (choice !== 'save' && choice !== 'never' && choice !== 'dismiss') throw new Error('Invalid arguments')
      this.hooks.onPasswordAnswer(choice)
    })
    handle('overlay:password-suggest', (choice) => {
      if (typeof choice !== 'string' || choice.length > 200) throw new Error('Invalid arguments')
      this.passwordSuggest = null
      this.render()
      this.hooks.onPasswordSuggest(choice)
    })
    handle('overlay:cleanup', (ids) => {
      const list = Array.isArray(ids) && ids.every(Number.isInteger) ? (ids as TabId[]) : null
      this.cleanup = null
      this.render()
      this.hooks.onCleanup(list)
      this.hooks.onPopupClosed()
    })
    handle('overlay:workspace-save', (edit) => {
      const { id, name, focus, schedule } = (edit ?? {}) as WorkspaceEdit
      if ((id !== null && typeof id !== 'string') || typeof name !== 'string' || name.length > 40 || typeof focus !== 'boolean') throw new Error('Invalid workspace')
      if (schedule !== null && !isWorkspaceSchedule(schedule)) throw new Error('Invalid schedule')
      this.hooks.onWorkspaceSave({ id, name, focus, schedule })
      this.closeWorkspaceEditor()
    })
    handle('overlay:workspace-remove', (id) => {
      if (typeof id !== 'string') throw new Error('Invalid workspace')
      this.hooks.onWorkspaceRemove(id)
      this.closeWorkspaceEditor()
    })
    handle('overlay:workspace-close', () => this.closeWorkspaceEditor())
    handle('overlay:site-action', (action) => {
      if (!isSiteAction(action)) throw new Error('Invalid site action')
      this.hooks.onSiteAction(action)
    })
    handle('overlay:site-close', () => this.closeSiteControls())
    handle('overlay:tooltip-clear', () => this.clearTooltip())
    handle('overlay:preview-action', (action) => {
      if (action !== 'open' && action !== 'background' && action !== 'split' && action !== 'close') throw new Error('Invalid arguments')
      this.hooks.onPreviewAction(action)
    })
    handle('overlay:app-link-answer', (choice) => {
      if (choice !== 'open' && choice !== 'always' && choice !== 'cancel') throw new Error('Invalid arguments')
      this.hooks.onAppLinkAnswer(choice)
      this.hooks.onPopupClosed()
    })
    handle('overlay:extensions-action', (action, id, x, y) => {
      if (action !== 'open' && action !== 'pin' && action !== 'menu' && action !== 'store' && action !== 'manage') throw new Error('Invalid arguments')
      if (typeof id !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid arguments')
      if (action !== 'pin') this.closeExtensionsPopup()
      this.hooks.onExtensionsAction(action, id, x as number, y as number)
    })
    handle('overlay:extensions-close', () => this.closeExtensionsPopup())
    const tabArg = (id: unknown) => {
      if (!Number.isInteger(id)) throw new Error('Invalid tab')
      return id as TabId
    }
    handle('overlay:tab-search-pick', (id) => {
      const tab = tabArg(id)
      this.tabSearch = null
      this.render()
      this.hooks.onTabSearchPick(tab)
    })
    handle('overlay:tab-search-remove', (id) => this.hooks.onTabSearchRemove(tabArg(id)))
    handle('overlay:tab-search-close', () => this.closeTabSearch())
    // A crashed overlay shouldn't take popups down for the rest of the session.
    reloadAfterCrash(contents)

    if (process.env.ELECTRON_RENDERER_URL) void contents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
    else void contents.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  openBookmarkEditor(editor: BookmarkEditorState): void {
    this.bookmarkEditor = editor
    this.render()
    this.view.webContents.focus()
  }

  private closeBookmarkEditor(): void {
    this.bookmarkEditor = null
    this.render()
    this.hooks.onBookmarkClose()
  }

  setAuth(auth: AuthPopupState | null): void {
    this.auth = auth
    this.render()
    if (auth) this.view.webContents.focus()
  }

  /** It doesn't take focus, as the person is usually still typing or waiting for the next page. */
  setPasswordPrompt(prompt: PasswordPromptState | null): void {
    this.passwordPrompt = prompt
    this.render()
  }

  /** Like the save offer, it leaves focus in the page, so typing carries on into the field. */
  setPasswordSuggest(suggest: PasswordSuggestState | null): void {
    if (!suggest && !this.passwordSuggest) return
    this.passwordSuggest = suggest
    this.render()
  }

  get suggestingPasswords(): boolean {
    return this.passwordSuggest !== null
  }

  setAppLink(prompt: AppLinkPromptState | null): void {
    this.appLink = prompt
    this.render()
  }

  /** Pressing the button again closes it: the list has just gone, as the press took its focus. */
  openExtensionsPopup(popup: ExtensionsPopupState, refresh = false): void {
    if (refresh) {
      if (this.extensionsPopup) this.extensionsPopup = popup
      return this.render()
    }
    if (this.extensionsPopup) return this.closeExtensionsPopup()
    if (Date.now() - this.extensionsPopupClosedAt < 250) return
    this.extensionsPopup = popup
    this.render()
    this.view.webContents.focus()
  }

  private closeExtensionsPopup(): void {
    if (!this.extensionsPopup) return
    this.extensionsPopup = null
    this.extensionsPopupClosedAt = Date.now()
    this.render()
  }

  setExtensionFrame(rect: PageRect | null, view: WebContentsView | null): void {
    this.extensionFrame = rect
    this.above = view
    this.render()
    if (view) this.raise()
  }

  openCleanup(cleanup: CleanupPopupState): void {
    this.cleanup = cleanup
    this.render()
    this.view.webContents.focus()
  }

  openWorkspaceEditor(editor: WorkspaceEditorState): void {
    this.workspaceEditor = editor
    this.render()
    this.view.webContents.focus()
  }

  openSiteControls(state: SiteControlsState): void {
    this.siteControls = state
    this.render()
    this.view.webContents.focus()
  }

  /** Redraws it after a change, keeping where it is. */
  updateSiteControls(state: Omit<SiteControlsState, 'x' | 'y'> | null): void {
    if (!this.siteControls) return
    if (!state) return this.closeSiteControls()
    this.siteControls = { ...state, x: this.siteControls.x, y: this.siteControls.y }
    this.render()
  }

  get siteControlsOpen(): boolean {
    return this.siteControls !== null
  }

  closeSiteControls(): void {
    if (!this.siteControls) return
    this.siteControls = null
    this.render()
    this.hooks.onPopupClosed()
  }

  private closeWorkspaceEditor(): void {
    this.workspaceEditor = null
    this.render()
    this.hooks.onPopupClosed()
  }

  /** The pointer has moved on, so the chrome UI's leave event may never come. */
  clearTooltip(): void {
    if (!this.state.tooltip) return
    this.state = { ...this.state, tooltip: null }
    this.render()
    this.hooks.onTooltipCleared()
  }

  /** Re-stacks the overlay on top; call after adding tab views. */
  raise(): void {
    this.window.contentView.addChildView(this.view)
    if (this.above) this.window.contentView.addChildView(this.above)
    if (this.previewView) this.window.contentView.addChildView(this.previewView)
  }

  setLinkPreview(state: LinkPreviewState | null, view: WebContentsView | null): void {
    const added = view && view !== this.previewView
    this.linkPreview = state
    this.previewView = view
    this.render()
    if (added) this.raise()
  }

  set(state: OverlayState): void {
    this.state = state
    this.render()
  }

  setPermission(permission: PermissionPopupState | null): void {
    this.permission = permission
    this.render()
  }

  showToast(text: string, x: number, y: number): void {
    this.toast = { text, x, y }
    this.render()
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toast = null
      this.render()
    }, TOAST_MS)
  }

  private centred(): { x: number; y: number } {
    const { width } = this.window.getContentBounds()
    return { x: Math.max(0, Math.round((width - PALETTE_POPUP.width) / 2)), y: PALETTE_POPUP.top }
  }

  togglePalette(): void {
    if (this.palette) {
      this.closePalette()
      return
    }
    this.tabSearch = null
    this.palette = this.centred()
    this.render()
    this.view.webContents.focus()
  }

  toggleTabSearch(rows: TabSearchRow[]): void {
    if (this.tabSearch) {
      this.closeTabSearch()
      return
    }
    this.palette = null
    this.tabSearch = { rows, ...this.centred() }
    this.render()
    this.view.webContents.focus()
  }

  /** Keeps an open list true to the tabs, as rows can be closed from it. */
  updateTabSearch(rows: TabSearchRow[]): void {
    if (!this.tabSearch) return
    this.tabSearch = { ...this.tabSearch, rows }
    this.render()
  }

  private closeTabSearch(): void {
    if (!this.tabSearch) return
    this.tabSearch = null
    this.render()
    this.hooks.onPopupClosed()
  }

  private closePalette(): void {
    if (!this.palette) return
    this.palette = null
    this.render()
    this.hooks.onPaletteClose()
  }

  private current(): OverlayView {
    return { ...this.state, passwordPrompt: this.passwordPrompt, passwordSuggest: this.passwordSuggest, permission: this.permission, palette: this.palette, tabSearch: this.tabSearch, appLink: this.appLink, extensionsPopup: this.extensionsPopup, extensionFrame: this.extensionFrame, accent: this.hooks.accent(), performance: this.hooks.performance(), toast: this.toast, bookmarkEditor: this.bookmarkEditor, auth: this.auth, cleanup: this.cleanup, workspaceEditor: this.workspaceEditor, linkPreview: this.linkPreview, siteControls: this.siteControls }
  }

  private render(): void {
    if (this.destroyed) return
    const bounds = overlayBounds(this.current())
    if (!bounds) {
      this.view.setVisible(false)
      this.send()
      return
    }
    const { width, height } = this.window.getContentBounds()
    const x = Math.max(0, Math.floor(bounds.x))
    const y = Math.max(0, Math.floor(bounds.y))
    this.view.setBounds({
      x,
      y,
      width: Math.max(1, Math.min(width - x, Math.ceil(bounds.x + bounds.width) - x)),
      height: Math.max(1, Math.min(height - y, Math.ceil(bounds.y + bounds.height) - y))
    })
    this.send()
    this.view.setVisible(true)
  }

  destroy(): void {
    this.destroyed = true
    clearTimeout(this.toastTimer)
    unroute(this.routed)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  private send(): void {
    const contents = this.view.webContents
    if (contents.isDestroyed()) return
    // The overlay lays popups out relative to its own top-left corner.
    const origin = this.view.getBounds()
    contents.send('overlay:state', { state: this.current(), origin: { x: origin.x, y: origin.y } })
  }
}
