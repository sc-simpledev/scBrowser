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
}

export const EMPTY_SYNC: SyncData = { bookmarks: {}, history: {}, settings: {} }

/** These describe this computer, not the person. */
export const LOCAL_SETTINGS: (keyof Settings)[] = ['downloadDir', 'verticalTabsCollapsed', 'syncHistory', 'crashReports', 'usageStats']

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
  return {
    bookmarks: mergeEntries(base.bookmarks, local.bookmarks, remote.bookmarks),
    history: recent(mergeEntries(base.history, local.history, remote.history, newestVisit)),
    settings: mergeEntries(base.settings, local.settings, remote.settings) as Partial<Settings>
  }
}
