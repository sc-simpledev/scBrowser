import { join } from 'node:path'
import { session, WebContentsView, type BaseWindow, type Session, type WebContents } from 'electron'
import {
  containerPartition,
  effectiveUrl,
  ERROR_PAGE_URL,
  isNewTabUrl,
  isReaderUrl,
  NEW_TAB_URL,
  resolveOmniboxInput,
  type PageRect,
  type SearchEngine,
  type TabId,
  type TabState,
  type TabsSnapshot
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
}

interface Tab {
  state: TabState
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
  onPageLoaded: (contents: WebContents) => void
  onFound: (result: { active: number; total: number }) => void
  onFullscreen: (fullscreen: boolean) => void
  engine: () => SearchEngine
  /** Builds the error page address for a failed load. */
  errorUrl: (url: string, reason: string) => string
  /** Called before a session is first used, so it gets the same protections as the default one. */
  prepareSession: (session: Session) => void
}

const PAGE_RADIUS = 10
const SPLIT_GAP = 6
const CLOSED_TABS_LIMIT = 25
const ABORTED = -3
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

const isInternal = (url: string) => url.startsWith('sc:')
const isSavable = (url: string) => /^(https?|sc|file):/i.test(url)

export class TabManager {
  private readonly tabs = new Map<TabId, Tab>()
  private order: TabId[] = []
  private activeId: TabId | null = null
  private nextId = 1
  private pageRect: PageRect = { x: 0, y: 0, width: 0, height: 0 }
  private closed: SavedTab[] = []
  private changeQueued = false
  private fullscreen = false
  /** Left and right tabs while split view is on. */
  private split: [TabId, TabId] | null = null

  constructor(
    private readonly window: BaseWindow,
    private readonly options: TabManagerOptions
  ) {}

  create(
    url: string = NEW_TAB_URL,
    { activate = true, afterId, container = null }: { activate?: boolean; afterId?: TabId; container?: string | null } = {}
  ): TabId {
    const tab = this.addTab(url, null, afterId)
    tab.state.container = container
    this.wake(tab)
    if (activate || this.activeId === null) this.activate(tab.state.id)
    else this.emitChange()
    return tab.state.id
  }

  /** Adds saved tabs without loading them; only the one that gets activated wakes up. */
  restore(saved: SavedTab[], activeIndex: number): void {
    const ids = saved.map((tab) => this.addTab(tab.url, tab).state.id)
    const active = ids[activeIndex] ?? ids[0]
    if (active !== undefined) this.activate(active)
  }

  close(id: TabId): void {
    const tab = this.tabs.get(id)
    if (!tab) return

    if (this.split?.includes(id)) this.endSplit()
    const index = this.order.indexOf(id)
    this.order.splice(index, 1)
    this.tabs.delete(id)
    if (!isNewTabUrl(tab.state.url)) this.closed = [this.toSaved(tab), ...this.closed].slice(0, CLOSED_TABS_LIMIT)

    this.destroyView(tab)
    this.options.onTabClosed(id)

    if (this.activeId === id) {
      this.activeId = null
      // Like Firefox/Chrome: focus the tab to the right, else the one to the left.
      const next = this.order[index] ?? this.order[index - 1]
      if (next !== undefined) this.activate(next)
    }
    if (this.order.length === 0) this.create()
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
    for (const other of [...this.order]) if (other !== id) this.close(other)
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
    const tab = this.addTab(saved.url, saved, this.activeId ?? undefined)
    this.activate(tab.state.id)
  }

  move(id: TabId, index: number): void {
    const from = this.order.indexOf(id)
    if (from === -1) return
    this.order.splice(from, 1)
    this.order.splice(Math.max(0, Math.min(index, this.order.length)), 0, id)
    this.emitChange()
  }

  activate(id: TabId): void {
    const next = this.tabs.get(id)
    if (!next) return
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
    if (this.activeId === null || this.order.length < 2) return
    const next = this.order[(this.order.indexOf(this.activeId) + 1) % this.order.length]
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
    if (this.activeId === null || this.order.length < 2) return
    const index = this.order.indexOf(this.activeId)
    const nextIndex = (index + offset + this.order.length) % this.order.length
    this.activate(this.order[nextIndex]!)
  }

  /** Ctrl+1…8 picks a position; Ctrl+9 always picks the last tab. */
  activateIndex(position: number): void {
    const id = position >= 9 ? this.order.at(-1) : this.order[position - 1]
    if (id !== undefined) this.activate(id)
  }

  navigate(id: TabId, input: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.wake(tab)
    const contents = tab.view!.webContents
    void contents.loadURL(resolveOmniboxInput(input, this.options.engine()))
    contents.focus()
  }

  /** Opens an internal page, reusing a tab already showing it. */
  openInternal(url: string): void {
    const existing = this.order.find((id) => this.tabs.get(id)?.state.url.startsWith(url))
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

  setPageRect(rect: PageRect): void {
    this.pageRect = rect
    this.applyBounds()
  }

  get page(): PageRect {
    return this.pageRect
  }

  /** Re-fits the active tab: the page area normally, the whole window for fullscreen video. */
  applyBounds(): void {
    if (this.activeId === null) return
    const view = this.tabs.get(this.activeId)?.view
    if (!view) return
    const { width, height } = this.window.getContentBounds()
    const [left, right] = this.split ?? []
    if (this.split && !this.fullscreen) {
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
    view.setBounds(this.fullscreen ? { x: 0, y: 0, width, height } : this.pageRect)
    view.setBorderRadius(this.fullscreen ? 0 : PAGE_RADIUS)
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

  owns(contents: WebContents): boolean {
    return [...this.tabs.values()].some((tab) => tab.view?.webContents === contents)
  }

  tabIdFor(contents: WebContents): TabId | null {
    for (const tab of this.tabs.values()) if (tab.view?.webContents === contents) return tab.state.id
    return null
  }

  snapshot(): TabsSnapshot {
    return {
      tabs: this.order.map((id) => ({ ...this.tabs.get(id)!.state })),
      activeId: this.activeId,
      splitIds: this.split ? [...this.split] : []
    }
  }

  /** What to write to disk so the session can be restored. */
  session(): { tabs: SavedTab[]; activeIndex: number } {
    const tabs = this.order.map((id) => this.toSaved(this.tabs.get(id)!))
    return { tabs, activeIndex: this.activeId === null ? 0 : this.order.indexOf(this.activeId) }
  }

  /** Unloads background tabs idle for longer than `maxIdleMs`. */
  sleepIdle(maxIdleMs: number, now = Date.now()): void {
    for (const tab of this.tabs.values()) {
      if (tab.state.id === this.activeId || this.split?.includes(tab.state.id) || !tab.view || now - tab.lastActiveAt < maxIdleMs) continue
      const contents = tab.view.webContents
      if (contents.isLoading() || contents.isCurrentlyAudible() || contents.isDevToolsOpened()) continue
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
        group: saved?.group ?? null
      },
      view: null,
      saved,
      lastActiveAt: Date.now()
    }
    this.tabs.set(tab.state.id, tab)
    const index = afterId === undefined ? -1 : this.order.indexOf(afterId)
    if (index === -1) this.order.push(tab.state.id)
    else this.order.splice(index + 1, 0, tab.state.id)
    return tab
  }

  private wake(tab: Tab): void {
    if (tab.view) return
    const partition = tab.state.container ? containerPartition(tab.state.container) : undefined
    if (partition) this.options.prepareSession(session.fromPartition(partition))
    const view = new WebContentsView({
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
    if (saved && saved.entries.length > 0) {
      contents.navigationHistory
        .restore({ index: saved.entryIndex, entries: saved.entries })
        .catch(() => contents.loadURL(saved.url).catch(() => undefined))
    } else {
      contents.loadURL(tab.state.url).catch(() => undefined)
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
      group: tab.state.group
    }
  }

  private wire(tab: Tab, view: WebContentsView): void {
    const { state } = tab
    const contents = view.webContents
    const sync = (patch: Partial<TabState> = {}) => {
      if (contents.isDestroyed()) return
      Object.assign(state, patch, {
        url: patch.url || contents.getURL() || state.url,
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
    contents.on('did-navigate', (_e, url) => {
      sync({ url, faviconUrl: null, blockedCount: 0, zoomPercent: Math.round(contents.getZoomFactor() * 100) })
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
    contents.on('page-favicon-updated', (_e, favicons) => sync({ faviconUrl: favicons[0] ?? null }))
    contents.on('found-in-page', (_e, result) =>
      this.options.onFound({ active: result.activeMatchOrdinal, total: result.matches })
    )
    contents.on('zoom-changed', (_e, direction) => this.zoomBy(state.id, direction === 'in' ? 1 : -1))

    contents.on('did-finish-load', () => this.options.onPageLoaded(contents))
    contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ABORTED && !isInternal(url)) void contents.loadURL(this.options.errorUrl(url, description))
    })
    contents.on('render-process-gone', (_e, { reason }) => {
      if (reason === 'clean-exit') return
      void contents.loadURL(this.options.errorUrl(effectiveUrl(state.url), 'This page stopped working.')).catch(() => undefined)
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
      const allowed = /^https?:/i.test(url) || (isInternal(url) && isInternal(contents.getURL()))
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
