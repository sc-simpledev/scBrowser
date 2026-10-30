import type { AssistantPrompt } from '@scbrowser/shared'
import type { TabManager } from './tabs/TabManager'

/** Browser commands shared by keyboard shortcuts and menus. */
export interface BrowserActions {
  tabs: TabManager
  focusOmnibox: () => void
  openFind: () => void
  toggleBookmark: () => void
  toggleBookmarksBar: () => void
  toggleFullscreen: () => void
  openPage: (page: 'settings' | 'ai' | 'history' | 'bookmarks' | 'downloads') => void
  toggleAssistant: () => void
  askAssistant: (prompt: AssistantPrompt) => void
  quit: () => void
}
