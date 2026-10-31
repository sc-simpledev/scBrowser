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
}

export interface TabsSnapshot {
  tabs: TabState[]
  activeId: TabId | null
  /** The two tabs shown side by side, if split view is on. */
  splitIds: TabId[]
}

/** Rectangle (in CSS pixels of the chrome UI) where the active page should be drawn. */
export interface PageRect {
  x: number
  y: number
  width: number
  height: number
}
