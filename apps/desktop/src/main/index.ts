import { cpSync, existsSync, rmSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, Menu, net } from 'electron'
import { HOSTED_AI_URL } from '@scbrowser/shared'
import { AiStore } from './ai/store'
import { applyFlags } from './flags'
import { applyProfile } from './profiles'
import { handleInternalPages, registerInternalScheme } from './internal/protocol'
import { Reporter, type Send } from './reporter'
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

let reporter: Reporter | null = null

// One failed callback shouldn't put a blocking error dialog in front of the whole browser.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  reporter?.record('exception', error.name, error.stack)
})

// Playwright turns the sandbox off, but service worker extensions need it to get their APIs.
if (process.env.SCB_E2E_SANDBOX) app.commandLine.removeSwitch('no-sandbox')

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

/** Reports share the AI server, so switching that off switches them off too. */
function reportSender(): Send | null {
  const base = process.env.SCDELTA_AI_URL ?? HOSTED_AI_URL
  if (base === 'off') return null
  return (body) => net.fetch(`${base}/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

/** Normal ways for a process to end, which aren't crashes. */
const isCrash = (reason: string) => reason !== 'clean-exit' && reason !== 'killed'

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
    app.on('quit', () => {
      reporter?.finish()
      db.close()
    })
    const kv = new KeyValueRepo(db)
    const settings = new SettingsStore(kv)
    reporter = new Reporter(
      kv,
      settings,
      { version: app.getVersion(), electron: process.versions.electron ?? '', platform: process.platform, arch: process.arch },
      reportSender()
    )
    reporter.start()
    app.on('render-process-gone', (_event, _contents, { reason }) => {
      if (isCrash(reason)) reporter?.record('page', reason)
    })
    app.on('child-process-gone', (_event, { type, reason }) => {
      if (isCrash(reason)) reporter?.record(type === 'GPU' ? 'gpu' : 'utility', reason)
    })
    main = createBrowserWindow(
      {
        kv,
        settings,
        history: new HistoryRepo(db),
        bookmarks: new BookmarksRepo(db),
        downloads: new DownloadsRepo(db),
        permissions: new PermissionsRepo(db),
        aiStore: new AiStore(kv),
        chats: new ChatsRepo(db),
        reporter
      },
      urlsFromArgv(process.argv)
    )
    main.window.on('closed', () => (main = null))
    if (process.env.SCB_E2E) Object.assign(globalThis, { scbTabs: main.tabs, scbActions: main.actions, scbExtensions: main.extensions, scbSync: main.sync, scbVpn: main.vpn, scbReporter: reporter })
  })

  app.on('window-all-closed', () => app.quit())
}
