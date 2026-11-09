import type { Settings } from './settings'

export interface SyncStatus {
  /** The chosen folder, or null when sync is off. */
  folder: string | null
  lastSync: number | null
  error: string | null
  running: boolean
}

export interface SyncedVisit {
  title: string
  visitCount: number
  lastVisit: number
}

/** What travels between devices. Everything is encrypted before it reaches the folder. */
export interface SyncData {
  bookmarks: Record<string, string>
  history: Record<string, SyncedVisit>
  settings: Partial<Settings>
  /** Bookmark group names. Files written by older versions leave these two out. */
  groups?: Record<string, true>
  /** The group each bookmark is in, by address. */
  placements?: Record<string, string>
  /** The folder each folder sits inside, by name. */
  folders?: Record<string, string>
}

export const EMPTY_SYNC: SyncData = { bookmarks: {}, history: {}, settings: {} }

/** These describe this computer, not the person. */
export const LOCAL_SETTINGS: (keyof Settings)[] = ['vpnFailover', 'secureDns', 'vpnScope', 'vpnMethod', 'vpnAutoConnect', 'vpnAutoFastest', 'assistantWidth', 'extensionPanelWidth', 'reportWidth', 'sidebarWidth', 'passwordLockMinutes', 'passwordOfferSave', 'downloadDir', 'verticalTabsCollapsed', 'syncHistory', 'crashReports', 'usageStats', 'focusMode', 'autoUpdate', 'performanceMode', 'devToolsWidth', 'passwordOfferLocked', 'sidebarSiteWidth', 'coderFolder', 'coderMode', 'memorySaver', 'downloadRules', 'focusUntil', 'vpnDirectContainers']

export const MAX_SYNCED_HISTORY = 5000

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Three-way merge: `base` is how things looked after the last sync, so something missing
 * from one side was deleted there rather than never seen. When both sides changed the same
 * entry, `resolve` picks the result; deleting wins over an edit.
 */
export function mergeEntries<T>(
  base: Record<string, T>,
  local: Record<string, T>,
  remote: Record<string, T>,
  resolve: (local: T, remote: T) => T = (a) => a
): Record<string, T> {
  const merged: Record<string, T> = {}
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const before = Object.hasOwn(base, key) ? base[key] : undefined
    const mine = Object.hasOwn(local, key) ? local[key] : undefined
    const theirs = Object.hasOwn(remote, key) ? remote[key] : undefined
    if (mine === undefined || theirs === undefined) {
      // Only on one side: new there, or deleted on the other side since the last sync.
      if (before === undefined) merged[key] = (mine ?? theirs)!
    } else if (same(mine, theirs) || same(theirs, before)) merged[key] = mine
    else if (same(mine, before)) merged[key] = theirs
    else merged[key] = resolve(mine, theirs)
  }
  return merged
}

const newestVisit = (a: SyncedVisit, b: SyncedVisit): SyncedVisit => ({
  title: (a.lastVisit >= b.lastVisit ? a.title : b.title) || a.title || b.title,
  visitCount: Math.max(a.visitCount, b.visitCount),
  lastVisit: Math.max(a.lastVisit, b.lastVisit)
})

/** Keeps the bundle to a sensible size by dropping the oldest visits. */
function recent(history: Record<string, SyncedVisit>): Record<string, SyncedVisit> {
  const entries = Object.entries(history)
  if (entries.length <= MAX_SYNCED_HISTORY) return history
  return Object.fromEntries(entries.sort(([, a], [, b]) => b.lastVisit - a.lastVisit).slice(0, MAX_SYNCED_HISTORY))
}

export function mergeSync(base: SyncData, local: SyncData, remote: SyncData): SyncData {
  // An older version rewrote the file without groups, which isn't the same as deleting them.
  const groups = remote.groups ? mergeEntries(base.groups ?? {}, local.groups ?? {}, remote.groups) : (local.groups ?? {})
  const placements = remote.placements ? mergeEntries(base.placements ?? {}, local.placements ?? {}, remote.placements) : (local.placements ?? {})
  const folders = remote.folders ? mergeEntries(base.folders ?? {}, local.folders ?? {}, remote.folders) : (local.folders ?? {})
  return {
    groups,
    placements,
    folders,
    bookmarks: mergeEntries(base.bookmarks, local.bookmarks, remote.bookmarks),
    history: recent(mergeEntries(base.history, local.history, remote.history, newestVisit)),
    settings: mergeEntries(base.settings, local.settings, remote.settings) as Partial<Settings>
  }
}
