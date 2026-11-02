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
