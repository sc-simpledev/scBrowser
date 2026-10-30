import { WebContentsView, type BaseWindow, type WebContents } from 'electron'
import {
  isNewTabUrl,
  NEW_TAB_URL,
  resolveOmniboxInput,
  type PageRect,
  type TabId,
  type TabState,
  type TabsSnapshot
} from '@scbrowser/shared'

interface Tab {
  state: TabState
  view: WebContentsView
}

interface TabManagerOptions {
  /** Called (coalesced per tick) whenever any tab or the active tab changes. */
  onChange: (snapshot: TabsSnapshot) => void
  /** Lets the caller hook keyboard shortcuts and other per-tab behaviour. */
  onTabCreated: (contents: WebContents) => void
  onActivate: (tab: TabState) => void
}

const PAGE_RADIUS = 10
const CLOSED_TABS_LIMIT = 25

export class TabManager {
  private readonly tabs = new Map<TabId, Tab>()
  private order: TabId[] = []
  private activeId: TabId | null = null
  private pageRect: PageRect = { x: 0, y: 0, width: 0, height: 0 }
  private closedUrls: string[] = []
  private changeQueued = false

  constructor(
    private readonly window: BaseWindow,
    private readonly options: TabManagerOptions
  ) {}

  create(url: string = NEW_TAB_URL, { activate = true, afterId }: { activate?: boolean; afterId?: TabId } = {}): TabId {
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false
      }
    })
    view.setBorderRadius(PAGE_RADIUS)
    view.setVisible(false)

    const contents = view.webContents
    const state: TabState = {
      id: contents.id,
      url,
      title: '',
      faviconUrl: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false
    }
    const tab: Tab = { state, view }
    this.tabs.set(state.id, tab)

    const index = afterId === undefined ? -1 : this.order.indexOf(afterId)
    if (index === -1) this.order.push(state.id)
    else this.order.splice(index + 1, 0, state.id)

    this.window.contentView.addChildView(view)
    this.wire(tab)
    this.options.onTabCreated(contents)
    void contents.loadURL(url)

    if (activate || this.activeId === null) this.activate(state.id)
    else this.emitChange()
    return state.id
  }

  close(id: TabId): void {
    const tab = this.tabs.get(id)
    if (!tab) return

    const index = this.order.indexOf(id)
    this.order.splice(index, 1)
    this.tabs.delete(id)
    if (!isNewTabUrl(tab.state.url)) {
      this.closedUrls = [tab.state.url, ...this.closedUrls].slice(0, CLOSED_TABS_LIMIT)
    }

    this.window.contentView.removeChildView(tab.view)
    tab.view.webContents.close()

    if (this.activeId === id) {
      this.activeId = null
      // Like Firefox/Chrome: focus the tab to the right, else the one to the left.
      const next = this.order[index] ?? this.order[index - 1]
      if (next !== undefined) this.activate(next)
    }
    if (this.order.length === 0) this.create()
    this.emitChange()
  }

  reopenClosed(): void {
    const url = this.closedUrls.shift()
    if (url) this.create(url, { afterId: this.activeId ?? undefined })
  }

  activate(id: TabId): void {
    const next = this.tabs.get(id)
    if (!next) return
    if (this.activeId !== null && this.activeId !== id) {
      this.tabs.get(this.activeId)?.view.setVisible(false)
    }
    this.activeId = id
    next.view.setBounds(this.pageRect)
    next.view.setVisible(true)
    this.options.onActivate(next.state)
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
    void tab.view.webContents.loadURL(resolveOmniboxInput(input))
    tab.view.webContents.focus()
  }

  back(id: TabId): void {
    this.history(id)?.goBack()
  }

  forward(id: TabId): void {
    this.history(id)?.goForward()
  }

  reload(id: TabId, ignoreCache = false): void {
    const contents = this.tabs.get(id)?.view.webContents
    if (ignoreCache) contents?.reloadIgnoringCache()
    else contents?.reload()
  }

  stop(id: TabId): void {
    this.tabs.get(id)?.view.webContents.stop()
  }

  toggleDevTools(id: TabId): void {
    this.tabs.get(id)?.view.webContents.toggleDevTools()
  }

  setPageRect(rect: PageRect): void {
    this.pageRect = rect
    if (this.activeId !== null) this.tabs.get(this.activeId)?.view.setBounds(rect)
  }

  get active(): TabState | null {
    return this.activeId === null ? null : (this.tabs.get(this.activeId)?.state ?? null)
  }

  focusActive(): void {
    if (this.activeId !== null) this.tabs.get(this.activeId)?.view.webContents.focus()
  }

  snapshot(): TabsSnapshot {
    return {
      tabs: this.order.map((id) => ({ ...this.tabs.get(id)!.state })),
      activeId: this.activeId
    }
  }

  destroy(): void {
    for (const tab of this.tabs.values()) tab.view.webContents.close()
    this.tabs.clear()
    this.order = []
  }

  private history(id: TabId) {
    return this.tabs.get(id)?.view.webContents.navigationHistory
  }

  private wire({ state, view }: Tab): void {
    const contents = view.webContents
    const sync = (patch: Partial<TabState> = {}) => {
      Object.assign(state, patch, {
        url: patch.url || contents.getURL() || state.url,
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward()
      })
      this.emitChange()
    }

    contents.on('did-start-loading', () => sync({ isLoading: true }))
    contents.on('did-stop-loading', () => sync({ isLoading: false }))
    contents.on('did-navigate', (_e, url) => sync({ url, faviconUrl: null }))
    contents.on('did-navigate-in-page', (_e, url) => sync({ url }))
    contents.on('page-title-updated', (_e, title) => sync({ title }))
    contents.on('page-favicon-updated', (_e, favicons) => sync({ faviconUrl: favicons[0] ?? null }))

    // Links with target=_blank and window.open land in a new tab next to their opener.
    contents.setWindowOpenHandler(({ url, disposition }) => {
      this.create(url, { activate: disposition !== 'background-tab', afterId: state.id })
      return { action: 'deny' }
    })
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
