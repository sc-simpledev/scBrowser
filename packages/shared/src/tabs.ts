export type TabId = number

export interface TabState {
  id: TabId
  url: string
  title: string
  faviconUrl: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface TabsSnapshot {
  tabs: TabState[]
  activeId: TabId | null
}

/** Rectangle (in CSS pixels of the chrome UI) where the active page should be drawn. */
export interface PageRect {
  x: number
  y: number
  width: number
  height: number
}
