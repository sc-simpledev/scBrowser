import type { TabManager } from './tabs/TabManager'

/** Browser commands shared by keyboard shortcuts and menus. */
export interface BrowserActions {
  tabs: TabManager
  focusOmnibox: () => void
  openFind: () => void
  toggleBookmark: () => void
  toggleBookmarksBar: () => void
  toggleFullscreen: () => void
  openPage: (page: 'settings' | 'history' | 'bookmarks' | 'downloads') => void
  quit: () => void
}
