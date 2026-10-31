import { cpSync, existsSync, rmSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, Menu } from 'electron'
import { AiStore } from './ai/store'
import { applyFlags } from './flags'
import { applyProfile } from './profiles'
import { handleInternalPages, registerInternalScheme } from './internal/protocol'
import { SettingsStore } from './settings'
import { BookmarksRepo } from './storage/bookmarks'
import { ChatsRepo } from './storage/chats'
import { openDatabase } from './storage/database'
import { DownloadsRepo } from './storage/downloads'
import { HistoryRepo } from './storage/history'
import { KeyValueRepo } from './storage/kv'
import { PermissionsRepo } from './storage/permissions'
import { createBrowserWindow, type BrowserWindowHandle } from './window'

/** The app used to be called scBrowser; bring that profile along on first launch. */
function moveLegacyProfile(): void {
  const legacy = join(app.getPath('appData'), 'scBrowser')
  const current = app.getPath('userData')
  // Electron creates the new folder before this runs, so look for real data, not the folder.
  if (!existsSync(join(legacy, 'browser.db')) || existsSync(join(current, 'browser.db'))) return
  try {
    cpSync(legacy, current, { recursive: true, force: false, filter: (path) => !basename(path).startsWith('Singleton') })
    rmSync(legacy, { recursive: true, force: true })
  } catch (error) {
    // Starting with a fresh profile beats not starting; the old folder is left as it was.
    console.error('Could not move the old profile:', error)
  }
}

// One failed callback shouldn't put a blocking error dialog in front of the whole browser.
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error))

app.setName('scDelta')
// Lets tests (and power users) run with a throwaway profile.
if (process.env.SCB_USER_DATA_DIR) app.setPath('userData', process.env.SCB_USER_DATA_DIR)
else moveLegacyProfile()
applyProfile()
if (process.platform === 'linux') app.setDesktopName('scdelta.desktop')
applyFlags()
registerInternalScheme()

// Present a plain Chrome user agent: some sites (notably Google sign-in) refuse
// browsers that advertise Electron.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|scDelta|scBrowser|@scbrowser\/desktop)\/\S+/gi, '')

/** URLs and local HTML files passed on the command line, e.g. by the OS when we're the default browser. */
function urlsFromArgv(argv: string[]): string[] {
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((arg) => !arg.startsWith('-'))
  return args.flatMap((arg) => {
    if (/^(https?|file):/i.test(arg)) return [arg]
    const path = isAbsolute(arg) ? arg : resolve(arg)
    return /\.(html?|xhtml|svg|pdf)$/i.test(arg) && existsSync(path) ? [pathToFileURL(path).toString()] : []
  })
}

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
    Menu.setApplicationMenu(null)
    handleInternalPages()
    const db = openDatabase(join(app.getPath('userData'), 'browser.db'))
    // The last step of quitting: tabs winding down can still touch the database until then.
    app.on('quit', () => db.close())
    const kv = new KeyValueRepo(db)
    main = createBrowserWindow(
      {
        kv,
        settings: new SettingsStore(kv),
        history: new HistoryRepo(db),
        bookmarks: new BookmarksRepo(db),
        downloads: new DownloadsRepo(db),
        permissions: new PermissionsRepo(db),
        aiStore: new AiStore(kv),
        chats: new ChatsRepo(db)
      },
      urlsFromArgv(process.argv)
    )
    main.window.on('closed', () => (main = null))
    if (process.env.SCB_E2E) Object.assign(globalThis, { scbTabs: main.tabs })
  })

  app.on('window-all-closed', () => app.quit())
}
