export interface Bookmark {
  id: number
  url: string
  title: string
  createdAt: number
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

export const INTERNAL_PAGES = ['settings', 'history', 'bookmarks', 'downloads'] as const
export type InternalPage = (typeof INTERNAL_PAGES)[number]
