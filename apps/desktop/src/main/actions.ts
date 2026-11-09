import type { MenuItemConstructorOptions, WebContents } from 'electron'
import type { RewriteStyle } from '@scbrowser/ai'
import type { AssistantPrompt, ClosedGroup, TranslateLanguage } from '@scbrowser/shared'
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
  openPage: (page: 'settings' | 'ai' | 'history' | 'bookmarks' | 'passwords' | 'downloads' | 'blocker' | 'vpn' | 'tasks' | 'watching' | 'archive' | 'highlights' | 'reading', part?: string) => void
  openCode: () => void
  toggleAssistant: () => void
  passwordMenu: () => void
  toggleReader: () => void
  readAloud: () => void
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
  /** A brief note at the top right of the page. */
  notify: (text: string) => void
  /** Focus Mode for this many minutes, then off by itself. */
  focusFor: (minutes: number) => void
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
  /** Marks the selected words on this page, to show again whenever it's visited. */
  highlight: (contents: WebContents, text: string) => void
  addToReadingList: () => void
  /** Closes a tab into the archive, to find in sc://archive. */
  archiveTab: (id: number) => void
  /** Closes a tab group, keeping it to reopen later unless `keep` is false. */
  closeGroup: (name: string, keep: boolean) => void
  closedGroups: () => ClosedGroup[]
  reopenGroup: (id: string) => void
  /** Watches the active page for changes, or a part of it the person picks. */
  watchPage: (part: boolean) => void
  /** Puts the active tab's site in the sidebar rail, and opens it there. */
  addToSidebar: () => void
  /** Opens a link over the page without making a tab. */
  previewLink: (url: string, contents: WebContents) => void
  /** Lets the person click a part of the page to hide on that site from now on. */
  hidePart: () => void
  /** True if parts of this address's site have been hidden. */
  hasHiddenParts: (url: string) => boolean
  showHiddenParts: () => void
  /** Asks first, then clears the site's cookies, storage, history and permissions. */
  forgetSite: () => void
}
