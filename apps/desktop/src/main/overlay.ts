import { join } from 'node:path'
import { ipcMain, WebContentsView, type BaseWindow } from 'electron'
import {
  EMPTY_OVERLAY,
  overlayRegions,
  unionRect,
  type AccentId,
  type BookmarkEdit,
  type BookmarkEditorState,
  type OverlayState,
  type OverlayView,
  type PermissionPopupState,
  PALETTE_POPUP
} from '@scbrowser/shared'

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
  private toast: OverlayView['toast'] = null
  private bookmarkEditor: BookmarkEditorState | null = null
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private destroyed = false

  constructor(
    private readonly window: BaseWindow,
    onPick: (index: number) => void,
    onPermission: (requestId: number, allow: boolean) => void,
    private readonly hooks: {
      onPaletteRun: (id: string) => void
      onPaletteClose: () => void
      accent: () => AccentId
      onBookmarkSave: (edit: BookmarkEdit) => string | null
      onBookmarkRemove: (id: number) => void
      onBookmarkClose: () => void
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
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    ipcMain.handle('overlay:pick', (event, index: unknown) => {
      if (event.sender !== contents) throw new Error('Rejected overlay:pick from untrusted sender')
      if (!Number.isInteger(index)) throw new Error('Invalid arguments for overlay:pick')
      onPick(index as number)
    })
    ipcMain.handle('overlay:permission', (event, requestId: unknown, allow: unknown) => {
      if (event.sender !== contents) throw new Error('Rejected overlay:permission from untrusted sender')
      if (!Number.isInteger(requestId) || typeof allow !== 'boolean') throw new Error('Invalid arguments')
      onPermission(requestId as number, allow)
    })
    const fromOverlay = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== contents) throw new Error('Rejected bookmark edit from untrusted sender')
    }
    ipcMain.handle('overlay:bookmark-save', (event, edit: unknown) => {
      fromOverlay(event)
      const { id, title, url, groupId } = (edit ?? {}) as BookmarkEdit
      if (!Number.isInteger(id) || typeof title !== 'string' || title.length > 1024 || typeof url !== 'string' || url.length > 8192) throw new Error('Invalid bookmark')
      if (groupId !== null && !Number.isInteger(groupId)) throw new Error('Invalid group')
      const problem = this.hooks.onBookmarkSave({ id, title, url, groupId })
      if (!problem) this.closeBookmarkEditor()
      return problem
    })
    ipcMain.handle('overlay:bookmark-remove', (event, id: unknown) => {
      fromOverlay(event)
      if (!Number.isInteger(id)) throw new Error('Invalid bookmark')
      this.hooks.onBookmarkRemove(id as number)
      this.closeBookmarkEditor()
    })
    ipcMain.handle('overlay:bookmark-close', (event) => {
      fromOverlay(event)
      this.closeBookmarkEditor()
    })
    ipcMain.handle('overlay:palette-run', (event, id: unknown) => {
      if (event.sender !== contents) throw new Error('Rejected overlay:palette-run from untrusted sender')
      if (typeof id !== 'string') throw new Error('Invalid arguments')
      this.closePalette()
      hooks.onPaletteRun(id)
    })
    ipcMain.handle('overlay:palette-close', (event) => {
      if (event.sender !== contents) throw new Error('Rejected overlay:palette-close from untrusted sender')
      this.closePalette()
    })
    // A crashed overlay shouldn't take popups down for the rest of the session.
    contents.on('render-process-gone', () => contents.reload())

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

  /** Re-stacks the overlay on top; call after adding tab views. */
  raise(): void {
    this.window.contentView.addChildView(this.view)
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

  togglePalette(): void {
    if (this.palette) {
      this.closePalette()
      return
    }
    const { width } = this.window.getContentBounds()
    this.palette = { x: Math.max(0, Math.round((width - PALETTE_POPUP.width) / 2)), y: PALETTE_POPUP.top }
    this.render()
    this.view.webContents.focus()
  }

  private closePalette(): void {
    if (!this.palette) return
    this.palette = null
    this.render()
    this.hooks.onPaletteClose()
  }

  private current(): OverlayView {
    return { ...this.state, permission: this.permission, palette: this.palette, accent: this.hooks.accent(), toast: this.toast, bookmarkEditor: this.bookmarkEditor }
  }

  private render(): void {
    if (this.destroyed) return
    const bounds = unionRect(overlayRegions(this.current()))
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
    ipcMain.removeHandler('overlay:pick')
    ipcMain.removeHandler('overlay:permission')
    ipcMain.removeHandler('overlay:palette-run')
    ipcMain.removeHandler('overlay:palette-close')
    ipcMain.removeHandler('overlay:bookmark-save')
    ipcMain.removeHandler('overlay:bookmark-remove')
    ipcMain.removeHandler('overlay:bookmark-close')
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
