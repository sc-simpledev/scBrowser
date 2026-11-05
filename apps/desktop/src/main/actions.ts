import type { MenuItemConstructorOptions, WebContents } from 'electron'
import type { RewriteStyle } from '@scbrowser/ai'
import type { AssistantPrompt, TranslateLanguage } from '@scbrowser/shared'
import type { TabManager } from './tabs/TabManager'

/** Browser commands shared by keyboard shortcuts and menus. */
export interface BrowserActions {
  tabs: TabManager
  /** An installed site's window, which has no tabs to speak of. */
  appWindow: boolean
  openWindow: (url?: string, container?: string | null) => void
  installApp: () => void
  /** Moves on from an installed site's window to the full browser. */
  openInBrowser: () => void
  focusOmnibox: () => void
  openFind: () => void
  toggleBookmark: () => void
  toggleBookmarksBar: () => void
  toggleFullscreen: () => void
  openPage: (page: 'settings' | 'ai' | 'history' | 'bookmarks' | 'passwords' | 'downloads' | 'blocker' | 'vpn' | 'tasks') => void
  toggleAssistant: () => void
  passwordMenu: () => void
  toggleReader: () => void
  screenshot: () => void
  organiseTabs: () => void
  cleanupTabs: () => void
  translatePage: (language?: TranslateLanguage) => void
  translateLanguage: () => TranslateLanguage
  /** Menu rows for filling in details on this page, if there are any to offer. */
  autofillRows: (contents: WebContents) => MenuItemConstructorOptions[]
  rewrite: (contents: WebContents, text: string, style: RewriteStyle) => void
  togglePalette: () => void
  searchTabs: () => void
  /** What the browser's own controls do with an address, which may be a script or another app's link. */
  openAddress: (id: number, input: string) => void
  openAppLink: (url: string, requester: string, contents: WebContents) => void
  openFile: () => void
  viewSource: () => void
  searchWeb: (text: string) => void
  spellCheck: { enabled: () => boolean; toggle: () => void }
  performanceMode: { enabled: () => boolean; toggle: () => void }
  askAssistant: (prompt: AssistantPrompt) => void
  quit: () => void
  openPrivateWindow: () => void
  installUpdate: () => void
  extensionMenu: () => MenuItemConstructorOptions[]
}
