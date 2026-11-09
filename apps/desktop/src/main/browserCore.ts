import { keepSessionCookies } from './sessionCookies'
import { ClosedGroups } from './closedGroups'
import { startMemorySaver } from './memorySaver'
import { startFocusTimer } from './focusTimer'
import { app, net, powerMonitor, safeStorage, session, type Session, type WebContents } from 'electron'
import { SECURE_DNS, type Settings as AppSettings, readTunToggle, TUN_TOGGLE_URL, belongsToSite, bypassRules, containerPartition, DEFAULT_WORKSPACE, textFragmentUrl, videoTimeUrl, type CitationTarget, type Workspace } from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import { AI_PARTITION, AiService } from './ai/service'
import type { AiStore } from './ai/store'
import { SiteBlocker } from './blocker'
import { DownloadManager } from './downloads'
import { ExtensionManager } from './extensions'
import { handleInternalPages } from './internal/protocol'
import { PasswordVault } from './passwords'
import { PermissionService } from './permissions'
import { PrivacyService } from './privacy/service'
import { isPrivate } from './private'
import type { Reporter } from './reporter'
import { SessionSaver, type SavedSession } from './session'
import type { SettingsStore } from './settings'
import { attachShortcuts } from './shortcuts'
import { attachPageMenu } from './menus'
import { fetchSiteIcon } from './siteIcons'
import { clearSiteStorage, forgetSite, siteSessions } from './siteData'
import { PageWatcher } from './pageWatch'
import { TabArchive } from './tabArchive'
import { goToTarget, samePage } from './citations'
import { HighlightStore } from './highlights'
import { ReadingList } from './readingList'
import { MiniApps } from './miniApps'
import { pdfPageUrl } from './internal/pdf'
import type { BookmarksRepo } from './storage/bookmarks'
import type { ChatsRepo } from './storage/chats'
import type { DownloadsRepo } from './storage/downloads'
import type { HistoryRepo } from './storage/history'
import type { KeyValueRepo } from './storage/kv'
import type { PermissionsRepo } from './storage/permissions'
import { SyncService, type KeyVault } from './sync'
import { systemProxyFor } from './systemProxy'
import type { TabManager } from './tabs/TabManager'
import { tunnelFor } from './tun'
import { UpdateService } from './updater'
import { attachGoogleSignIn } from './googleSignIn'
import { DEFAULT_PROBE, VpnService, xrayPath, type ProbeTarget } from './vpn'
import { WebApps } from './webApps'
import type { BaseWindow, BrowserWindow, WebContentsView } from 'electron'
import type { ChromeEvents, EventChannel, ExtensionsPopupState, PageRect, PermissionPrompt, TabId } from '@scbrowser/shared'

const SYNC_FIRST_MS = 20_000
const SYNC_EVERY_MS = 10 * 60_000
const WORKSPACES_KEY = 'workspaces'

const isWorkspace = (value: unknown): value is Workspace => {
  const { id, name, focus } = (value ?? {}) as Workspace
  return typeof id === 'string' && typeof name === 'string' && typeof focus === 'boolean'
}

/** Tests point pings at a local page. */
function probeTarget(): ProbeTarget {
  const [host, port] = process.env.SCB_VPN_PROBE?.split(':') ?? []
  return host && port ? { host, port: Number(port) } : DEFAULT_PROBE
}

export interface Services {
  kv: KeyValueRepo
  settings: SettingsStore
  history: HistoryRepo
  bookmarks: BookmarksRepo
  downloads: DownloadsRepo
  permissions: PermissionsRepo
  aiStore: AiStore
  chats: ChatsRepo
  reporter: Reporter
}

export type WindowKind = 'browser' | 'app'

export type Send = <E extends EventChannel>(channel: E, ...payload: ChromeEvents[E] extends void ? [] : [ChromeEvents[E]]) => void

/** One window, as what's shared across windows sees it. */
export interface BrowserWindowHandle {
  kind: WindowKind
  window: BrowserWindow
  tabs: TabManager
  actions: BrowserActions
  send: Send
  showPermission: (prompt: PermissionPrompt | null) => void
  raiseOverlay: () => void
  setExtensionFrame: (rect: PageRect | null, view: WebContentsView | null) => void
  openExtensionsPopup: (popup: ExtensionsPopupState, refresh?: boolean) => void
  passwordsChanged: () => void
  hidePages: (hidden: boolean) => void
  /** What to save so this window comes back after a restart. */
  saved: () => SavedSession
}

export interface WindowOptions {
  kind?: WindowKind
  urls?: string[]
  container?: string | null
  /** Tabs to bring back. */
  restore?: SavedSession | null
  /** Set by the core on the first browser window of a run, which decides on the intro and the rest of the last session. */
  first?: boolean
}

/**
 * What exists once per process, however many windows are open. Each window keeps its own tabs,
 * overlay and browser UI; everything here reaches them through this list.
 */
export class BrowserCore {
  readonly windows: BrowserWindowHandle[] = []
  /** Windows that come back after a restart. One closed by itself while others stay doesn't. */
  private readonly restorable = new Set<BrowserWindowHandle>()
  private lastFocused: BrowserWindowHandle | null = null
  private quitting = false
  private browserOpened = false
  private readonly prepared = new Set<Session>()
  /** Pages outside tabs, like link previews and sidebar sites, that the site blocker still screens. */
  private readonly extraPages = new WeakMap<WebContents, (url: string) => void>()
  private readonly triedIcons = new Set<string>()
  private proxyRules: string | null = null
  private spellingKey: string
  private readonly unsubscribe: (() => void)[] = []
  private readonly syncFirst: ReturnType<typeof setTimeout>
  private readonly syncTimer: ReturnType<typeof setInterval>
  private readonly lockPasswords = () => this.passwords.lock()

  readonly saver: SessionSaver
  readonly permissionService: PermissionService
  readonly extensions: ExtensionManager
  readonly blocker: SiteBlocker
  readonly privacy: PrivacyService
  readonly downloads: DownloadManager
  readonly sync: SyncService
  readonly vpn: VpnService
  readonly passwords: PasswordVault
  readonly updates: UpdateService
  readonly webApps: WebApps
  /** Private windows watch nothing and archive nothing. */
  readonly watcher: PageWatcher | null
  readonly archive: TabArchive
  readonly closedGroups: ClosedGroups
  /** Sets of tabs saved by name, which stay on the list when opened. */
  readonly tabSets: ClosedGroups
  /** Private windows keep neither. */
  readonly highlights: HighlightStore | null
  readonly readingList: ReadingList | null
  readonly miniApps: MiniApps

  constructor(
    readonly services: Services,
    /** Passed in, as windows and this need each other. */
    private readonly openWindowImpl: (core: BrowserCore, options: WindowOptions) => BrowserWindowHandle
  ) {
    const { kv, settings, history, bookmarks, aiStore } = services
    this.saver = new SessionSaver(kv, () => [...this.restorable].map((handle) => handle.saved()))
    this.spellingKey = `${settings.get().spellCheck}:${settings.get().spellLanguage}`
    this.webApps = new WebApps(kv)
    const backgroundAi = new AiService(aiStore, (id) => this.contentsFor(id))

    this.permissionService = new PermissionService(services.permissions, {
      tabIdFor: (contents) => this.tabIdFor(contents),
      windows: () => this.windows.map((handle) => ({ activeTabId: handle.tabs.active?.id ?? null, show: handle.showPermission })),
      onExternal: (contents, url, requester) => this.ownerOf(contents)?.actions.openAppLink(url, requester, contents)
    })
    this.extensions = new ExtensionManager(kv, {
      window: () => this.focused()?.window ?? this.browser().window,
      display: () => settings.get().extensionDisplay,
      sidePanelsBeside: () => settings.get().extensionSidePanels === 'beside',
      setFrame: (window, rect, view) => this.windows.find((handle) => handle.window === window)?.setExtensionFrame(rect, view),
      openPopup: (window, popup, refresh) => this.windows.find((handle) => handle.window === window)?.openExtensionsPopup(popup, refresh),
      ownerWindow: (contents) => this.ownerOf(contents)?.window ?? this.browser().window,
      isBrowserWindow: (window) => this.windows.some((handle) => handle.window === window),
      createTab: (url, active, target) => {
        const { tabs } = this.browser()
        const id = tabs.create(url, { activate: active, afterId: tabs.active?.id, container: tabs.containerIn(target) })
        return tabs.contentsFor(id)
      },
      selectTab: (contents) => {
        const owner = this.ownerOf(contents)
        const id = owner?.tabs.tabIdFor(contents)
        if (owner && id != null) owner.tabs.activate(id)
      },
      closeTab: (contents) => {
        const owner = this.ownerOf(contents)
        const id = owner?.tabs.tabIdFor(contents)
        if (owner && id != null) owner.tabs.close(id)
      },
      activeTab: (window) => {
        const handle = (window && this.windows.find((other) => other.window === window)) || this.focused()
        return handle?.tabs.active ? handle.tabs.contentsFor(handle.tabs.active.id) : undefined
      },
      activate: (id) => this.focused()?.send('extensions:activate', id),
      prepareView: (contents) => {
        const handle = this.focused() ?? this.browser()
        attachShortcuts(contents, handle.actions)
        attachPageMenu(contents, handle.actions, handle.window, () => [])
      },
      raiseOverlay: (window) => this.windows.find((handle) => handle.window === window)?.raiseOverlay(),
      openSettings: () => this.browser().actions.openPage('settings', 'ai'),
      onSummary: (summary) => this.broadcast('extensions:changed', summary),
      onPanel: (state, window) => this.windows.find((handle) => handle.window === window)?.send('extensions:panel', state),
      onLoaded: (id, newTabPage) => this.windows.forEach((handle) => handle.tabs.extensionReady(id, newTabPage))
    })
    this.blocker = new SiteBlocker(settings, kv, {
      ready: () => aiStore.status().ready,
      disabled: (host) => aiStore.disabledHosts().includes(host),
      complete: (system, user) => backgroundAi.complete(system, user)
    })
    this.privacy = new PrivacyService(settings, kv, {
      onBlocked: (id, url) => this.windows.forEach((handle) => handle.tabs.noteBlocked(id, url)),
      screen: (url, contents): string | null | Promise<string | null> => (this.ownerOf(contents) || this.extraPages.has(contents) ? this.blocker.screen(url) : null),
      onScreenedOut: (url, reason, contents) => {
        // Only a tab can show the block page, as it's an sc:// page that needs the tab's bridge.
        const elsewhere = this.extraPages.get(contents)
        if (elsewhere) return elsewhere(url)
        void contents.loadURL(this.blocker.pageFor(url, reason)).catch(() => undefined)
      },
      isTab: (contents): boolean => !!this.ownerOf(contents),
      onPdf: (url, contents) => {
        if (!isPrivate) history.recordVisit(url)
        void contents.loadURL(pdfPageUrl(url)).catch(() => undefined)
      },
      onChanged: () => this.broadcast('privacy:changed', this.privacy.offHosts())
    })
    this.downloads = new DownloadManager(services.downloads, settings, (progress) => this.broadcast('downloads:progress', progress))
    this.prepareSession(session.defaultSession)

    const vault: KeyVault = {
      encrypt: async (value) => {
        if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("This system can't store this securely yet.")
        return (await safeStorage.encryptStringAsync(value)).toString('base64')
      },
      decrypt: async (value) => (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result
    }
    this.sync = new SyncService({
      kv,
      settings,
      history,
      bookmarks,
      vault,
      basePath: `${app.getPath('userData')}/sync-base.json`,
      onBookmarksChanged: () => this.publishBookmarks()
    })
    this.vpn = new VpnService({
      kv,
      vault,
      corePath: () => xrayPath(process.resourcesPath, app.getAppPath(), app.isPackaged),
      autoFastest: () => settings.get().vpnAutoFastest,
      route: () => ({ scope: settings.get().vpnScope, method: settings.get().vpnMethod }),
      failover: () => settings.get().vpnFailover,
      setMethod: (vpnMethod) => settings.set({ vpnMethod }),
      readToggle: async () => {
        // Through the default session first, so it still gets there where only the VPN can reach GitHub.
        const url = process.env.SCB_E2E ? process.env.SCB_VPN_TOGGLE_URL : TUN_TOGGLE_URL
        if (!url) return null
        const address = `${url}?t=${Date.now()}`
        const options = { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(5_000) }
        // The VPN's own servers may be what's down, so a failed try goes again outside the VPN.
        const response = await session.defaultSession.fetch(address, options).catch(() => fetch(address, options))
        return response.ok ? readTunToggle(await response.text()) : null
      },
      systemProxy: systemProxyFor(),
      tun: tunnelFor(),
      applyProxy: async (rules) => {
        this.proxyRules = rules
        // The assistant has its own session, and its requests should take the same route as tabs.
        for (const target of [...this.prepared, session.fromPartition(AI_PARTITION)]) {
          await this.applySessionProxy(target)
          await target.closeAllConnections()
        }
        // WebRTC would otherwise reveal the real address by skipping the proxy.
        const policy = rules ? 'disable_non_proxied_udp' : 'default'
        for (const contents of this.allContents()) contents.setWebRTCIPHandlingPolicy(policy)
      },
      probeTarget: probeTarget(),
      fetchText: async (url) => {
        const response = await net.fetch(url)
        if (!response.ok) throw new Error(`The subscription answered with error ${response.status}.`)
        return response.text()
      },
      onChange: () => this.broadcast('vpn:changed', this.vpn.summary())
    })
    // Asked to always connect, nothing goes out until it has.
    if (settings.get().vpnAutoConnect && !isPrivate) void this.vpn.holdPages().then(() => this.vpn.connectAtStart())

    let extensionDisplay = settings.get().extensionDisplay
    let bypassInUse = JSON.stringify([settings.get().vpnBypass, settings.get().vpnDirectContainers])
    this.unsubscribe.push(
      settings.subscribe((next) => {
        const wanted = JSON.stringify([next.vpnBypass, next.vpnDirectContainers])
        if (wanted === bypassInUse) return
        bypassInUse = wanted
        if (!this.proxyRules) return
        for (const target of [...this.prepared, session.fromPartition(AI_PARTITION)]) void this.applySessionProxy(target).then(() => target.closeAllConnections())
      }),
      settings.subscribe((next) => {
        this.broadcast('settings:changed', next)
        if (next.extensionDisplay !== extensionDisplay) {
          extensionDisplay = next.extensionDisplay
          this.extensions.displayChanged()
        }
        const key = `${next.spellCheck}:${next.spellLanguage}`
        if (key !== this.spellingKey) this.prepared.forEach((target) => this.applySpelling(target))
        this.spellingKey = key
      }),
      aiStore.subscribe(() => this.broadcast('ai:changed', aiStore.status()))
    )

    this.passwords = new PasswordVault({
      kv,
      available: !isPrivate,
      device: isPrivate ? undefined : vault,
      lockMinutes: () => settings.get().passwordLockMinutes,
      onChange: () => {
        this.broadcast('passwords:changed', this.passwords.state())
        this.windows.forEach((handle) => handle.passwordsChanged())
      }
    })
    powerMonitor.on('lock-screen', this.lockPasswords)
    powerMonitor.on('suspend', this.lockPasswords)

    this.syncFirst = setTimeout(() => void this.sync.run(), SYNC_FIRST_MS)
    this.syncTimer = setInterval(() => void this.sync.run(), SYNC_EVERY_MS)
    let installing = false
    this.updates = new UpdateService(settings, (state) => {
      this.broadcast('updates:changed', state)
      // Pages draw above the browser's interface, so they step aside for the update screen.
      const now = state.phase === 'installing'
      if (now !== installing) this.windows.forEach((handle) => handle.hidePages(now))
      installing = now
    })
    this.updates.start()
    app.on('before-quit', () => {
      this.quitting = true
      // Cookies are written in batches; a quick quit could lose the last sign-in.
      for (const target of this.prepared) void target.cookies.flushStore().catch(() => undefined)
    })
    if (!isPrivate) this.forgetOnClose()
    this.archive = new TabArchive(kv, () => undefined)
    this.closedGroups = new ClosedGroups(kv)
    this.tabSets = new ClosedGroups(kv, 'tabs:saved-sets')
    const applyDns = ({ secureDns }: AppSettings) => {
      const url = SECURE_DNS[secureDns].url
      app.configureHostResolver(url ? { secureDnsMode: 'secure', secureDnsServers: [url] } : { secureDnsMode: 'automatic', secureDnsServers: [] })
    }
    let lastDns = settings.get().secureDns
    if (lastDns !== 'default') applyDns(settings.get())
    settings.subscribe((next) => {
      if (next.secureDns === lastDns) return
      lastDns = next.secureDns
      applyDns(next)
    })
    this.highlights = isPrivate ? null : new HighlightStore(kv)
    this.readingList = isPrivate ? null : new ReadingList(kv)
    this.miniApps = new MiniApps(kv)
    this.watcher = isPrivate
      ? null
      : new PageWatcher(kv, {
          onChange: () => undefined,
          openTab: (url) => {
            const { tabs, window } = this.browser()
            tabs.create(url)
            window.show()
            window.focus()
          }
        })
    app.on('will-quit', () => this.watcher?.destroy())
    const stopSaver = startMemorySaver({
      enabled: () => settings.get().memorySaver,
      memory: () => process.getSystemMemoryInfo(),
      // The oldest tabs of all windows count together, a couple at a time.
      sleepOldest: (count, minIdleMs) => {
        let slept = 0
        for (const handle of this.windows) if (slept < count) slept += handle.tabs.sleepOldest(count - slept, minIdleMs)
        return slept
      }
    })
    app.on('will-quit', stopSaver)
    const stopFocus = startFocusTimer(settings, () => this.focused()?.actions.notify('Focus session over. Focus Mode is off.'))
    app.on('will-quit', stopFocus)
  }

  /** Clears what this computer remembers about a site, then reloads its open tabs so they start fresh. */
  async forgetSite(base: string): Promise<void> {
    await forgetSite(base, this.services)
    for (const handle of this.windows) {
      for (const contents of handle.tabs.allContents()) {
        const url = contents.getURL()
        if (/^https?:/.test(url) && URL.canParse(url) && belongsToSite(new URL(url).hostname, base)) contents.reload()
      }
    }
  }

  /**
   * Sites the person asked to be forgotten each time. Cleared as scTerra quits, after its windows
   * have gone, and again at the next start in case quitting was cut short by a crash or power cut.
   */
  private forgetOnClose(): void {
    const { settings, history } = this.services
    const clear = (withHistory: boolean) => {
      const sites = settings.get().forgetOnClose
      const origins = withHistory ? sites.map((base) => history.forgetSite(base)) : sites.map(() => [])
      return Promise.all(sites.flatMap((base, i) => siteSessions().map((target) => clearSiteStorage(target, base, origins[i]!))))
    }
    if (settings.get().forgetOnClose.length > 0) void clear(true)
    let cleared = false
    app.on('will-quit', (event) => {
      if (cleared || settings.get().forgetOnClose.length === 0) return
      cleared = true
      event.preventDefault()
      // Never holds quitting up for long: what's left is cleared at the next start.
      void Promise.race([clear(true).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 4000))]).then(() => app.quit())
    })
  }

  openWindow(options: WindowOptions = {}): BrowserWindowHandle {
    // The first browser window of a run brings back the last session, even if an installed site's came before it.
    const isBrowser = options.kind !== 'app'
    const first = isBrowser && !this.browserOpened
    if (isBrowser) this.browserOpened = true
    return this.openWindowImpl(this, { ...options, first })
  }

  add(handle: BrowserWindowHandle): void {
    this.windows.push(handle)
    if (handle.kind === 'browser') {
      this.restorable.add(handle)
      this.lastFocused ??= handle
    }
    handle.window.on('focus', () => {
      if (handle.kind === 'browser') this.lastFocused = handle
    })
  }

  /** The window's `close` event: saves what should come back, which isn't a window closed by itself. */
  closing(handle: BrowserWindowHandle): void {
    if (handle.kind !== 'browser') return
    const others = [...this.restorable].filter((other) => other !== handle)
    if (!this.quitting && others.length > 0) this.restorable.delete(handle)
    this.saver.flush()
    // The windows go one at a time when quitting, and all of them have just been saved.
    if (this.quitting) this.saver.stop()
  }

  /** The window's `closed` event. The last one out shuts everything else down. */
  closed(handle: BrowserWindowHandle): void {
    this.windows.splice(this.windows.indexOf(handle), 1)
    this.restorable.delete(handle)
    this.extensions.windowClosed(handle.window)
    if (this.lastFocused === handle) this.lastFocused = this.windows.find((other) => other.kind === 'browser') ?? null
    if (this.windows.length === 0) this.shutDown()
  }

  private shutDown(): void {
    clearTimeout(this.syncFirst)
    clearInterval(this.syncTimer)
    this.sync.stop()
    this.updates.stop()
    this.vpn.stop()
    this.unsubscribe.forEach((stop) => stop())
    powerMonitor.off('lock-screen', this.lockPasswords)
    powerMonitor.off('suspend', this.lockPasswords)
    this.saver.stop()
    this.passwords.lock()
  }

  /** The browser window in use, if there's one open. */
  focused(): BrowserWindowHandle | null {
    return this.lastFocused
  }

  /** The browser window in use, opening one if only app windows are left. */
  browser(): BrowserWindowHandle {
    return this.lastFocused ?? this.openWindow()
  }

  /** Whether closing this window's last tab should close the window too. */
  otherBrowserWindowsOpen(): boolean {
    return this.windows.filter((handle) => handle.kind === 'browser').length > 1
  }

  broadcast: Send = (channel, ...payload) => {
    for (const handle of this.windows) handle.send(channel, ...payload)
  }

  /**
   * Follows a citation: to its tab if that's still on the page, or else a new tab at the address,
   * which finds the words or the moment by itself as it loads.
   */
  openSource(source: { tabId: number | null; url: string }, target: CitationTarget): void {
    for (const handle of this.windows) {
      const contents = source.tabId === null ? undefined : handle.tabs.contentsFor(source.tabId)
      if (!contents || !samePage(contents.getURL(), source.url)) continue
      handle.tabs.activate(source.tabId!)
      handle.window.focus()
      void goToTarget(contents, target)
      return
    }
    // A sleeping tab has no page to look at yet, but still knows its address.
    for (const handle of this.windows) {
      const tab = source.tabId === null ? undefined : handle.tabs.snapshot().tabs.find((candidate) => candidate.id === source.tabId)
      if (!tab || !samePage(tab.url, source.url)) continue
      handle.tabs.activate(tab.id)
      handle.window.focus()
      const woken = handle.tabs.contentsFor(tab.id)
      if (woken) void goToTarget(woken, target)
      return
    }
    const { tabs, window } = this.focused() ?? this.browser()
    tabs.create(target.seconds !== null ? videoTimeUrl(source.url, target.seconds) : textFragmentUrl(source.url, target.quote), { afterId: tabs.active?.id })
    window.focus()
  }

  /** Screens a page that isn't a tab, handing anything blocked back to be opened as a tab. */
  watchPage(contents: WebContents, onBlocked: (url: string) => void): void {
    this.extraPages.set(contents, onBlocked)
  }

  ownerOf(contents: WebContents): BrowserWindowHandle | undefined {
    return this.windows.find((handle) => handle.tabs.owns(contents))
  }

  tabIdFor(contents: WebContents): TabId | null {
    return this.ownerOf(contents)?.tabs.tabIdFor(contents) ?? null
  }

  /** Tab ids are unique across windows. */
  contentsFor(id: TabId): WebContents | undefined {
    for (const { tabs } of this.windows) {
      const contents = tabs.contentsFor(id)
      if (contents) return contents
    }
    return undefined
  }

  allContents(): WebContents[] {
    return this.windows.flatMap((handle) => handle.tabs.allContents())
  }

  savedWorkspaces(): Workspace[] {
    const saved = this.services.kv.get(WORKSPACES_KEY)
    const list = Array.isArray(saved) ? saved.filter(isWorkspace) : []
    return list.some(({ id }) => id === DEFAULT_WORKSPACE.id) ? list : [DEFAULT_WORKSPACE, ...list]
  }

  storeWorkspaces(list: Workspace[]): void {
    this.services.kv.set(WORKSPACES_KEY, list)
    for (const { tabs } of this.windows) tabs.setWorkspaces(list)
  }

  /** Its tabs join each window's first workspace, so nothing disappears with it. */
  removeWorkspace(id: string): void {
    for (const { tabs } of this.windows) tabs.removeWorkspace(id)
    this.services.kv.set(WORKSPACES_KEY, this.windows[0]?.tabs.workspaceList() ?? this.savedWorkspaces().filter((workspace) => workspace.id !== id))
  }

  publishBookmarks(): void {
    const { bookmarks } = this.services
    this.broadcast('bookmarks:changed', bookmarks.list())
    this.broadcast('bookmark-groups:changed', bookmarks.groups())
    void this.fillMissingIcons()
  }

  needsIcon(url: string): boolean {
    return URL.canParse(url) && this.services.bookmarks.list().some((b) => URL.canParse(b.url) && new URL(b.url).host === new URL(url).host && !b.icon)
  }

  storeIcon(url: string, icon: string | null): void {
    if (!icon || this.windows.length === 0) return
    this.services.bookmarks.setIcon(new URL(url).host, icon)
    this.broadcast('bookmarks:changed', this.services.bookmarks.list())
  }

  /** Bookmarks added from elsewhere have never been visited, so ask each site for its icon once. */
  async fillMissingIcons(): Promise<void> {
    for (const { url, icon } of this.services.bookmarks.list()) {
      if (icon || !/^https?:/.test(url) || !URL.canParse(url) || this.triedIcons.has(new URL(url).host)) continue
      this.triedIcons.add(new URL(url).host)
      this.storeIcon(url, await fetchSiteIcon(session.defaultSession, url))
    }
  }

  prepareSession(target: Session): void {
    if (this.prepared.has(target)) return
    this.prepared.add(target)
    if (!isPrivate) keepSessionCookies(target, () => this.services.settings.get().keepSignIns)
    attachGoogleSignIn(target)
    this.privacy.attach(target)
    this.permissionService.attach(target)
    this.downloads.attach(target)
    this.applySpelling(target)
    void this.extensions.attach(target)
    // A container opened while the VPN is on joins it straight away.
    if (this.proxyRules) void this.applySessionProxy(target)
    if (target !== session.defaultSession) handleInternalPages(target)
  }

  /** Macs always use the system's own dictionaries, and only the switch applies there. */
  private applySpelling(target: Session): void {
    const { spellCheck, spellLanguage } = this.services.settings.get()
    // Automated tests must not reach the network, and dictionaries come from Google's servers.
    if (process.env.SCB_E2E) target.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/')
    // Choosing a language turns checking back on, so the switch has to come after it.
    if (process.platform === 'darwin') return target.setSpellCheckerEnabled(spellCheck)
    const available = target.availableSpellCheckerLanguages
    const wanted = [spellLanguage, ...app.getPreferredSystemLanguages()]
    const match = wanted
      .flatMap((code) => (code ? [code, code.split('-')[0]!] : []))
      .flatMap((code) => available.find((language) => language === code) ?? available.find((language) => language.startsWith(`${code}-`)) ?? [])
    target.setSpellCheckerLanguages([match[0] ?? 'en-US'])
    target.setSpellCheckerEnabled(spellCheck)
  }

  private applySessionProxy(target: Session): Promise<void> {
    // A container the person set to go direct skips the VPN; everything else takes it.
    const direct = this.services.settings.get().vpnDirectContainers.some((id) => session.fromPartition(containerPartition(id)) === target)
    if (direct) return target.setProxy({ mode: 'direct' })
    // Tests serve pages from this computer, which Chromium would otherwise send direct.
    const proxyBypassRules = [...(process.env.SCB_E2E ? ['<-loopback>'] : []), bypassRules(this.services.settings.get().vpnBypass)].filter(Boolean).join(';')
    return target.setProxy(this.proxyRules ? { mode: 'fixed_servers', proxyRules: this.proxyRules, proxyBypassRules } : { mode: 'direct' })
  }
}

export type { BaseWindow }
