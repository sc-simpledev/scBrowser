import { join } from 'node:path'
import { session, WebContentsView, type AuthInfo, type AuthenticationResponseDetails, type BaseWindow, type Session, type WebContents, type BrowserWindowConstructorOptions } from 'electron'
import {
  containerPartition,
  DEFAULT_WORKSPACE,
  effectiveUrl,
  ERROR_PAGE_URL,
  isNewTabUrl,
  isReaderUrl,
  NEW_TAB_URL,
  resolveOmniboxInput,
  type CleanupInput,
  type PageRect,
  type SearchEngine,
  type TabId,
  type TabState,
  type TabsSnapshot,
  type Workspace
} from '@scbrowser/shared'

/** A tab as saved to disk or held while asleep; `entries` is its back/forward list. */
export interface SavedTab {
  url: string
  title: string
  faviconUrl: string | null
  entries: { url: string; title: string }[]
  entryIndex: number
  container?: string | null
  group?: string | null
  workspace?: string
  lastActiveAt?: number
}

interface Tab {
  state: TabState
  /** The tab whose page opened this one as a popup. */
  openerId?: TabId
  /** Null while asleep: the page is unloaded and only `saved` remains. */
  view: WebContentsView | null
  saved: SavedTab | null
  lastActiveAt: number
}

interface TabManagerOptions {
  /** Called (coalesced per tick) whenever any tab or the active tab changes. */
  onChange: (snapshot: TabsSnapshot) => void
  /** Lets the caller hook keyboard shortcuts and other per-tab behaviour. */
  onTabCreated: (contents: WebContents) => void
  onTabClosed: (id: TabId) => void
  onActivate: (tab: TabState) => void
  /** The new tab page finished loading, which pulls keyboard focus into it. */
  onNewTabLoaded: () => void
  /** A tab committed a navigation (including same-document ones). */
  onVisit: (url: string) => void
  onTitle: (url: string, title: string) => void
  onFavicon: (contents: WebContents, pageUrl: string, iconUrl: string) => void
  onPageLoaded: (contents: WebContents) => void
  onFound: (result: { active: number; total: number }) => void
  onFullscreen: (fullscreen: boolean) => void
  engine: () => SearchEngine
  /** Builds the error page address for a failed load. */
  errorUrl: (url: string, reason: string) => string
  /** Called before a session is first used, so it gets the same protections as the default one. */
  prepareSession: (session: Session) => void
  /** A site or proxy wants a username and password. */
  onLogin: (contents: WebContents, details: AuthenticationResponseDetails, info: AuthInfo, respond: (username?: string, password?: string) => void) => void
  /** The zoom saved for this page's site, or 1. */
  zoomFor: (url: string) => number
  onZoom: (url: string, factor: number) => void
  onWorkspaceChange: (next: Workspace, previous: Workspace | undefined) => void
  /** The page an extension shows in place of the new tab page, if one does. */
  newTabPage: (session: Session) => string | null
}

const PAGE_RADIUS = 0
const SPLIT_GAP = 6
const CLOSED_TABS_LIMIT = 25
const ABORTED = -3
/** The site blocker stopped the load, and shows its own page. */
const BLOCKED_BY_CLIENT = -20
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

const isInternal = (url: string) => url.startsWith('sc:')
const isSavable = (url: string) => /^(https?|sc|file|chrome-extension):/i.test(url)
const remembersZoom = (url: string) => /^(https?|file):/i.test(url)
/** The first-run intro plays again if it was closed partway through, rather than coming back as a tab. */
const isIntro = (url: string) => url.startsWith('sc://welcome')

export class TabManager {
  private readonly tabs = new Map<TabId, Tab>()
  private order: TabId[] = []
  private activeId: TabId | null = null
  private nextId = 1
  private pageRect: PageRect = { x: 0, y: 0, width: 0, height: 0 }
  private resizing = false
  private closed: SavedTab[] = []
  private changeQueued = false
  private fullscreen = false
  /** Left and right tabs while split view is on. */
  private split: [TabId, TabId] | null = null
  /** This tab covers the whole window, for the first-run intro. */
  private immersiveId: TabId | null = null
  private workspaces: Workspace[]
  private workspaceId: string = DEFAULT_WORKSPACE.id
  private readonly lastInWorkspace = new Map<string, TabId>()

  constructor(
    private readonly window: BaseWindow,
    private readonly options: TabManagerOptions,
    workspaces: Workspace[] = [DEFAULT_WORKSPACE]
  ) {
    this.workspaces = workspaces
  }

  /** Tabs in the open workspace, which is all that's ever shown. */
  private get visible(): TabId[] {
    return this.order.filter((id) => this.tabs.get(id)?.state.workspace === this.workspaceId)
  }

  workspaceList(): Workspace[] {
    return this.workspaces
  }

  get workspace(): Workspace {
    return this.workspaces.find((w) => w.id === this.workspaceId) ?? DEFAULT_WORKSPACE
  }

  setWorkspaces(workspaces: Workspace[]): void {
    this.workspaces = workspaces
    this.emitChange()
  }

  switchWorkspace(id: string): void {
    const next = this.workspaces.find((w) => w.id === id)
    if (!next || id === this.workspaceId) return
    const previous = this.workspace
    this.endSplit()
    if (this.activeId !== null) {
      const tab = this.tabs.get(this.activeId)
      tab?.view?.setVisible(false)
      tab?.view?.webContents.stopFindInPage('clearSelection')
      if (tab) tab.lastActiveAt = Date.now()
      this.lastInWorkspace.set(this.workspaceId, this.activeId)
    }
    this.workspaceId = id
    this.activeId = null
    const tabs = this.visible
    const last = this.lastInWorkspace.get(id)
    const target = last !== undefined && tabs.includes(last) ? last : tabs[0]
    if (target === undefined) this.create()
    else this.activate(target)
    this.options.onWorkspaceChange(next, previous)
  }

  /** The workspace's tabs join the first one, so nothing disappears with it. */
  removeWorkspace(id: string): void {
    if (id === DEFAULT_WORKSPACE.id) return
    if (this.workspaceId === id) this.switchWorkspace(DEFAULT_WORKSPACE.id)
    for (const tab of this.tabs.values()) if (tab.state.workspace === id) tab.state.workspace = DEFAULT_WORKSPACE.id
    this.workspaces = this.workspaces.filter((w) => w.id !== id)
    this.emitChange()
  }

  /** What's needed to suggest tabs to close in the open workspace. */
  cleanupInput(): CleanupInput[] {
    return this.visible.flatMap((id) => {
      const tab = this.tabs.get(id)!
      const url = effectiveUrl(tab.state.url)
      return isInternal(url) && !isNewTabUrl(url) ? [] : [{ id, url, title: tab.state.title, lastActiveAt: tab.lastActiveAt }]
    })
  }

  /** Every loaded tab, including those in other workspaces. */
  allContents(): WebContents[] {
    return [...this.tabs.values()].flatMap((tab) => (tab.view ? [tab.view.webContents] : []))
  }

  setImmersive(id: TabId | null): void {
    this.immersiveId = id
    this.applyBounds()
  }

  create(
    url: string = NEW_TAB_URL,
    { activate = true, afterId, container = null }: { activate?: boolean; afterId?: TabId; container?: string | null } = {}
  ): TabId {
    const tab = this.addTab(url, null, afterId)
    tab.state.container = container
    tab.state.workspace = this.workspaceId
    this.wake(tab)
    if (activate || this.activeId === null) this.activate(tab.state.id)
    else this.emitChange()
    return tab.state.id
  }

  /** Adds saved tabs without loading them; only the one that gets activated wakes up. */
  restore(saved: SavedTab[], activeIndex: number, split: [number, number] | null = null): void {
    const known = (id: string | undefined) => this.workspaces.some((w) => w.id === id)
    const ids = saved.map((tab) => this.addTab(tab.url, { ...tab, workspace: known(tab.workspace) ? tab.workspace : DEFAULT_WORKSPACE.id }).state.id)
    const active = ids[activeIndex] ?? ids[0]
    if (active === undefined) return
    this.activate(active)
    const other = split?.map((index) => ids[index]).find((id) => id !== active)
    if (other !== undefined && split!.some((index) => ids[index] === active) && this.visible.includes(other)) this.startSplit(other)
  }

  close(id: TabId): void {
    const tab = this.tabs.get(id)
    if (!tab) return

    if (this.split?.includes(id)) this.endSplit()
    const index = this.visible.indexOf(id)
    this.order.splice(this.order.indexOf(id), 1)
    this.tabs.delete(id)
    if (!isNewTabUrl(tab.state.url)) this.closed = [this.toSaved(tab), ...this.closed].slice(0, CLOSED_TABS_LIMIT)

    this.destroyView(tab)
    this.options.onTabClosed(id)

    if (this.activeId === id) {
      this.activeId = null
      // Like Firefox/Chrome: focus the tab to the right, else the one to the left.
      // A popup goes back to the page that opened it, like closing a real window does.
      const opener = tab.openerId !== undefined && this.visible.includes(tab.openerId) ? tab.openerId : undefined
      const next = opener ?? this.visible[index] ?? this.visible[index - 1]
      if (next !== undefined) this.activate(next)
    }
    if (this.visible.length === 0) this.create()
    this.emitChange()
  }

  /** Reopens a tab's page in a container (or none), replacing the tab. */
  reopenInContainer(id: TabId, container: string | null): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.create(effectiveUrl(tab.state.url), { afterId: id, container })
    this.close(id)
  }

  /** Names groups and brings each group's tabs together, ahead of the ungrouped ones. */
  applyGroups(groups: { name: string; ids: TabId[] }[]): void {
    const grouped = groups.flatMap(({ name, ids }) =>
      ids.filter((id) => {
        const tab = this.tabs.get(id)
        if (tab) tab.state.group = name
        return !!tab
      })
    )
    this.order = [...grouped, ...this.order.filter((id) => !grouped.includes(id))]
    this.emitChange()
  }

  clearGroups(): void {
    for (const tab of this.tabs.values()) tab.state.group = null
    this.emitChange()
  }

  closeOthers(id: TabId): void {
    for (const other of this.visible) if (other !== id) this.close(other)
  }

  duplicate(id: TabId): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const copy = this.addTab(tab.state.url, this.toSaved(tab), id)
    this.activate(copy.state.id)
  }

  reopenClosed(): void {
    const saved = this.closed.shift()
    if (!saved) return
    const tab = this.addTab(saved.url, { ...saved, workspace: this.workspaceId }, this.activeId ?? undefined)
    this.activate(tab.state.id)
  }

  /** `index` counts the tabs in view, which may have others in between them. */
  move(id: TabId, index: number): void {
    const from = this.order.indexOf(id)
    if (from === -1) return
    const others = this.visible.filter((other) => other !== id)
    const before = others[Math.max(0, index)]
    this.order.splice(from, 1)
    const at = before === undefined ? (others.length > 0 ? this.order.indexOf(others.at(-1)!) + 1 : this.order.length) : this.order.indexOf(before)
    this.order.splice(at, 0, id)
    this.emitChange()
  }

  activate(id: TabId): void {
    const next = this.tabs.get(id)
    if (!next) return
    this.workspaceId = next.state.workspace
    if (this.split?.includes(id)) {
      this.activeId = id
      this.options.onActivate(next.state)
      this.emitChange()
      return
    }
    if (this.split) this.endSplit()
    if (this.activeId !== null && this.activeId !== id) {
      const previous = this.tabs.get(this.activeId)
      if (previous) {
        previous.view?.setVisible(false)
        previous.lastActiveAt = Date.now()
        previous.view?.webContents.stopFindInPage('clearSelection')
      }
    }
    this.activeId = id
    this.wake(next)
    next.lastActiveAt = Date.now()
    this.applyBounds()
    next.view?.setVisible(true)
    this.options.onActivate(next.state)
    this.emitChange()
  }

  /** Shows `id` beside the active tab. */
  startSplit(id: TabId): void {
    const other = this.tabs.get(id)
    if (this.activeId === null || id === this.activeId || !other) return
    if (this.split) this.endSplit()
    this.split = [this.activeId, id]
    this.wake(other)
    other.lastActiveAt = Date.now()
    other.view?.setVisible(true)
    this.applyBounds()
    this.emitChange()
  }

  /** Splits with the tab after the active one, or ends split view if it's on. */
  toggleSplit(): void {
    if (this.split) {
      this.endSplit()
      return
    }
    const tabs = this.visible
    if (this.activeId === null || tabs.length < 2) return
    const next = tabs[(tabs.indexOf(this.activeId) + 1) % tabs.length]
    if (next !== undefined) this.startSplit(next)
  }

  endSplit(): void {
    if (!this.split) return
    for (const id of this.split) if (id !== this.activeId) this.tabs.get(id)?.view?.setVisible(false)
    this.split = null
    this.applyBounds()
    this.emitChange()
  }

  activateRelative(offset: number): void {
    const tabs = this.visible
    if (this.activeId === null || tabs.length < 2) return
    const nextIndex = (tabs.indexOf(this.activeId) + offset + tabs.length) % tabs.length
    this.activate(tabs[nextIndex]!)
  }

  /** Ctrl+1…8 picks a position; Ctrl+9 always picks the last tab. */
  activateIndex(position: number): void {
    const id = position >= 9 ? this.visible.at(-1) : this.visible[position - 1]
    if (id !== undefined) this.activate(id)
  }

  navigate(id: TabId, input: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.wake(tab)
    const contents = tab.view!.webContents
    void contents.loadURL(this.pageFor(contents, resolveOmniboxInput(input, this.options.engine())))
    contents.focus()
  }

  /** Opens an internal page, reusing a tab already showing it. */
  openInternal(url: string): void {
    const existing = this.visible.find((id) => this.tabs.get(id)?.state.url.startsWith(url))
    if (existing !== undefined) this.activate(existing)
    else if (this.active && isNewTabUrl(this.active.url)) this.navigate(this.active.id, url)
    else this.create(url, { afterId: this.activeId ?? undefined })
  }

  back(id: TabId): void {
    this.contents(id)?.navigationHistory.goBack()
  }

  forward(id: TabId): void {
    this.contents(id)?.navigationHistory.goForward()
  }

  reload(id: TabId, ignoreCache = false): void {
    const contents = this.contents(id)
    const url = contents?.getURL() ?? ''
    if (url.startsWith(ERROR_PAGE_URL)) void contents?.loadURL(effectiveUrl(url))
    else if (ignoreCache) contents?.reloadIgnoringCache()
    else contents?.reload()
  }

  /** Leaves reader view for the original page. */
  exitReader(id: TabId): void {
    const contents = this.contents(id)
    const url = contents?.getURL() ?? ''
    if (isReaderUrl(url)) void contents?.loadURL(effectiveUrl(url))
  }

  stop(id: TabId): void {
    this.contents(id)?.stop()
  }

  toggleDevTools(id: TabId): void {
    this.contents(id)?.toggleDevTools()
  }

  print(id: TabId): void {
    this.contents(id)?.print()
  }

  zoomBy(id: TabId, direction: 1 | -1): void {
    const contents = this.contents(id)
    if (!contents) return
    const current = contents.getZoomFactor()
    const step =
      direction > 0 ? ZOOM_STEPS.find((z) => z > current + 0.001) : ZOOM_STEPS.findLast((z) => z < current - 0.001)
    if (step !== undefined) this.setZoom(id, step)
  }

  setZoom(id: TabId, factor: number): void {
    const tab = this.tabs.get(id)
    if (!tab?.view) return
    tab.view.webContents.setZoomFactor(factor)
    tab.state.zoomPercent = Math.round(factor * 100)
    if (remembersZoom(tab.state.url)) this.options.onZoom(tab.state.url, factor)
    this.emitChange()
  }

  find(text: string, options: { forward: boolean; findNext: boolean }): void {
    if (this.activeId === null) return
    const contents = this.contents(this.activeId)
    if (!text) contents?.stopFindInPage('clearSelection')
    else contents?.findInPage(text, options)
  }

  stopFind(): void {
    if (this.activeId !== null) this.contents(this.activeId)?.stopFindInPage('clearSelection')
  }

  /** While a sidebar is dragged, a page under the pointer would otherwise take the mouse events. */
  setResizing(resizing: boolean): void {
    this.resizing = resizing
    const shown = this.split ?? (this.activeId === null ? [] : [this.activeId])
    for (const id of shown) this.tabs.get(id)?.view?.setVisible(!resizing)
    this.applyBounds()
  }

  setPageRect(rect: PageRect): void {
    this.pageRect = rect
    this.applyBounds()
  }

  get page(): PageRect {
    return this.pageRect
  }

  /** Re-fits the active tab: the page area normally, the whole window for fullscreen video. */
  applyBounds(): void {
    if (this.activeId === null || this.resizing) return
    const view = this.tabs.get(this.activeId)?.view
    if (!view) return
    const { width, height } = this.window.getContentBounds()
    const [left, right] = this.split ?? []
    const covers = this.fullscreen || this.immersiveId === this.activeId
    if (this.split && !covers) {
      const leftWidth = Math.floor((this.pageRect.width - SPLIT_GAP) / 2)
      const rightX = this.pageRect.x + leftWidth + SPLIT_GAP
      for (const [id, x, w] of [
        [left!, this.pageRect.x, leftWidth],
        [right!, rightX, this.pageRect.width - leftWidth - SPLIT_GAP]
      ] as const) {
        const side = this.tabs.get(id)?.view
        side?.setVisible(true)
        side?.setBounds({ ...this.pageRect, x, width: w })
        side?.setBorderRadius(PAGE_RADIUS)
      }
      return
    }
    // Fullscreen video covers the window, so the other half of a split steps aside.
    if (this.split) this.tabs.get(left === this.activeId ? right! : left!)?.view?.setVisible(false)
    view.setBounds(covers ? { x: 0, y: 0, width, height } : this.pageRect)
    view.setBorderRadius(covers ? 0 : PAGE_RADIUS)
  }

  get active(): TabState | null {
    return this.activeId === null ? null : (this.tabs.get(this.activeId)?.state ?? null)
  }

  focusActive(): void {
    if (this.activeId !== null) this.contents(this.activeId)?.focus()
  }

  contentsFor(id: TabId): WebContents | undefined {
    return this.contents(id)
  }

  noteBlocked(webContentsId: number): void {
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === webContentsId) {
        tab.state.blockedCount++
        this.emitChange()
      }
    }
  }

  /** The container a session belongs to, going by the tabs using it. */
  containerIn(target: Session): string | null {
    for (const tab of this.tabs.values()) if (tab.view?.webContents.session === target) return tab.state.container
    return null
  }

  /** Extensions load after tabs are restored, so tabs that needed one try again now it's here. */
  extensionReady(id: string, newTabPage: string | null): void {
    for (const { state, view } of this.tabs.values()) {
      if (!view) continue
      const contents = view.webContents
      if (isNewTabUrl(state.url) && isNewTabUrl(contents.getURL()) && newTabPage) void contents.loadURL(newTabPage).catch(() => undefined)
      const url = effectiveUrl(state.url)
      if (url.startsWith(`chrome-extension://${id}/`) && contents.getURL() !== url) void contents.loadURL(url).catch(() => undefined)
    }
  }

  owns(contents: WebContents): boolean {
    return [...this.tabs.values()].some((tab) => tab.view?.webContents === contents)
  }

  tabIdFor(contents: WebContents): TabId | null {
    for (const tab of this.tabs.values()) if (tab.view?.webContents === contents) return tab.state.id
    return null
  }

  snapshot(): TabsSnapshot {
    return {
      tabs: this.visible.map((id) => ({ ...this.tabs.get(id)!.state })),
      activeId: this.activeId,
      splitIds: this.split ? [...this.split] : [],
      workspaces: this.workspaces,
      activeWorkspace: this.workspaceId
    }
  }

  /** What to write to disk so the session can be restored. */
  session(): { tabs: SavedTab[]; activeIndex: number; split: [number, number] | null } {
    const kept = this.order.filter((id) => !isIntro(this.tabs.get(id)!.state.url))
    const left = this.split ? kept.indexOf(this.split[0]) : -1
    const right = this.split ? kept.indexOf(this.split[1]) : -1
    return {
      tabs: kept.map((id) => this.toSaved(this.tabs.get(id)!)),
      activeIndex: this.activeId === null ? 0 : Math.max(0, kept.indexOf(this.activeId)),
      split: left === -1 || right === -1 ? null : [left, right]
    }
  }

  /** Unloads background tabs idle for longer than `maxIdleMs`. */
  sleepIdle(maxIdleMs: number, now = Date.now()): void {
    for (const tab of this.tabs.values()) {
      if (tab.state.id === this.activeId || this.split?.includes(tab.state.id) || !tab.view || now - tab.lastActiveAt < maxIdleMs) continue
      const contents = tab.view.webContents
      if (contents.isLoading() || contents.isCurrentlyAudible() || contents.isDevToolsOpened()) continue
      // Sleeping would cut the link between a popup and its opener, which may be mid sign-in.
      const inPopupPair = (tab.openerId !== undefined && this.tabs.get(tab.openerId)?.view) || [...this.tabs.values()].some((other) => other.openerId === tab.state.id && other.view)
      if (inPopupPair) continue
      tab.saved = this.toSaved(tab)
      this.destroyView(tab)
      tab.state.isSleeping = true
      this.emitChange()
    }
  }

  destroy(): void {
    for (const tab of this.tabs.values()) this.destroyView(tab)
    this.tabs.clear()
    this.order = []
  }

  /** The new tab page may be an extension's. Tabs still say `sc://newtab`, so they're treated as new tabs. */
  private pageFor(contents: WebContents, url: string): string {
    return isNewTabUrl(url) ? (this.options.newTabPage(contents.session) ?? url) : url
  }

  private shownUrl(contents: WebContents, url: string): string {
    const page = this.options.newTabPage(contents.session)
    return page && url.split(/[?#]/)[0] === page ? NEW_TAB_URL : url
  }

  private contents(id: TabId): WebContents | undefined {
    return this.tabs.get(id)?.view?.webContents
  }

  private addTab(url: string, saved: SavedTab | null, afterId?: TabId): Tab {
    const tab: Tab = {
      state: {
        id: this.nextId++,
        url,
        title: saved?.title ?? '',
        faviconUrl: saved?.faviconUrl ?? null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isSleeping: saved !== null,
        zoomPercent: 100,
        blockedCount: 0,
        container: saved?.container ?? null,
        group: saved?.group ?? null,
        workspace: saved?.workspace ?? this.workspaceId
      },
      view: null,
      saved,
      lastActiveAt: saved?.lastActiveAt ?? Date.now()
    }
    this.tabs.set(tab.state.id, tab)
    const index = afterId === undefined ? -1 : this.order.indexOf(afterId)
    if (index === -1) this.order.push(tab.state.id)
    else this.order.splice(index + 1, 0, tab.state.id)
    return tab
  }

  /** A window a page opened, shown as a tab beside it. Pages with `noopener` give us no window to adopt. */
  private adoptPopup(url: string, opener: TabState, options: BrowserWindowConstructorOptions): WebContents {
    const tab = this.addTab(url, null, opener.id)
    tab.state.container = opener.container
    tab.state.workspace = opener.workspace
    tab.openerId = opener.id
    const { webContents } = options as { webContents?: WebContents }
    this.wake(tab, webContents ? { webContents } : undefined)
    this.activate(tab.state.id)
    return tab.view!.webContents
  }

  private wake(tab: Tab, adopted?: { webContents: WebContents }): void {
    if (tab.view) return
    const partition = tab.state.container ? containerPartition(tab.state.container) : undefined
    if (partition) this.options.prepareSession(session.fromPartition(partition))
    const view = new WebContentsView({
      ...(adopted ?? {}),
      webPreferences: {
        partition,
        // Only exposes anything on sc:// pages; see preload/internal.ts.
        preload: join(__dirname, '../preload/internal.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        // Enables Chromium's built-in PDF viewer.
        plugins: true
      }
    })
    view.setBorderRadius(PAGE_RADIUS)
    view.setVisible(false)
    tab.view = view
    tab.state.isSleeping = false
    this.window.contentView.addChildView(view)
    this.wire(tab, view)
    this.options.onTabCreated(view.webContents)

    const { saved } = tab
    tab.saved = null
    const contents = view.webContents
    // A page asking to close its own window ends the tab, as it would for any window.
    if (tab.openerId !== undefined) {
      contents.on('close' as never, () => {
        if (tab.view?.webContents === contents && !this.window.isDestroyed()) this.close(tab.state.id)
      })
    }
    // Chromium is already loading a window it made for a page.
    if (adopted) return
    const page = this.pageFor(contents, tab.state.url)
    if (saved && saved.entries.length > 0 && page === tab.state.url) {
      contents.navigationHistory
        .restore({ index: saved.entryIndex, entries: saved.entries })
        .catch(() => contents.loadURL(saved.url).catch(() => undefined))
    } else {
      contents.loadURL(page).catch(() => undefined)
    }
  }

  private destroyView(tab: Tab): void {
    if (!tab.view) return
    // The window itself may already be gone when everything shuts down.
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    tab.view = null
  }

  private toSaved(tab: Tab): SavedTab {
    if (tab.saved) return tab.saved
    const { url, title, faviconUrl } = tab.state
    const contents = tab.view?.webContents
    const history = contents?.navigationHistory
    const all = history?.getAllEntries() ?? []
    const entries = all.filter((e) => isSavable(e.url)).map((e) => ({ url: effectiveUrl(e.url), title: e.title }))
    const entryIndex = Math.max(0, Math.min(entries.length - 1, history?.getActiveIndex() ?? 0))
    return {
      url: effectiveUrl(url),
      title,
      faviconUrl,
      entries: entries.length === all.length ? entries : [],
      entryIndex,
      container: tab.state.container,
      group: tab.state.group,
      workspace: tab.state.workspace,
      lastActiveAt: tab.lastActiveAt
    }
  }

  private wire(tab: Tab, view: WebContentsView): void {
    const { state } = tab
    const contents = view.webContents
    const sync = (patch: Partial<TabState> = {}) => {
      if (contents.isDestroyed()) return
      Object.assign(state, patch, {
        url: this.shownUrl(contents, patch.url || contents.getURL() || state.url),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward()
      })
      this.emitChange()
    }

    contents.on('did-start-loading', () => sync({ isLoading: true }))
    contents.on('did-stop-loading', () => {
      sync({ isLoading: false })
      if (state.id === this.activeId && isNewTabUrl(state.url)) this.options.onNewTabLoaded()
    })
    // In split view the active tab is whichever side the person is using.
    contents.on('focus', () => {
      if (this.split?.includes(state.id) && this.activeId !== state.id) {
        this.activeId = state.id
        this.emitChange()
      }
    })
    // Counted from the start: news of the page committing can arrive after its trackers were blocked.
    contents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) sync({ blockedCount: 0 })
    })
    contents.on('did-navigate', (_e, url) => {
      if (remembersZoom(url)) contents.setZoomFactor(this.options.zoomFor(url))
      sync({ url, faviconUrl: null, zoomPercent: Math.round(contents.getZoomFactor() * 100) })
      this.options.onVisit(url)
    })
    contents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      sync({ url })
      this.options.onVisit(url)
    })
    contents.on('page-title-updated', (_e, title) => {
      sync({ title })
      this.options.onTitle(state.url, title)
    })
    contents.on('page-favicon-updated', (_e, favicons) => {
      sync({ faviconUrl: favicons[0] ?? null })
      if (favicons[0]) this.options.onFavicon(contents, state.url, favicons[0])
    })
    contents.on('found-in-page', (_e, result) =>
      this.options.onFound({ active: result.activeMatchOrdinal, total: result.matches })
    )
    contents.on('zoom-changed', (_e, direction) => this.zoomBy(state.id, direction === 'in' ? 1 : -1))

    contents.on('did-finish-load', () => this.options.onPageLoaded(contents))
    contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ABORTED && code !== BLOCKED_BY_CLIENT && !isInternal(url)) void contents.loadURL(this.options.errorUrl(url, description))
    })
    contents.on('render-process-gone', (_e, { reason }) => {
      if (reason === 'clean-exit') return
      void contents.loadURL(this.options.errorUrl(effectiveUrl(state.url), 'This page stopped working.')).catch(() => undefined)
    })

    contents.on('login', (event, details, info, respond) => {
      event.preventDefault()
      this.options.onLogin(contents, details, info, respond)
    })

    contents.on('enter-html-full-screen', () => this.setFullscreen(true))
    contents.on('leave-html-full-screen', () => this.setFullscreen(false))

    // Web pages must never reach sc:// pages, which have extra privileges.
    contents.on('will-navigate', (event) => {
      if (isInternal(event.url) && !isInternal(contents.getURL())) event.preventDefault()
    })
    contents.on('will-redirect', (event) => {
      if (isInternal(event.url)) event.preventDefault()
    })
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && isInternal(event.url)) event.preventDefault()
    })

    // Links with target=_blank and window.open land in a new tab next to their opener.
    contents.setWindowOpenHandler(({ url, disposition }) => {
      const opener = contents.getURL()
      const fromPage = /^(https?|chrome-extension):/i.test(opener)
      // Sign-in popups often start blank, and are sent on their way once they're open.
      const blank = url === '' || url === 'about:blank'
      // Chromium itself stops a site from opening extension pages that aren't meant for it.
      if (fromPage && disposition !== 'background-tab' && (blank || /^(https?|chrome-extension):/i.test(url))) {
        // The real window, rather than a fresh tab at the same address: sign-in popups report
        // back through window.opener, and have to be able to close themselves.
        return { action: 'allow', createWindow: (options) => this.adoptPopup(url || 'about:blank', state, options) }
      }
      // Addresses like these have no `origin` to compare, as far as `URL` is concerned.
      const sameExtension = /^chrome-extension:/i.test(url) && /^chrome-extension:/i.test(opener) && URL.canParse(url) && URL.canParse(opener) && new URL(url).host === new URL(opener).host
      const allowed = /^https?:/i.test(url) || (isInternal(url) && isInternal(opener)) || sameExtension
      if (allowed) this.create(url, { activate: disposition !== 'background-tab', afterId: state.id, container: state.container })
      return { action: 'deny' }
    })
  }

  private setFullscreen(fullscreen: boolean): void {
    this.fullscreen = fullscreen
    this.options.onFullscreen(fullscreen)
    this.applyBounds()
  }

  private emitChange(): void {
    if (this.changeQueued) return
    this.changeQueued = true
    queueMicrotask(() => {
      this.changeQueued = false
      this.options.onChange(this.snapshot())
    })
  }
}
