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

/** Bookmarks and groups in the order they sit on the bar. */
export function barItems(bookmarks: Bookmark[], groups: BookmarkGroup[]): ({ kind: 'bookmark'; item: Bookmark } | { kind: 'group'; item: BookmarkGroup })[] {
  const items = [
    ...groups.filter((group) => group.parentId === null).map((item) => ({ kind: 'group' as const, item })),
    ...bookmarks.filter((b) => b.groupId === null).map((item) => ({ kind: 'bookmark' as const, item }))
  ]
  return items.sort((a, b) => a.item.position - b.item.position)
}

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

export const INTERNAL_PAGES = ['settings', 'ai', 'assistant', 'history', 'bookmarks', 'passwords', 'downloads', 'blocker', 'vpn', 'tasks', 'watching', 'archive', 'highlights', 'reading', 'flags', 'code'] as const
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
