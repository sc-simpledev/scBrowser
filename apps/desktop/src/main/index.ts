import { rememberOwnUserAgent } from './googleSignIn'
import { cpSync, existsSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, Menu, net } from 'electron'
import { HOSTED_AI_URL } from '@scbrowser/shared'
import { AiStore } from './ai/store'
import { applyFlags } from './flags'
import { applyPrivate, isPrivate, seedPrivate, sweepPrivate } from './private'
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
import { BrowserCore } from './browserCore'
import { webAppUrlFromArgv } from './webApps'
import { createBrowserWindow } from './window'

/** The app used to be called scDelta, and scBrowser before that. Copy that profile on first launch, leaving the original. */
function moveLegacyProfile(): void {
  const current = app.getPath('userData')
  // Electron creates the new folder before this runs, so look for real data, not the folder.
  if (existsSync(join(current, 'browser.db'))) return
  const legacy = ['scDelta', 'scBrowser'].map((name) => join(app.getPath('appData'), name)).find((path) => existsSync(join(path, 'browser.db')))
  if (!legacy) return
  try {
    cpSync(legacy, current, { recursive: true, force: false, filter: (path) => !basename(path).startsWith('Singleton') })
  } catch (error) {
    // Starting with a fresh profile beats not starting.
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

app.setName('scTerra')
// Windows matches the taskbar button to the installed shortcut, and its icon, by this id.
if (process.platform === 'win32') app.setAppUserModelId('app.scterra.desktop')
// Lets tests (and power users) run with a throwaway profile.
if (process.env.SCB_USER_DATA_DIR) app.setPath('userData', process.env.SCB_USER_DATA_DIR)
else moveLegacyProfile()
applyProfile()
applyPrivate()
if (process.platform === 'linux') app.setDesktopName('scterra.desktop')
applyFlags()
registerInternalScheme()

// Present a plain Chrome user agent, as some sites refuse browsers that advertise Electron.
// Google's sign-in pages are the exception: see googleSignIn.ts.
rememberOwnUserAgent(app.userAgentFallback)
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|scTerra|scDelta|scBrowser|@scbrowser\/desktop)\/\S+/gi, '')

/** URLs and local HTML files passed on the command line, e.g. by the OS when we're the default browser. */
function urlsFromArgv(argv: string[]): string[] {
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((arg) => !arg.startsWith('-'))
  return args.flatMap((arg) => {
    if (/^(https?|file):/i.test(arg)) return [arg]
    const path = isAbsolute(arg) ? arg : resolve(arg)
    return /\.(html?|xhtml|svg|pdf)$/i.test(arg) && existsSync(path) ? [pathToFileURL(path).toString()] : []
  })
}

let core: BrowserCore | null = null

/** On a Mac, links from other apps arrive as events, and can come before the window exists. */
const earlyUrls: string[] = []
const openFromSystem = (event: Electron.Event, url: string) => {
  event.preventDefault()
  if (core) {
    const { tabs, window } = core.browser()
    tabs.create(url)
    window.focus()
  } else earlyUrls.push(url)
}
app.on('open-url', openFromSystem)
app.on('open-file', (event, path) => openFromSystem(event, pathToFileURL(path).toString()))

/** A Mac has no window menu, and its editing keys only work through the system one. */
function applyMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate(template) : null)
}

/** Reports share the AI server, so switching that off switches them off too. */
function reportSender(): Send | null {
  const base = process.env.SCTERRA_AI_URL ?? HOSTED_AI_URL
  if (base === 'off') return null
  return (body) => net.fetch(`${base}/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

/** Normal ways for a process to end, which aren't crashes. */
const isCrash = (reason: string) => reason !== 'clean-exit' && reason !== 'killed'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (!core) return
    const webApp = webAppUrlFromArgv(argv)
    if (webApp) {
      core.openWindow({ kind: 'app', urls: [webApp] })
      return
    }
    const { tabs, window } = core.browser()
    urlsFromArgv(argv).forEach((url) => tabs.create(url))
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(() => {
    applyMenu()
    handleInternalPages()
    const db = openDatabase(join(app.getPath('userData'), 'browser.db'))
    // The last step of quitting: tabs winding down can still touch the database until then.
    app.on('quit', () => {
      reporter?.finish()
      db.close()
    })
    const kv = new KeyValueRepo(db)
    const settings = new SettingsStore(kv)
    const bookmarks = new BookmarksRepo(db)
    if (isPrivate) seedPrivate(settings, bookmarks)
    else sweepPrivate()
    reporter = new Reporter(
      kv,
      settings,
      { version: app.getVersion(), electron: process.versions.electron ?? '', platform: process.platform, arch: process.arch },
      reportSender()
    )
    if (!isPrivate) reporter.start()
    app.on('render-process-gone', (_event, _contents, { reason }) => {
      if (isCrash(reason)) reporter?.record('page', reason)
    })
    app.on('child-process-gone', (_event, { type, reason }) => {
      if (isCrash(reason)) reporter?.record(type === 'GPU' ? 'gpu' : 'utility', reason)
    })
    const aiStore = new AiStore(kv)
    if (process.env.SCB_E2E) Object.assign(globalThis, { scbAi: { kv } })
    core = new BrowserCore(
      {
        kv,
        settings,
        history: new HistoryRepo(db),
        bookmarks,
        downloads: new DownloadsRepo(db),
        permissions: new PermissionsRepo(db),
        aiStore,
        chats: new ChatsRepo(db),
        reporter
      },
      createBrowserWindow
    )
    // A shortcut to an installed site opens just that, leaving the browser for when it's asked for.
    const webApp = webAppUrlFromArgv(process.argv)
    const first = webApp ? core.openWindow({ kind: 'app', urls: [webApp] }) : core.openWindow({ urls: [...urlsFromArgv(process.argv), ...earlyUrls] })
    if (process.env.SCB_E2E) Object.assign(globalThis, { scbTabs: first.tabs, scbActions: first.actions, scbExtensions: core.extensions, scbSync: core.sync, scbVpn: core.vpn, scbReporter: reporter, scbUpdates: core.updates, scbCore: core })
  })

  app.on('window-all-closed', () => app.quit())
}
