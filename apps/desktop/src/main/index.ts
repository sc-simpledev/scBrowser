import { join } from 'node:path'
import { app } from 'electron'
import { handleInternalPages, registerInternalScheme } from './internal/protocol'
import { openDatabase } from './storage/database'
import { HistoryRepo } from './storage/history'
import { createBrowserWindow, type BrowserWindowHandle } from './window'

app.setName('scBrowser')
// Lets tests (and power users) run with a throwaway profile.
if (process.env.SCB_USER_DATA_DIR) app.setPath('userData', process.env.SCB_USER_DATA_DIR)
registerInternalScheme()

// Present a plain Chrome user agent: some sites (notably Google sign-in) refuse
// browsers that advertise Electron.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|scBrowser|@scbrowser\/desktop)\/\S+/gi, '')

const urlsFromArgv = (argv: string[]) => argv.slice(1).filter((arg) => /^(https?|file|sc):/i.test(arg))

let main: BrowserWindowHandle | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (!main) return
    urlsFromArgv(argv).forEach((url) => main!.tabs.create(url))
    if (main.window.isMinimized()) main.window.restore()
    main.window.focus()
  })

  void app.whenReady().then(() => {
    handleInternalPages()
    const db = openDatabase(join(app.getPath('userData'), 'browser.db'))
    app.on('will-quit', () => db.close())
    main = createBrowserWindow(new HistoryRepo(db), urlsFromArgv(process.argv))
    main.window.on('closed', () => (main = null))
  })

  app.on('window-all-closed', () => app.quit())
}
