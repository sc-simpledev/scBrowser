import { session, WebContentsView, type WebContents } from 'electron'

const LOAD_TIMEOUT_MS = 30_000
/** Pages that draw their text with scripts need a moment after loading. */
const SETTLE_MS = 2500

/**
 * Loads a page out of sight in the person's own session, hands it to `read`, then throws it away.
 * It's a view in no window: it never shows, and can't keep scTerra open or appear in window lists.
 */
export async function withHiddenPage<T>(url: string, read: (contents: WebContents) => Promise<T>): Promise<T> {
  const view = new WebContentsView({ webPreferences: { session: session.defaultSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  view.setBounds({ x: 0, y: 0, width: 1280, height: 900 })
  const contents = view.webContents
  contents.setAudioMuted(true)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => {
    if (!/^https?:/i.test(event.url)) event.preventDefault()
  })
  try {
    await Promise.race([
      contents.loadURL(url),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('The page took too long to load.')), LOAD_TIMEOUT_MS))
    ])
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    if (contents.isDestroyed()) throw new Error("Couldn't load the page.")
    return await read(contents)
  } catch (error) {
    throw error instanceof Error && /ERR_/.test(error.message) ? new Error("Couldn't load the page.") : error
  } finally {
    if (!contents.isDestroyed()) contents.close()
  }
}
