import { rememberOwnUserAgent } from './googleSignIn'
import { cpSync, existsSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stat } from 'node:fs/promises'
import { codeFromArgv, headlessFromArgv } from './codeArgs'
import { runHeadless } from './headless'
import { primeLoginPath } from './ai/coderTools'
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
import { isSmokeTest, prepareSmokeTest, runSmokeTest } from './smokeTest'
import { drmStartup } from './drm'
import { dropDesktopNameAtExit } from './selfLaunch'

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
  // Recording it can fail too, as when the database has just closed on the way out; a throw here
  // would end the process with an error of its own.
  try {
    reporter?.record('exception', error.name, error.stack)
  } catch (failure) {
    console.error('Couldn’t record that exception:', failure)
  }
})

// Tests can collect errors from the browser's own pages (its interface, popups and sc:// pages), which
// would otherwise only show in their developer tools. Websites' own errors are left out.
if (process.env.SCB_E2E && process.env.SCB_E2E_CONSOLE) {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
      if (level !== 'error' && level !== 'warning') return
      const url = contents.getURL()
      if (!/^(sc:|file:|http:\/\/localhost:5173)/.test(url) || /^file:.*\.(html?|pdf)$/.test(url) && !url.includes('/renderer/')) return
      process.stderr.write(`[page ${level}] ${url.split('?')[0]} ${sourceId.split('/').pop()}:${lineNumber} ${message}\n`)
    })
  })
}

// Playwright turns the sandbox off, but service worker extensions need it to get their APIs.
if (process.env.SCB_E2E_SANDBOX) app.commandLine.removeSwitch('no-sandbox')

app.setName('scTerra')
// Windows matches the taskbar button to the installed shortcut, and its icon, by this id.
if (process.platform === 'win32') app.setAppUserModelId('app.scterra.desktop')
const smokeTest = isSmokeTest(process.argv)
// Lets tests (and power users) run with a throwaway profile.
if (smokeTest) prepareSmokeTest()
else if (process.env.SCB_USER_DATA_DIR) app.setPath('userData', process.env.SCB_USER_DATA_DIR)
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

/** Only a real folder, as a terminal can be anywhere. */
async function openCode({ folder, task }: { folder: string; task: string }): Promise<void> {
  const info = await stat(folder).catch(() => null)
  if (info?.isDirectory()) core?.browser().openCode(folder, task)
}

/** On a Mac, links from other apps arrive as events, and can come before the window exists. */
const earlyUrls: string[] = []

/**
 * A link from another app while scTerra is open: a tab in the browser, or with "Little window" on,
 * a small window of its own with "Open in scTerra", so a quick look doesn't add a tab.
 */
function openLink(url: string): void {
  if (!core) return void earlyUrls.push(url)
  if (core.services.settings.get().littleWindow && /^https?:/i.test(url)) {
    const little = core.openWindow({ kind: 'app', urls: [url], little: true })
    little.window.focus()
    return
  }
  const { tabs, window } = core.browser()
  tabs.create(url)
  if (window.isMinimized()) window.restore()
  window.focus()
}

const openFromSystem = (event: Electron.Event, url: string) => {
  event.preventDefault()
  openLink(url)
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

const headless = headlessFromArgv(process.argv, process.cwd(), app.isPackaged ? 1 : 2)
if (headless) {
  // No window, so no display is needed either, as on a server.
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'headless')
  void runHeadless(headless).then(
    (code) => app.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Terra Code stopped.'}\n`)
      app.exit(1)
    }
  )
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (!core) return
    const code = codeFromArgv(argv, workingDirectory, app.isPackaged ? 1 : 2)
    if (code) {
      const { window } = core.browser()
      void openCode(code)
      if (window.isMinimized()) window.restore()
      window.focus()
      return
    }
    const webApp = webAppUrlFromArgv(argv)
    if (webApp) {
      core.openWindow({ kind: 'app', urls: [webApp] })
      return
    }
    const urls = urlsFromArgv(argv)
    if (urls.length > 0) return urls.forEach(openLink)
    const { window } = core.browser()
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(async () => {
    // Widevine for protected video and music, before any tab could ask for it.
    const drm = drmStartup()
    applyMenu()
    handleInternalPages()
    // Started from a menu, scTerra lacks the PATH a terminal has; Terra Code and MCP servers need it.
    void primeLoginPath()
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
    const code = codeFromArgv(process.argv, process.cwd(), app.isPackaged ? 1 : 2)
    if (code) setTimeout(() => void openCode(code), 1500)
    await drm
    const first = webApp ? core.openWindow({ kind: 'app', urls: [webApp] }) : core.openWindow({ urls: [...urlsFromArgv(process.argv), ...earlyUrls] })
    if (smokeTest) runSmokeTest(first)
    if (process.env.SCB_E2E) Object.assign(globalThis, { scbTabs: first.tabs, scbActions: first.actions, scbExtensions: core.extensions, scbSync: core.sync, scbVpn: core.vpn, scbReporter: reporter, scbUpdates: core.updates, scbCore: core })
  })

  app.on('window-all-closed', () => app.quit())
  // A restart after an update or a settings change starts the new copy as this one exits.
  dropDesktopNameAtExit((event, listener) => app.on(event, listener))
}
