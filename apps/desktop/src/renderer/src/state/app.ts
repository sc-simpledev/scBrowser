import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Bookmark, type BookmarkGroup, type ChromeEvents, type Settings } from '@scbrowser/shared'

interface AppStore {
  settings: Settings
  bookmarks: Bookmark[]
  bookmarkGroups: BookmarkGroup[]
  downloads: ChromeEvents['downloads:progress']
  /** Whether anything has been downloaded since launch, which reveals the toolbar button. */
  hasDownloaded: boolean
  /** Sites where tracking protection is switched off. */
  privacyOffHosts: string[]
  /** The window is too narrow for everything, so spare buttons move into the More menu. */
  compact: boolean
}

export const COMPACT_QUERY = '(max-width: 759px)'

export const useApp = create<AppStore>(() => ({
  settings: DEFAULT_SETTINGS,
  bookmarks: [],
  bookmarkGroups: [],
  downloads: { active: 0, fraction: null },
  hasDownloaded: false,
  privacyOffHosts: [],
  compact: matchMedia(COMPACT_QUERY).matches
}))

/** Subscribes the store to main-process events. Call once at startup. */
export function connectApp(): () => void {
  const setSettings = (settings: Settings) => {
    document.documentElement.dataset.accent = settings.accent
    document.documentElement.toggleAttribute('data-tint', settings.accentTint)
    useApp.setState({ settings })
  }
  const setBookmarks = (bookmarks: Bookmark[]) => useApp.setState({ bookmarks })
  void window.scb.invoke('settings:get').then(setSettings)
  void window.scb.invoke('bookmarks:list').then(setBookmarks)
  void window.scb.invoke('bookmarks:groups').then((bookmarkGroups) => useApp.setState({ bookmarkGroups }))
  const narrow = matchMedia(COMPACT_QUERY)
  const onNarrow = () => useApp.setState({ compact: narrow.matches })
  narrow.addEventListener('change', onNarrow)
  const unsubscribers = [
    () => narrow.removeEventListener('change', onNarrow),
    window.scb.on('settings:changed', setSettings),
    window.scb.on('bookmarks:changed', setBookmarks),
    window.scb.on('bookmark-groups:changed', (bookmarkGroups) => useApp.setState({ bookmarkGroups })),
    window.scb.on('privacy:changed', (privacyOffHosts) => useApp.setState({ privacyOffHosts })),
    window.scb.on('downloads:progress', (downloads) => useApp.setState({ downloads, hasDownloaded: true }))
  ]
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}
