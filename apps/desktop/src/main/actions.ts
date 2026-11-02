import type { WebContents } from 'electron'
import type { RewriteStyle } from '@scbrowser/ai'
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
  openPage: (page: 'settings' | 'ai' | 'history' | 'bookmarks' | 'downloads' | 'blocker' | 'vpn') => void
  toggleAssistant: () => void
  toggleReader: () => void
  screenshot: () => void
  organiseTabs: () => void
  cleanupTabs: () => void
  translatePage: () => void
  rewrite: (contents: WebContents, text: string, style: RewriteStyle) => void
  togglePalette: () => void
  askAssistant: (prompt: AssistantPrompt) => void
  quit: () => void
  openPrivateWindow: () => void
  installUpdate: () => void
}
