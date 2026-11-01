export interface Bookmark {
  id: number
  url: string
  title: string
  createdAt: number
  /** Null when it sits directly on the bar rather than in a group. */
  groupId: number | null
  /** Order on the bar, or within its group. Groups and bookmarks share the bar's order. */
  position: number
}

export interface BookmarkGroup {
  id: number
  name: string
  position: number
}

/** One thing on the bookmarks bar, used when saving a new order. */
export interface BarItem {
  kind: 'bookmark' | 'group'
  id: number
}

/** Bookmarks and groups in the order they sit on the bar. */
export function barItems(bookmarks: Bookmark[], groups: BookmarkGroup[]): ({ kind: 'bookmark'; item: Bookmark } | { kind: 'group'; item: BookmarkGroup })[] {
  const items = [
    ...groups.map((item) => ({ kind: 'group' as const, item })),
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

export interface PermissionDecision {
  origin: string
  permission: SitePermission
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

export const INTERNAL_PAGES = ['settings', 'ai', 'assistant', 'history', 'bookmarks', 'downloads', 'blocker', 'vpn', 'flags'] as const
export type InternalPage = (typeof INTERNAL_PAGES)[number]
