export type TabId = number

export interface TabState {
  id: TabId
  url: string
  title: string
  faviconUrl: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Unloaded to save memory; wakes when activated. */
  isSleeping: boolean
  zoomPercent: number
  /** Ads and trackers stopped on the current page. */
  blockedCount: number
  /** Keeps this tab's cookies and site data apart; null is the default store. */
  container: string | null
  /** Name of the group this tab is in. */
  group: string | null
  workspace: string
  /** Kept at the start of the tabs, as just an icon. */
  pinned: boolean
  /** Playing sound right now, whether or not it's muted. */
  audible: boolean
  muted: boolean
}

/** A separate set of tabs, such as work or study. */
export interface Workspace {
  id: string
  name: string
  /** Turns Focus Mode on while this workspace is open. */
  focus: boolean
}

export const DEFAULT_WORKSPACE: Workspace = { id: 'main', name: 'Personal', focus: false }

export interface TabsSnapshot {
  tabs: TabState[]
  activeId: TabId | null
  /** The two tabs shown side by side, if split view is on. */
  splitIds: TabId[]
  /** The left tab's share of split view's width. */
  splitRatio: number
  /** How wide the open tab's developer tools are drawn, or 0 when they aren't showing. */
  devToolsWidth: number
  workspaces: Workspace[]
  activeWorkspace: string
}

/** Rectangle (in CSS pixels of the chrome UI) where the active page should be drawn. */
export interface PageRect {
  x: number
  y: number
  width: number
  height: number
}

/** The strip left between the two tabs in split view, where its divider sits. */
export const SPLIT_GAP = 6
/** The bar drawn by the browser UI above docked developer tools, holding their title and close button. */
export const DEVTOOLS_BAR = 30
export const SPLIT_RATIO = { min: 0.2, max: 0.8, standard: 0.5 }

export const clampSplitRatio = (ratio: number) => Math.min(SPLIT_RATIO.max, Math.max(SPLIT_RATIO.min, ratio))

/** How wide split view's left tab is, inside a page area this wide. */
export const splitLeftWidth = (width: number, ratio: number) => Math.floor((width - SPLIT_GAP) * ratio)

/** A row in tab search, which covers every workspace. */
export interface TabSearchRow {
  id: TabId
  title: string
  url: string
  faviconUrl: string | null
  isLoading: boolean
  pinned: boolean
  audible: boolean
  muted: boolean
  /** Null for tabs in the open workspace of this window; otherwise where the tab is, like "Work" or "Window 2 · Work". */
  workspaceName: string | null
  lastActiveAt: number
}

/** Tabs holding every word of the query, most recently used first when there's nothing to go on. */
export function matchTabs(query: string, rows: TabSearchRow[]): TabSearchRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const found = rows.filter((row) => {
    const text = `${row.title} ${row.url} ${row.workspaceName ?? ''}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
  return found.toSorted((a, b) => b.lastActiveAt - a.lastActiveAt)
}

export interface CleanupInput {
  id: TabId
  url: string
  title: string
  lastActiveAt: number
}

export interface CleanupRow {
  id: TabId
  title: string
  url: string
  reason: string
}

const DAY_MS = 86_400_000
export const STALE_TAB_DAYS = 7

/** Tabs that are safe to suggest closing without asking any AI. The open tab is never offered. */
export function suggestCleanup(tabs: CleanupInput[], activeId: TabId | null, now = Date.now()): CleanupRow[] {
  const newest = new Map<string, CleanupInput>()
  for (const tab of tabs) {
    const kept = newest.get(tab.url)
    if (!kept || tab.id === activeId || (kept.id !== activeId && tab.lastActiveAt > kept.lastActiveAt)) newest.set(tab.url, tab)
  }
  return tabs.flatMap((tab) => {
    if (tab.id === activeId) return []
    const row = { id: tab.id, title: tab.title || tab.url, url: tab.url }
    if (newest.get(tab.url)?.id !== tab.id) return [{ ...row, reason: 'Open twice' }]
    const days = Math.floor((now - tab.lastActiveAt) / DAY_MS)
    return days >= STALE_TAB_DAYS ? [{ ...row, reason: `Not opened for ${days} days` }] : []
  })
}
