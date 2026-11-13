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
  /** The tab whose link opened this one, while that tab is still open. */
  parentId?: TabId | null
  /** How far in to draw it under the tabs it came from, for the tab tree. 0 is the top level. */
  depth?: number
}

/** Deeper branches are drawn at this level, so titles keep their room. */
export const MAX_TREE_DEPTH = 3

/** A separate set of tabs, such as work or study. */
export interface Workspace {
  id: string
  name: string
  /** Turns Focus Mode on while this workspace is open. */
  focus: boolean
  /** Switches to this workspace by itself at the start of these hours, and back at the end. */
  schedule?: WorkspaceSchedule | null
  /** Turns the VPN on while this workspace is open, and off again when leaving if it turned it on. */
  vpn?: boolean
}

export interface WorkspaceSchedule {
  /** Days of the week, 0 for Sunday. */
  days: number[]
  /** Local times as `HH:MM`. A `to` before `from` runs past midnight. */
  from: string
  to: string
}

export const DEFAULT_WORKSPACE_SCHEDULE: WorkspaceSchedule = { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

export const isWorkspaceSchedule = (value: unknown): value is WorkspaceSchedule => {
  const { days, from, to } = (value ?? {}) as WorkspaceSchedule
  return Array.isArray(days) && days.length <= 7 && days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) && typeof from === 'string' && HH_MM.test(from) && typeof to === 'string' && HH_MM.test(to) && from !== to
}

/** Whether a schedule covers this moment. Hours past midnight belong to the day they started on. */
export function workspaceScheduledNow(schedule: WorkspaceSchedule, now: Date): boolean {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const at = now.getHours() * 60 + now.getMinutes()
  const from = minutes(schedule.from)
  const to = minutes(schedule.to)
  if (from < to) return schedule.days.includes(now.getDay()) && at >= from && at < to
  if (at >= from) return schedule.days.includes(now.getDay())
  return at < to && schedule.days.includes((now.getDay() + 6) % 7)
}

/** `Mon–Fri, 09:00–17:00` */
export function workspaceScheduleLabel(schedule: WorkspaceSchedule): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const sorted = [1, 2, 3, 4, 5, 6, 0].filter((day) => schedule.days.includes(day))
  const days = sorted.length === 7 ? 'Every day' : sorted.join() === '1,2,3,4,5' ? 'Mon–Fri' : sorted.join() === '6,0' ? 'Weekends' : sorted.map((day) => names[day]).join(', ')
  return `${days}, ${schedule.from}–${schedule.to}`
}

export const DEFAULT_WORKSPACE: Workspace = { id: 'main', name: 'Personal', focus: false }

export interface TabsSnapshot {
  tabs: TabState[]
  activeId: TabId | null
  /** The two tabs shown side by side, if split view is on. */
  splitIds: TabId[]
  /** The left tab's share of split view's width. */
  splitRatio: number
  /** Links clicked on the left side of split view open on the right. */
  splitLinked: boolean
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

/** Split view draws each page as a card on the window: room round the cards, and a bar on each. */
export const SPLIT_PAD = 6
export const SPLIT_BAR = 32
export const SPLIT_RADIUS = 10

export interface SplitPane {
  /** The whole card, its bar included. */
  card: PageRect
  /** Where the page itself goes, inside the card's border and under its bar. */
  page: PageRect
}

/** The width both cards share, inside a page area this wide. */
export const splitRoom = (width: number) => Math.max(0, width - SPLIT_PAD * 2 - SPLIT_GAP)

/** Both cards of split view, left then right, in the coordinates `area` is in. */
export function splitPanes(area: PageRect, ratio: number): [SplitPane, SplitPane] {
  const room = splitRoom(area.width)
  const leftWidth = Math.floor(room * ratio)
  const height = Math.max(0, area.height - SPLIT_PAD * 2)
  const pane = (x: number, width: number): SplitPane => {
    const card = { x, y: area.y + SPLIT_PAD, width, height }
    return { card, page: { x: x + 1, y: card.y + SPLIT_BAR, width: Math.max(0, width - 2), height: Math.max(0, height - SPLIT_BAR - 1) } }
  }
  const leftX = area.x + SPLIT_PAD
  return [pane(leftX, leftWidth), pane(leftX + leftWidth + SPLIT_GAP, room - leftWidth)]
}

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
