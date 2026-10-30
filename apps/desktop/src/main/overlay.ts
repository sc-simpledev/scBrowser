import { join } from 'node:path'
import { ipcMain, WebContentsView, type BaseWindow } from 'electron'
import { EMPTY_OVERLAY, overlayRegions, unionRect, type OverlayState } from '@scbrowser/shared'

/**
 * A transparent view kept above every tab so chrome UI popups can draw over web pages.
 * It's resized to just the area its popups cover, so the rest of the page stays clickable.
 */
export class Overlay {
  readonly view: WebContentsView
  private state: OverlayState = EMPTY_OVERLAY

  constructor(
    private readonly window: BaseWindow,
    onPick: (index: number) => void
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

    if (process.env.ELECTRON_RENDERER_URL) void contents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
    else void contents.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  /** Re-stacks the overlay on top; call after adding tab views. */
  raise(): void {
    this.window.contentView.addChildView(this.view)
  }

  set(state: OverlayState): void {
    this.state = state
    const bounds = unionRect(overlayRegions(state))
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
    ipcMain.removeHandler('overlay:pick')
    this.view.webContents.close()
  }

  private send(): void {
    const contents = this.view.webContents
    if (contents.isDestroyed()) return
    // The overlay lays popups out relative to its own top-left corner.
    const origin = this.view.getBounds()
    contents.send('overlay:state', { state: this.state, origin: { x: origin.x, y: origin.y } })
  }
}
