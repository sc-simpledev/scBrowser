export interface Bookmark {
  id: number
  url: string
  title: string
  createdAt: number
  /** Null when it sits directly on the bar rather than in a group. */
  groupId: number | null
  /** Order on the bar, or within its group. Groups and bookmarks share the bar's order. */
  position: number
  /** The site's icon as a data address, so showing it contacts nobody. */
  icon?: string | null
}

/** A folder of bookmarks, which can sit inside another folder. */
export interface BookmarkGroup {
  id: number
  name: string
  position: number
  /** Null when it sits directly on the bar. */
  parentId: number | null
}

/** Every folder in reading order, each straight after its parent. */
export function folderTree(groups: BookmarkGroup[]): { group: BookmarkGroup; depth: number; path: string }[] {
  const walk = (parentId: number | null, depth: number, prefix: string): { group: BookmarkGroup; depth: number; path: string }[] =>
    groups.filter((group) => group.parentId === parentId).flatMap((group) => {
      const path = prefix ? `${prefix} / ${group.name}` : group.name
      return [{ group, depth, path }, ...walk(group.id, depth + 1, path)]
    })
  return walk(null, 0, '')
}

/** One thing on the bookmarks bar, used when saving a new order. */
export interface BarItem {
  kind: 'bookmark' | 'group'
  id: number
}

export type FolderEntry = { kind: 'bookmark'; item: Bookmark } | { kind: 'group'; item: BookmarkGroup }

/** What's in one folder, or on the bar for null, in the order it sits. */
export function folderItems(bookmarks: Bookmark[], groups: BookmarkGroup[], folderId: number | null): FolderEntry[] {
  const items: FolderEntry[] = [
    ...groups.filter((group) => group.parentId === folderId).map((item) => ({ kind: 'group' as const, item })),
    ...bookmarks.filter((b) => b.groupId === folderId).map((item) => ({ kind: 'bookmark' as const, item }))
  ]
  return items.sort((a, b) => a.item.position - b.item.position)
}

/** Bookmarks and groups in the order they sit on the bar. */
export const barItems = (bookmarks: Bookmark[], groups: BookmarkGroup[]): FolderEntry[] => folderItems(bookmarks, groups, null)

export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadInfo {
  id: string
  url: string
  filename: string
  path: string
  receivedBytes: number
  totalBytes: number
  state: DownloadState
  startedAt: number
}

export type DownloadAction = 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove'

export type SitePermission = 'camera' | 'microphone' | 'notifications' | 'location' | 'clipboard' | 'midi'
/** Leave for a site to open a kind of app link without asking each time. */
export type AppLinkPermission = `app:${string}`

export interface PermissionDecision {
  origin: string
  permission: SitePermission | AppLinkPermission
  allowed: boolean
}

export interface PermissionPrompt {
  requestId: number
  origin: string
  permissions: SitePermission[]
}

export const PERMISSION_LABELS: Record<SitePermission, string> = {
  camera: 'use your camera',
  microphone: 'use your microphone',
  notifications: 'show notifications',
  location: 'know your location',
  clipboard: 'read your clipboard',
  midi: 'use MIDI devices'
}

export const INTERNAL_PAGES = ['settings', 'ai', 'assistant', 'history', 'bookmarks', 'passwords', 'downloads', 'blocker', 'vpn', 'tasks', 'watching', 'archive', 'highlights', 'reading', 'briefs', 'focus', 'flags'] as const
export type InternalPage = (typeof INTERNAL_PAGES)[number]

/** A site installed with its own window and system shortcut. */
export interface WebApp {
  id: string
  name: string
  url: string
}

/** One process, in the Task Manager. */
export interface TaskRow {
  pid: number
  kind: 'Tab' | 'Browser' | 'Extension' | 'System'
  name: string
  memoryKb: number
  cpu: number
  /** Only processes holding nothing but web pages can be ended. */
  canEnd: boolean
}

export interface TaskList {
  rows: TaskRow[]
  sleeping: number
}

/** Whether a bookmarked page still answers, from the tidy-up on sc://bookmarks. */
export interface LinkCheck {
  url: string
  /** `dead`: 404, 410 or a name that no longer resolves. `unknown`: it couldn't be told. */
  state: 'ok' | 'dead' | 'unknown'
  status: number | null
}

/** The same page however it was saved: the host's case, "www.", a trailing slash and a #fragment don't count. */
export function bookmarkKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : ''
    return `${parsed.protocol}//${parsed.host.toLowerCase().replace(/^www\./, '')}${path}${parsed.search}`
  } catch {
    return url
  }
}

/** Bookmarks saved more than once, oldest first in each set, so the first can be kept. */
export function duplicateBookmarks<T extends { id: number; url: string }>(bookmarks: T[]): T[][] {
  const sets = new Map<string, T[]>()
  for (const bookmark of bookmarks) {
    const key = bookmarkKey(bookmark.url)
    sets.set(key, [...(sets.get(key) ?? []), bookmark])
  }
  return [...sets.values()].filter((set) => set.length > 1).map((set) => [...set].sort((a, b) => a.id - b.id))
}
