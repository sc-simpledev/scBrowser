import { join } from 'node:path'
import { session, WebContentsView, type AuthInfo, type AuthenticationResponseDetails, type BaseWindow, type Session, type WebContents, type BrowserWindowConstructorOptions } from 'electron'
import {
  containerPartition,
  DEFAULT_WORKSPACE,
  appScheme,
  effectiveUrl,
  clampSplitRatio,
  ERROR_PAGE_URL,
  isJavascriptUrl,
  isNewTabUrl,
  isReaderUrl,
  NEW_TAB_URL,
  resolveOmniboxInput,
  SPLIT_GAP,
  DEVTOOLS_BAR,
  SPLIT_RATIO,
  splitPanes,
  SPLIT_RADIUS,
  type CleanupInput,
  type PageRect,
  type SearchEngine,
  type TabId,
  type TabSearchRow,
  type TabState,
  type TabsSnapshot,
  type Workspace, PDF_PAGE_URL } from '@scbrowser/shared'
import { guardPreviewFrames, isPreviewUrl } from '../filePreview'
import { tabIcon } from '../siteIcons'

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
  pinned?: boolean
  muted?: boolean
}

interface Tab {
  state: TabState
  /** The tab whose page opened this one as a popup. */
  openerId?: TabId
  /** The side bar with developer tools in it, while they're open. */
  devTools?: WebContentsView
  /** Null while asleep: the page is unloaded and only `saved` remains. */
  view: WebContentsView | null
  saved: SavedTab | null
  lastActiveAt: number
}

interface TabManagerOptions {
  /** An installed site's window keeps to one page: everything else opens in the full browser. */
  otherWindow?: (url: string, container: string | null) => void
  /** The site an installed app's window belongs to. */
  appOrigin?: string
  /** Whether the window goes when its last tab does, rather than opening a new one. */
  closeWhenEmpty: () => boolean
  devToolsWidth: () => number
  /** Performance Mode: pages opened from now on wait for a press before playing sound or video. */
  quietMedia: () => boolean
  onDevToolsWidth: (width: number) => void
  /** The side bar's own contents, for shortcuts and for keeping popups above it. */
  onDevToolsCreated: (contents: WebContents) => void
  /** Called (coalesced per tick) whenever any tab or the active tab changes. */
  onChange: (snapshot: TabsSnapshot) => void
  /** Lets the caller hook keyboard shortcuts and other per-tab behaviour. */
  onTabCreated: (contents: WebContents) => void
  onTabClosed: (id: TabId) => void
  onActivate: (tab: TabState) => void
  /** Split view has started. */
  onSplit?: () => void
  /** The new tab page finished loading, which pulls keyboard focus into it. */
  onNewTabLoaded: () => void
  /** A tab committed a navigation (including same-document ones). */
  onVisit: (url: string) => void
  onTitle: (url: string, title: string) => void
  onFavicon: (contents: WebContents, pageUrl: string, iconUrl: string) => void
  onPageLoaded: (contents: WebContents) => void
  /** As soon as the page's document is ready, before its pictures have loaded. */
  onDomReady?: (contents: WebContents) => void
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
  /** A page's `window.open` or `target=_blank` link goes to another app. */
  onAppLink: (contents: WebContents, url: string, requester: string) => void
  /** A Shift-clicked link, to show over the page instead of in a new window. False lets it open as usual. */
  onPreviewLink?: (url: string, session: Session, container: string | null) => boolean
  /** The page area moved or changed size. */
  onPageRect?: (rect: PageRect) => void
  /** A sidebar is being dragged, so other native views step aside too. */
  onResizing?: (resizing: boolean) => void
}

const PAGE_RADIUS = 0
/** Developer tools never squeeze the page below this, and have the same limit themselves. */
const MIN_DOCKED = 240
/** Unique across windows, as things like the assistant find tabs by id alone. */
let nextTabId = 1
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

/** More page loads than this in a tab, inside the window below and with nobody asking, is a page reloading itself without end. */
export const RELOAD_LOOP_LIMIT = 8
export const RELOAD_LOOP_WINDOW_MS = 12_000

/** Records a load the page started by itself, and says whether the tab is now stuck in a loop. */
export function countSelfLoad(times: number[], now = Date.now()): { times: number[]; looping: boolean } {
  const recent = [...times.filter((at) => now - at < RELOAD_LOOP_WINDOW_MS), now]
  return { times: recent, looping: recent.length > RELOAD_LOOP_LIMIT }
}

export class TabManager {
  private readonly blockedHosts = new Map<TabId, Map<string, number>>()
  private readonly tabs = new Map<TabId, Tab>()
  private order: TabId[] = []
  private activeId: TabId | null = null
  private pageRect: PageRect = { x: 0, y: 0, width: 0, height: 0 }
  private resizing = false
  private closed: SavedTab[] = []
  private changeQueued = false
  private fullscreen = false
  /** Left and right tabs while split view is on. */
  private split: [TabId, TabId] | null = null
  private splitRatio = SPLIT_RATIO.standard
  /** This tab covers the whole window, for the first-run intro. */
  private immersiveId: TabId | null = null
  private workspaces: Workspace[]
  private workspaceId: string = DEFAULT_WORKSPACE.id
  private readonly lastInWorkspace = new Map<string, TabId>()
  /** Page loads since the person last navigated the tab themselves, to catch pages that reload without end. */
  private readonly selfLoads = new WeakMap<WebContents, number[]>()

  constructor(
    private readonly window: BaseWindow,
    private readonly options: TabManagerOptions,
    workspaces: Workspace[] = [DEFAULT_WORKSPACE]
  ) {
    this.workspaces = workspaces
  }

  /** Tabs with their page, as a person can see them. */
  taskInfo(): { contents: WebContents; title: string; url: string }[] {
    return [...this.tabs.values()].flatMap(({ view, state }) => (view && !view.webContents.isDestroyed() ? [{ contents: view.webContents, title: state.title, url: state.url }] : []))
  }

  sleepingCount(): number {
    return [...this.tabs.values()].filter((tab) => !tab.view).length
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
      return tab.state.pinned || (isInternal(url) && !isNewTabUrl(url)) ? [] : [{ id, url, title: tab.state.title, lastActiveAt: tab.lastActiveAt }]
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
    if (this.options.otherWindow && this.order.length > 0) {
      this.options.otherWindow(url, container)
      return this.activeId!
    }
    // Only the browser's own controls may run a script, through `openAddress` in window.ts.
    // Previews only ever run inside the assistant's frame, never as a page of their own.
    const tab = this.addTab(isJavascriptUrl(url) || isPreviewUrl(url) ? NEW_TAB_URL : url, null, afterId)
    tab.state.container = container
    tab.state.workspace = this.workspaceId
    this.wake(tab)
    if (activate || this.activeId === null) this.activate(tab.state.id)
    else this.emitChange()
    return tab.state.id
  }

  /** Adds saved tabs without loading them; only the one that gets activated wakes up. */
  restore(saved: SavedTab[], activeIndex: number, split: [number, number] | null = null, splitRatio?: number): void {
    if (splitRatio) this.splitRatio = clampSplitRatio(splitRatio)
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
    if (this.order.length === 0 && this.options.closeWhenEmpty()) {
      this.window.close()
      return
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
        // Pinned tabs stay where they were put.
        if (tab && !tab.state.pinned) tab.state.group = name
        return !!tab && !tab.state.pinned
      })
    )
    this.order = [...grouped, ...this.order.filter((id) => !grouped.includes(id))]
    this.settlePinned()
    this.emitChange()
  }

  clearGroups(): void {
    for (const tab of this.tabs.values()) tab.state.group = null
    this.emitChange()
  }

  /** Group names in this workspace, in the order they appear. */
  groupNames(): string[] {
    return [...new Set(this.visible.map((id) => this.tabs.get(id)?.state.group).filter((name): name is string => !!name))]
  }

  /** A name not already taken, like "Group 2". */
  freshGroupName(): string {
    const taken = new Set(this.groupNames())
    let number = 1
    while (taken.has(`Group ${number}`)) number++
    return `Group ${number}`
  }

  /**
   * Puts tabs in a group, or takes them out with null. Joining a group that already has tabs
   * moves them to its end, so a group's tabs always sit together.
   */
  setGroup(ids: TabId[], name: string | null): void {
    const clean = name?.trim().slice(0, 60) || null
    const moving = ids.filter((id) => {
      const tab = this.tabs.get(id)
      return !!tab && !tab.state.pinned
    })
    if (moving.length === 0) return
    for (const id of moving) this.tabs.get(id)!.state.group = clean
    if (clean) {
      const rest = this.order.filter((id) => !moving.includes(id))
      const last = rest.findLastIndex((id) => this.tabs.get(id)?.state.group === clean)
      // A new group starts where its first tab was; an existing one takes them at its end.
      const first = Math.min(...moving.map((id) => this.order.indexOf(id)))
      const at = last === -1 ? this.order.slice(0, first).filter((id) => !moving.includes(id)).length : last + 1
      rest.splice(at, 0, ...moving)
      this.order = rest
    } else {
      // Leaving a group puts the tab just after it, so the group stays together.
      for (const id of moving) {
        const index = this.order.indexOf(id)
        const groupName = this.tabs.get(this.order[index - 1] ?? -1)?.state.group
        if (!groupName) continue
        this.order.splice(index, 1)
        const end = this.order.findLastIndex((other) => this.tabs.get(other)?.state.group === groupName)
        this.order.splice(end + 1, 0, id)
      }
    }
    this.settlePinned()
    this.emitChange()
  }

  renameGroup(from: string, to: string): void {
    const name = to.trim().slice(0, 60)
    if (!name || name === from) return
    for (const id of this.visible) {
      const tab = this.tabs.get(id)!
      if (tab.state.group === from) tab.state.group = name
    }
    this.emitChange()
  }

  ungroup(name: string): void {
    for (const id of this.visible) {
      const tab = this.tabs.get(id)!
      if (tab.state.group === name) tab.state.group = null
    }
    this.emitChange()
  }

  /** Returns what the group held, so it can be kept and opened again. */
  /** Every web page open in this workspace, to save as a named set. */
  openTabList(): { url: string; title: string; container: string | null }[] {
    return this.visible.flatMap((id) => {
      const tab = this.tabs.get(id)
      const url = tab && effectiveUrl(tab.state.url)
      return tab && url && /^(https?|file):/i.test(url) ? [{ url, title: tab.state.title || tab.saved?.title || '', container: tab.state.container }] : []
    })
  }

  closeGroup(name: string): { url: string; title: string; container: string | null }[] {
    const ids = this.visible.filter((other) => this.tabs.get(other)?.state.group === name)
    const kept = ids.flatMap((id) => {
      const tab = this.tabs.get(id)
      return tab ? [{ url: effectiveUrl(tab.state.url), title: tab.state.title || tab.saved?.title || '', container: tab.state.container ?? null }] : []
    })
    for (const id of ids) this.close(id)
    return kept
  }

  /** A closed group's tabs, back together under its name (or a fresh one if that's taken), sleeping until looked at. */
  openGroup(name: string, saved: { url: string; title: string; container: string | null }[]): void {
    if (saved.length === 0) return
    const taken = this.groupNames()
    let group = name
    for (let n = 2; taken.includes(group); n++) group = `${name} ${n}`
    let after = this.visible.at(-1)
    const ids: TabId[] = []
    for (const tab of saved) {
      const opened = this.addTab(tab.url, { url: tab.url, title: tab.title, container: tab.container, workspace: this.workspaceId, group, faviconUrl: null, entries: [{ url: tab.url, title: tab.title }], entryIndex: 0 }, after)
      ids.push(opened.state.id)
      after = opened.state.id
    }
    this.activate(ids[0]!)
    this.emitChange()
  }

  /**
   * Puts one tab to sleep now, freeing its memory. The open tab hands over to a neighbour first,
   * and the last tab left can't sleep.
   */
  sleep(id: TabId): boolean {
    const tab = this.tabs.get(id)
    if (!tab?.view || tab.devTools) return false
    if (this.activeId === id || this.split?.includes(id)) {
      const visible = this.visible
      const index = visible.indexOf(id)
      const next = visible[index + 1] ?? visible[index - 1]
      if (next === undefined) return false
      if (this.split) this.endSplit()
      this.activate(next)
    }
    tab.lastActiveAt = Date.now()
    tab.saved = this.toSaved(tab)
    this.destroyView(tab)
    tab.state.isSleeping = true
    tab.state.isLoading = false
    tab.state.audible = false
    this.emitChange()
    return true
  }

  /** Pinned tabs stay, as they're the ones someone chose to keep. */
  closeOthers(id: TabId): void {
    for (const other of this.visible) if (other !== id && !this.tabs.get(other)?.state.pinned) this.close(other)
  }

  setPinned(id: TabId, pinned: boolean): void {
    const tab = this.tabs.get(id)
    if (!tab || tab.state.pinned === pinned) return
    tab.state.pinned = pinned
    if (pinned) {
      tab.state.group = null
      // Joins the end of the pinned tabs rather than wherever it was.
      this.order.splice(this.order.indexOf(id), 1)
      const lastPinned = this.order.findLastIndex((other) => this.tabs.get(other)?.state.pinned)
      this.order.splice(lastPinned + 1, 0, id)
    } else {
      this.settlePinned()
    }
    this.emitChange()
  }

  setMuted(id: TabId, muted: boolean): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.state.muted = muted
    tab.view?.webContents.setAudioMuted(muted)
    this.emitChange()
  }

  /** Every tab, in any workspace, for tab search. */
  searchRows(): TabSearchRow[] {
    return this.order.flatMap((id) => {
      const tab = this.tabs.get(id)
      if (!tab) return []
      const { title, url, faviconUrl, isLoading, pinned, audible, muted, workspace } = tab.state
      return [{
        id,
        title: title || (isNewTabUrl(url) ? 'New tab' : url),
        url: effectiveUrl(url),
        faviconUrl,
        isLoading,
        pinned,
        audible,
        muted,
        workspaceName: workspace === this.workspaceId ? null : (this.workspaces.find((w) => w.id === workspace)?.name ?? null),
        lastActiveAt: id === this.activeId ? Date.now() : tab.lastActiveAt
      }]
    })
  }

  /** Goes to a tab that may be in another workspace, which switches properly on the way. */
  reveal(id: TabId): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.switchWorkspace(tab.state.workspace)
    this.activate(id)
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
    this.settlePinned()
    this.emitChange()
  }

  activate(id: TabId): void {
    const next = this.tabs.get(id)
    if (!next) return
    // A drag whose release got lost mustn't leave every tab unable to take its place.
    if (this.resizing) this.setResizing(false)
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
    this.options.onSplit?.()
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

  /** Puts the two sides of split view the other way round. */
  swapSplit(): void {
    if (!this.split) return
    this.split = [this.split[1], this.split[0]]
    this.applyBounds()
    this.emitChange()
  }

  /** Ends split view, keeping this side open. */
  keepSplitSide(id: TabId): void {
    if (!this.split?.includes(id)) return
    if (id !== this.activeId) this.activate(id)
    this.endSplit()
  }

  setSplitRatio(ratio: number): void {
    this.splitRatio = clampSplitRatio(ratio)
    this.applyBounds()
    this.emitChange()
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
    // Only the browser's own controls may run a script, through `openAddress` in window.ts.
    if (isJavascriptUrl(input) || isPreviewUrl(input.trim())) return
    this.wake(tab)
    const contents = tab.view!.webContents
    this.selfLoads.delete(contents)
    void contents.loadURL(this.pageFor(contents, resolveOmniboxInput(input, this.options.engine())))
    contents.focus()
  }

  /** Goes to a page of the browser's own, reusing its tab if one is open. A #fragment picks a part of it, like sc://settings/#privacy. */
  openInternal(url: string): void {
    const page = url.split('#')[0]!
    const existing = this.visible.find((id) => this.tabs.get(id)?.state.url.startsWith(page))
    if (existing !== undefined) {
      this.activate(existing)
      if (url.includes('#') && this.tabs.get(existing)?.state.url !== url) this.navigate(existing, url)
    }
    else if (this.active && isNewTabUrl(this.active.url)) this.navigate(this.active.id, url)
    else this.create(url, { afterId: this.activeId ?? undefined })
  }

  back(id: TabId): void {
    this.personNavigated(id)
    this.contents(id)?.navigationHistory.goBack()
  }

  forward(id: TabId): void {
    this.personNavigated(id)
    this.contents(id)?.navigationHistory.goForward()
  }

  private personNavigated(id: TabId): void {
    const contents = this.contents(id)
    if (contents) this.selfLoads.delete(contents)
  }

  reload(id: TabId, ignoreCache = false): void {
    // A sleeping tab has nothing to reload, so its menu's Reload wakes it instead.
    const sleeping = this.tabs.get(id)
    if (sleeping && !sleeping.view) {
      this.wake(sleeping)
      this.emitChange()
      return
    }
    this.personNavigated(id)
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

  /** Docked beside the page, in a view of its own. Electron's docking only works for full windows. */
  toggleDevTools(id: TabId): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.devTools) {
      tab.view?.webContents.closeDevTools()
      // Electron's `devtools-closed` can take a long time to come with a view of our own, so this doesn't wait.
      this.removeDevTools(tab, tab.devTools)
    } else {
      this.openDevTools(tab)
    }
    this.applyBounds()
    this.emitChange()
  }

  /** The page menu's Inspect. Views that aren't tabs, such as a side panel, use Chromium's own window. */
  inspect(contents: WebContents, x: number, y: number): void {
    const id = this.tabIdFor(contents)
    const tab = id === null ? undefined : this.tabs.get(id)
    if (tab && !tab.devTools) {
      this.openDevTools(tab)
      this.applyBounds()
      this.emitChange()
    }
    contents.inspectElement(x, y)
  }

  setDevToolsWidth(width: number): void {
    this.options.onDevToolsWidth(Math.max(MIN_DOCKED, Math.round(width)))
    this.applyBounds()
    this.emitChange()
  }

  private openDevTools(tab: Tab): void {
    const contents = tab.view?.webContents
    if (!contents) return
    const tools = new WebContentsView()
    tools.setVisible(false)
    tab.devTools = tools
    this.window.contentView.addChildView(tools)
    this.options.onDevToolsCreated(tools.webContents)
    // Has to be set before it opens, on contents that haven't been anywhere yet.
    contents.setDevToolsWebContents(tools.webContents)
    // Their own close button ends their contents.
    tools.webContents.once('destroyed', () => this.removeDevTools(tab, tools))
    contents.once('devtools-closed', () => this.removeDevTools(tab, tools))
    // DevTools' own windows (the device toolbar's frame, popups from the console) never become windows here.
    tools.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // 'detach' tells DevTools it can't dock. Docked, it moves the device toolbar into a second
    // frame that Electron can only show as a separate window, and its close button reaches no window.
    // Undocked, the device toolbar emulates inside the page itself, so the viewport works.
    contents.openDevTools({ mode: 'detach', activate: true })
  }

  /** The close button on the bar above them. */
  closeShownDevTools(): void {
    const ids = [this.activeId, ...(this.split ?? [])]
    for (const id of ids) {
      if (id !== null && this.tabs.get(id)?.devTools) return this.toggleDevTools(id)
    }
  }

  private removeDevTools(tab: Tab, tools: WebContentsView): void {
    if (tab.devTools !== tools) return
    tab.devTools = undefined
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tools)
    const contents = tools.webContents as WebContents | undefined
    if (contents && !contents.isDestroyed()) contents.close()
    if (this.window.isDestroyed()) return
    this.applyBounds()
    this.emitChange()
  }

  /** The open tab's developer tools, or the other split tab's if only it has them. */
  private shownDevTools(): WebContentsView | undefined {
    const ids = [this.activeId, ...(this.split ?? [])]
    for (const id of ids) {
      const tools = id === null ? undefined : this.tabs.get(id)?.devTools
      if (tools) return tools
    }
    return undefined
  }

  /** How wide they're drawn, which takes the room from the page. */
  private dockedWidth(): number {
    if (!this.shownDevTools() || this.fullscreen || this.immersiveId === this.activeId) return 0
    return Math.max(MIN_DOCKED, Math.min(this.options.devToolsWidth(), this.pageRect.width - MIN_DOCKED - SPLIT_GAP))
  }

  /** The PDF viewer opens its own print box; everything else gets the system's. */
  print(id: TabId): void {
    const contents = this.contents(id)
    if (!contents) return
    if (contents.getURL().startsWith(PDF_PAGE_URL)) void contents.executeJavaScript("window.dispatchEvent(new Event('scb-print'))").catch(() => undefined)
    else contents.print()
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
    this.shownDevTools()?.setVisible(!resizing)
    this.applyBounds()
    this.options.onResizing?.(resizing)
  }

  setPageRect(rect: PageRect): void {
    this.pageRect = rect
    this.applyBounds()
    this.options.onPageRect?.(rect)
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
    const shownTools = covers ? undefined : this.shownDevTools()
    for (const tab of this.tabs.values()) if (tab.devTools && tab.devTools !== shownTools) tab.devTools.setVisible(false)
    const docked = this.dockedWidth()
    const area = { ...this.pageRect, width: Math.max(0, this.pageRect.width - (docked > 0 ? docked + SPLIT_GAP : 0)) }
    if (shownTools) {
      shownTools.setBounds({
        x: area.x + area.width + SPLIT_GAP,
        y: this.pageRect.y + DEVTOOLS_BAR,
        width: docked,
        height: Math.max(0, this.pageRect.height - DEVTOOLS_BAR)
      })
      shownTools.setVisible(true)
    }
    if (this.split && !covers) {
      // Each page sits in a card the browser UI draws round it (PageSlot), so it takes the card's curve.
      const panes = splitPanes(area, this.splitRatio)
      for (const [id, pane] of [
        [left!, panes[0]],
        [right!, panes[1]]
      ] as const) {
        const side = this.tabs.get(id)?.view
        side?.setVisible(true)
        side?.setBounds(pane.page)
        side?.setBorderRadius(SPLIT_RADIUS - 1)
      }
      return
    }
    // Fullscreen video covers the window, so the other half of a split steps aside.
    if (this.split) this.tabs.get(left === this.activeId ? right! : left!)?.view?.setVisible(false)
    view.setBounds(covers ? { x: 0, y: 0, width, height } : area)
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

  /** What was blocked on a tab's current page, most first. */
  blockedHostsOf(id: TabId): { host: string; count: number }[] {
    return [...(this.blockedHosts.get(id) ?? [])].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
  }

  noteBlocked(webContentsId: number, url?: string): void {
    for (const [id, tab] of this.tabs) {
      if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === webContentsId) {
        tab.state.blockedCount++
        if (url && URL.canParse(url)) {
          const hosts = this.blockedHosts.get(id) ?? new Map<string, number>()
          const { host } = new URL(url)
          hosts.set(host, (hosts.get(host) ?? 0) + 1)
          this.blockedHosts.set(id, hosts)
        }
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

  /** Where a shown tab's page is drawn in the window, or null when it isn't showing. */
  shownBounds(contents: WebContents): PageRect | null {
    const id = this.tabIdFor(contents)
    const view = id === null ? undefined : this.tabs.get(id)?.view
    if (!view || !view.getVisible() || (id !== this.activeId && !this.split?.includes(id!))) return null
    return view.getBounds()
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
      splitRatio: this.splitRatio,
      devToolsWidth: this.dockedWidth(),
      workspaces: this.workspaces,
      activeWorkspace: this.workspaceId
    }
  }

  /** What to write to disk so the session can be restored. */
  session(): { tabs: SavedTab[]; activeIndex: number; split: [number, number] | null; splitRatio: number } {
    const kept = this.order.filter((id) => !isIntro(this.tabs.get(id)!.state.url))
    const left = this.split ? kept.indexOf(this.split[0]) : -1
    const right = this.split ? kept.indexOf(this.split[1]) : -1
    return {
      tabs: kept.map((id) => this.toSaved(this.tabs.get(id)!)),
      activeIndex: this.activeId === null ? 0 : Math.max(0, kept.indexOf(this.activeId)),
      split: left === -1 || right === -1 ? null : [left, right],
      splitRatio: this.splitRatio
    }
  }

  /** Unloads background tabs idle for longer than `maxIdleMs`. */
  sleepIdle(maxIdleMs: number, now = Date.now()): void {
    for (const tab of this.sleepable(maxIdleMs, now)) this.putToSleep(tab)
  }

  /**
   * The memory saver: when the computer runs short of memory, the background tabs looked at longest
   * ago sleep first, `count` at most. Returns how many went to sleep.
   */
  sleepOldest(count: number, minIdleMs: number, now = Date.now()): number {
    const oldest = this.sleepable(minIdleMs, now)
      .toSorted((a, b) => a.lastActiveAt - b.lastActiveAt)
      .slice(0, count)
    for (const tab of oldest) this.putToSleep(tab)
    return oldest.length
  }

  /** Background tabs that are awake and can sleep without losing anything that's going on. */
  private sleepable(minIdleMs: number, now: number): Tab[] {
    return [...this.tabs.values()].filter((tab) => {
      if (tab.state.id === this.activeId || this.split?.includes(tab.state.id) || !tab.view || now - tab.lastActiveAt < minIdleMs) return false
      const contents = tab.view.webContents
      if (contents.isLoading() || contents.isCurrentlyAudible() || tab.devTools) return false
      // Sleeping would cut the link between a popup and its opener, which may be mid sign-in.
      const inPopupPair = (tab.openerId !== undefined && this.tabs.get(tab.openerId)?.view) || [...this.tabs.values()].some((other) => other.openerId === tab.state.id && other.view)
      return !inPopupPair
    })
  }

  private putToSleep(tab: Tab): void {
    tab.saved = this.toSaved(tab)
    this.destroyView(tab)
    tab.state.isSleeping = true
    this.emitChange()
  }

  /**
   * Closes tabs unused for longer than `maxIdleMs`, for the archive. Leaves pinned, playing and
   * showing tabs, scTerra's own pages, popup pairs, and always at least one tab. Returns what closed.
   */
  archiveIdle(maxIdleMs: number, now = Date.now()): (SavedTab & { lastActiveAt: number })[] {
    const archived: (SavedTab & { lastActiveAt: number })[] = []
    for (const tab of [...this.tabs.values()]) {
      if (this.tabs.size <= 1) break
      const { state } = tab
      if (state.id === this.activeId || this.split?.includes(state.id) || state.pinned || state.audible || now - tab.lastActiveAt < maxIdleMs) continue
      const url = effectiveUrl(state.url)
      if (!/^(https?|file):/i.test(url) || tab.devTools) continue
      const inPopupPair = tab.openerId !== undefined || [...this.tabs.values()].some((other) => other.openerId === state.id)
      if (inPopupPair) continue
      archived.push({ ...this.toSaved(tab), lastActiveAt: tab.lastActiveAt })
      this.close(state.id)
    }
    return archived
  }

  /** Loads a sleeping tab without showing it, so its page can be read. Waits up to 15 seconds for it. */
  async wakeInBackground(id: TabId): Promise<WebContents | undefined> {
    const tab = this.tabs.get(id)
    if (!tab) return undefined
    if (!tab.view) {
      this.wake(tab)
      tab.lastActiveAt = Date.now()
      this.emitChange()
    }
    const contents = tab.view?.webContents
    if (contents?.isLoading()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 15_000)
        contents.once('did-stop-loading', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    return contents && !contents.isDestroyed() ? contents : undefined
  }

  /** One tab, by hand. Null if it can't go, as with the last tab or an sc:// page. */
  archiveTab(id: TabId): (SavedTab & { lastActiveAt: number }) | null {
    const tab = this.tabs.get(id)
    if (!tab || this.tabs.size <= 1 || !/^(https?|file):/i.test(effectiveUrl(tab.state.url))) return null
    const saved = { ...this.toSaved(tab), lastActiveAt: tab.lastActiveAt }
    this.close(id)
    return saved
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
        id: nextTabId++,
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
        workspace: saved?.workspace ?? this.workspaceId,
        pinned: saved?.pinned ?? false,
        audible: false,
        muted: saved?.muted ?? false
      },
      view: null,
      saved,
      lastActiveAt: saved?.lastActiveAt ?? Date.now()
    }
    this.tabs.set(tab.state.id, tab)
    const index = afterId === undefined ? -1 : this.order.indexOf(afterId)
    if (index === -1) this.order.push(tab.state.id)
    else this.order.splice(index + 1, 0, tab.state.id)
    this.settlePinned()
    return tab
  }

  /** Pinned tabs come first in every workspace, however the order changed. Otherwise it's left alone. */
  private settlePinned(): void {
    const isPinned = (id: TabId) => !!this.tabs.get(id)?.state.pinned
    this.order = [...this.order.filter(isPinned), ...this.order.filter((id) => !isPinned(id))]
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
        plugins: true,
        ...(this.options.quietMedia() ? { autoplayPolicy: 'document-user-activation-required' as const } : {})
      }
    })
    view.setBorderRadius(PAGE_RADIUS)
    view.setVisible(false)
    tab.view = view
    tab.state.isSleeping = false
    this.window.contentView.addChildView(view)
    this.wire(tab, view)
    if (tab.state.muted) view.webContents.setAudioMuted(true)
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
    if (tab.devTools) this.removeDevTools(tab, tab.devTools)
    if (!tab.view) return
    // The window itself may already be gone when everything shuts down.
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    tab.view = null
    tab.state.audible = false
  }

  private toSaved(tab: Tab): SavedTab {
    // What was saved when it fell asleep has the page, but a tab can be pinned or moved in its sleep.
    if (tab.saved) {
      const { container, group, workspace, pinned, muted } = tab.state
      return { ...tab.saved, container, group, workspace, pinned, muted, lastActiveAt: tab.lastActiveAt }
    }
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
      lastActiveAt: tab.lastActiveAt,
      pinned: tab.state.pinned,
      muted: tab.state.muted
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
    contents.on('did-start-navigation', ({ isMainFrame, isSameDocument, url }) => {
      if (!isMainFrame || isSameDocument) return
      sync({ blockedCount: 0 })
      this.blockedHosts.delete(tab.state.id)
      if (!/^https?:/i.test(url)) return
      // A page that keeps reloading itself (a sign-in or consent loop, or a script that never settles)
      // would otherwise spin forever and take the processor with it.
      const { times, looping } = countSelfLoad(this.selfLoads.get(contents) ?? [])
      this.selfLoads.set(contents, looping ? [] : times)
      if (!looping) return
      // Not from inside Chromium's own navigation event, which crashes if a new load starts there.
      setTimeout(() => {
        if (contents.isDestroyed()) return
        contents.stop()
        void contents.loadURL(this.options.errorUrl(url, 'This page kept reloading itself, so scTerra stopped it. Try again, or turn off tracker blocking or cookie banner rejection for this site in its site controls.')).catch(() => undefined)
      }, 0)
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
      const pageUrl = state.url
      const wanted = favicons.find((icon) => /^(https?|data):/i.test(icon)) ?? favicons[0] ?? ''
      if (wanted) this.options.onFavicon(contents, pageUrl, wanted)
      // Fetched by the main process through the tab's session, then shown as a data address.
      void tabIcon(contents.session, wanted, pageUrl).then((icon) => {
        if (!contents.isDestroyed() && state.url === pageUrl) sync({ faviconUrl: icon ?? (wanted || null) })
      })
    })
    // Pages that name no icon at all still usually have /favicon.ico.
    contents.on('did-finish-load', () => {
      const pageUrl = state.url
      if (state.faviconUrl || !/^https?:/.test(pageUrl)) return
      void tabIcon(contents.session, '', pageUrl).then((icon) => {
        if (icon && !contents.isDestroyed() && state.url === pageUrl && !state.faviconUrl) sync({ faviconUrl: icon })
      })
    })
    contents.on('found-in-page', (_e, result) =>
      this.options.onFound({ active: result.activeMatchOrdinal, total: result.matches })
    )
    contents.on('audio-state-changed', ({ audible }) => sync({ audible }))
    contents.on('zoom-changed', (_e, direction) => this.zoomBy(state.id, direction === 'in' ? 1 : -1))

    contents.on('dom-ready', () => this.options.onDomReady?.(contents))
    contents.on('did-finish-load', () => this.options.onPageLoaded(contents))
    contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ABORTED && code !== BLOCKED_BY_CLIENT && !isInternal(url)) void contents.loadURL(this.options.errorUrl(url, description))
    })
    contents.on('render-process-gone', (_e, { reason }) => {
      if (reason === 'clean-exit') return
      // A page that died sends no more news, and would keep its spinner and sound icon.
      sync({ isLoading: false, audible: false })
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
      if ((isInternal(event.url) && !isInternal(contents.getURL())) || isPreviewUrl(event.url)) event.preventDefault()
    })
    contents.on('will-redirect', (event) => {
      if (isInternal(event.url) || isPreviewUrl(event.url)) event.preventDefault()
    })
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && isInternal(event.url)) event.preventDefault()
      // Only scTerra's own pages may show a preview, and the preview can't leave.
      else if (!event.isMainFrame && isPreviewUrl(event.url) && !isInternal(contents.getURL())) event.preventDefault()
      else guardPreviewFrames(event)
    })

    // Links with target=_blank and window.open land in a new tab next to their opener.
    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      const opener = contents.getURL()
      const fromPage = /^(https?|chrome-extension):/i.test(opener)
      // Shift-clicking a link asks for a new window with no features, which a script's popup always sets.
      if (disposition === 'new-window' && !features && /^https?:/i.test(opener) && /^https?:/i.test(url) && this.options.onPreviewLink?.(url, contents.session, state.container ?? null)) {
        return { action: 'deny' }
      }
      // Sign-in popups often start blank, and are sent on their way once they're open.
      const blank = url === '' || url === 'about:blank'
      // Chromium itself stops a site from opening extension pages that aren't meant for it.
      // An installed site's own popups stay with it, while links out go to the full browser.
      const leavesApp = !!this.options.appOrigin && !blank && !(URL.canParse(url) && new URL(url).origin === this.options.appOrigin)
      if (fromPage && !leavesApp && disposition !== 'background-tab' && (blank || /^(https?|chrome-extension):/i.test(url))) {
        // The real window, rather than a fresh tab at the same address: sign-in popups report
        // back through window.opener, and have to be able to close themselves.
        return { action: 'allow', createWindow: (options) => this.adoptPopup(url || 'about:blank', state, options) }
      }
      // Addresses like these have no `origin` to compare, as far as `URL` is concerned.
      const sameExtension = /^chrome-extension:/i.test(url) && /^chrome-extension:/i.test(opener) && URL.canParse(url) && URL.canParse(opener) && new URL(url).host === new URL(opener).host
      const allowed = /^https?:/i.test(url) || (isInternal(url) && isInternal(opener)) || sameExtension
      if (allowed) this.create(url, { activate: disposition !== 'background-tab', afterId: state.id, container: state.container })
      else if (appScheme(url)) this.options.onAppLink(contents, url, opener)
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
