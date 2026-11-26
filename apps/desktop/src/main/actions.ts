import type { MenuItemConstructorOptions, WebContents } from 'electron'
import type { RewriteStyle } from '@scbrowser/ai'
import type { AssistantPrompt, ClosedGroup, SnoozeChoice, TranslateLanguage } from '@scbrowser/shared'
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
  /** Opens the find bar on these words, for the tab that's just been brought up. */
  findText: (text: string, tabId: number) => void
  toggleBookmark: () => void
  toggleBookmarksBar: () => void
  toggleFullscreen: () => void
  openPage: (page: 'settings' | 'ai' | 'history' | 'bookmarks' | 'passwords' | 'downloads' | 'blocker' | 'vpn' | 'tasks' | 'watching' | 'briefs' | 'focus' | 'archive' | 'highlights' | 'reading', part?: string) => void
  /** Stops the focus timer, or starts its last subject again. */
  toggleStudy: () => void
  /** The sidebar timer's menu at this point of the window. */
  studyMenu: (x: number, y: number) => void
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
  /** False after "Remove VPN", which hides its menu rows. */
  vpnInstalled: () => boolean
  askAssistant: (prompt: AssistantPrompt) => void
  /** Sends the picture at this point of the page to the side assistant, to ask about. */
  askAboutImage: (contents: WebContents, src: string, x: number, y: number) => void
  /** Now playing's menu for a tab: speed, picture in picture, mute. */
  mediaMenu: (tabId: number, x: number, y: number) => void
  /** Now playing's buttons. */
  mediaAction: (tabId: number, action: 'toggle' | 'pip' | 'focus') => void
  /** How the assistant writes replies, as a menu at this point of the window. */
  styleMenu: (x: number, y: number) => void
  quit: () => void
  openPrivateWindow: () => void
  installUpdate: () => void
  extensionMenu: () => MenuItemConstructorOptions[]
  /** Marks the selected words on this page, to show again whenever it's visited. */
  highlight: (contents: WebContents, text: string) => void
  addToReadingList: () => void
  /** Closes a tab into the archive, to find in sc://archive. */
  archiveTab: (id: number) => void
  /** Opens the assistant and says how to change a site's look with /tweak. */
  tweakSiteHelp: () => void
  /** Closes a tab until a time, when it opens again by itself. */
  snoozeTab: (id: number, choice: SnoozeChoice) => void
  /** Snoozes every tab in a group; they come back into it together. */
  snoozeGroup: (name: string, choice: SnoozeChoice) => void
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
  /** The page's address as a QR code, under the padlock, to take it to a phone. */
  showQr: () => void
  /** Letters on every link and button in view; typing them clicks it. */
  linkHints: () => void
  /** Shorter tab titles from the AI, with the real ones on hover. */
  tidyTitles: () => void
  restoreTitles: () => void
  /** Drag a box over the page, and it goes to the assistant as a picture. */
  askAboutRegion: () => void
  /** Saves the open page to a file, whole with its pictures or as one .mhtml file. */
  savePage: () => void
  /** Opens Clear browsing data in Settings. */
  clearBrowsingData: () => void
  /** The home page, or the new tab page, in the open tab. */
  goHome: () => void
  /** Ctrl Tab goes by recently used rather than by place. */
  recentTabOrder: () => boolean
  /** The zoom sites without one of their own get, as a factor. */
  defaultZoom: () => number
  /** What the pop-up blocker stopped on the open page, and letting the site open them. */
  popupsMenu: (x: number, y: number) => void
  /** Copies these tabs' links (or every tab's here) as a Markdown list. */
  copyTabLinks: (ids?: number[]) => void
  closeDuplicates: () => void
  /** Mutes a tab's site in every tab, now and later, or unmutes it. */
  toggleSiteMute: (id: number) => void
  /** Whether a tab's site is muted everywhere. */
  siteMuted: (url: string) => boolean
  /** Moves a tab to a new window, or to another open one. */
  moveTabToWindow: (id: number, target: 'new' | number) => void
  /** The other browser windows, by the index `moveTabToWindow` takes, named by their open tab. */
  otherWindows: () => { index: number; title: string }[]
}
