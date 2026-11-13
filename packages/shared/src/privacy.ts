/** Addresses that can't have a public certificate, so HTTPS-only leaves them alone. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host.includes('.') && !host.includes(':')) return true
  if (host === '::1' || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.lan')) return true
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n))) return false
  const [a, b] = octets as [number, number, number, number]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
}

/** The https:// address for a page, or null if it shouldn't be upgraded. */
export function httpsUpgrade(url: string): string | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || isLocalHost(parsed.hostname)) return null
  parsed.protocol = 'https:'
  return parsed.toString()
}

export const ACCENTS = [
  { id: 'teal', name: 'scSpace teal' },
  { id: 'ember', name: 'Ember' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'forest', name: 'Forest' },
  { id: 'iris', name: 'Iris' },
  { id: 'rose', name: 'Rose' }
] as const

export type AccentId = (typeof ACCENTS)[number]['id']

export interface PaletteCommand {
  id: string
  label: string
  shortcut?: string
  /** Changes a setting, rather than doing something. */
  setting?: boolean
  /** Hands what was typed to the AI to carry out on the open tabs. */
  ai?: boolean
}

export const PALETTE_COMMANDS: PaletteCommand[] = [
  { id: 'new-tab', label: 'New tab', shortcut: 'Ctrl T' },
  { id: 'private-window', label: 'New private window', shortcut: 'Ctrl Shift N' },
  { id: 'reopen-tab', label: 'Reopen closed tab', shortcut: 'Ctrl Shift T' },
  { id: 'find', label: 'Find in page', shortcut: 'Ctrl F' },
  { id: 'bookmark', label: 'Bookmark this page', shortcut: 'Ctrl D' },
  { id: 'bookmarks-bar', label: 'Show or hide bookmarks bar', shortcut: 'Ctrl Shift B' },
  { id: 'reader', label: 'Reader view', shortcut: 'F9' },
  { id: 'read-aloud', label: 'Read this page aloud' },
  { id: 'focus-mode', label: 'Turn Focus Mode on or off' },
  { id: 'focus-15', label: 'Focus for 15 minutes' },
  { id: 'focus-25', label: 'Focus for 25 minutes' },
  { id: 'focus-50', label: 'Focus for 50 minutes' },
  { id: 'study-timer', label: 'Focus timer' },
  { id: 'study-toggle', label: 'Start or stop the focus timer' },
  { id: 'study-session', label: 'Start a focus countdown (rounds with breaks, like Pomodoro)' },
  { id: 'performance-mode', label: 'Turn Performance Mode on or off' },
  { id: 'site-blocker', label: 'Site blocker' },
  { id: 'vpn', label: 'VPN' },
  { id: 'passwords', label: 'Passwords' },
  { id: 'fill-password', label: 'Fill a saved password', shortcut: 'Ctrl Shift L' },
  { id: 'assistant', label: 'Open assistant', shortcut: 'Ctrl Shift A' },
  { id: 'summarise', label: 'Summarise this page' },
  { id: 'translate', label: 'Translate this page' },
  { id: 'organise-tabs', label: 'Organise tabs into groups' },
  { id: 'cleanup-tabs', label: 'Clean up tabs' },
  { id: 'new-workspace', label: 'New workspace' },
  { id: 'ungroup-tabs', label: 'Remove tab groups' },
  { id: 'vertical-tabs', label: 'Switch tab layout' },
  { id: 'split', label: 'Split view with the next tab' },
  { id: 'new-window', label: 'New window', shortcut: 'Ctrl N' },
  { id: 'install-app', label: 'Install this site as an app' },
  { id: 'task-manager', label: 'Task Manager', shortcut: 'Shift Esc' },
  { id: 'open-file', label: 'Open file', shortcut: 'Ctrl O' },
  { id: 'view-source', label: 'View page source', shortcut: 'Ctrl U' },
  { id: 'search-tabs', label: 'Search tabs', shortcut: 'Ctrl Shift E' },
  { id: 'pin-tab', label: 'Pin or unpin this tab' },
  { id: 'mute-tab', label: 'Mute or unmute this tab' },
  { id: 'history', label: 'History', shortcut: 'Ctrl H' },
  { id: 'bookmarks', label: 'Bookmarks', shortcut: 'Ctrl Shift O' },
  { id: 'downloads', label: 'Downloads', shortcut: 'Ctrl J' },
  { id: 'settings', label: 'Settings' },
  { id: 'ai-settings', label: 'AI settings' },
  { id: 'screenshot', label: 'Take a screenshot of this page', shortcut: 'Ctrl Shift S' },
  { id: 'hide-part', label: 'Hide part of this page' },
  { id: 'tweak-site', label: 'Change how this site looks with AI' },
  { id: 'recap', label: 'Recap what I read yesterday' },
  { id: 'recap-week', label: 'Recap what I read this week' },
  { id: 'add-to-sidebar', label: 'Add this site to the sidebar' },
  { id: 'watch-page', label: 'Watch this page for changes' },
  { id: 'reading-list-add', label: 'Add this page to the reading list' },
  { id: 'reading-list', label: 'Reading list' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'watched-pages', label: 'Watched pages' },
  { id: 'ai-briefs', label: 'AI Briefs' },
  { id: 'research-tabs', label: 'Research my open tabs into one report' },
  { id: 'save-split', label: 'Save this split view as a pair' },
  { id: 'get-started', label: 'Get started with scTerra' },
  { id: 'archived-tabs', label: 'Archived tabs' },
  { id: 'reopen-group', label: 'Reopen closed tab group' },
  { id: 'code', label: 'Terra Code: code with AI (beta)' },
  { id: 'forget-site', label: 'Forget this site' },
  { id: 'print', label: 'Print', shortcut: 'Ctrl P' },
  { id: 'fullscreen', label: 'Full screen', shortcut: 'F11' },
  { id: 'devtools', label: 'Developer tools', shortcut: 'F12' }
]

/** Matches every typed word against a label, in any order. */
export function matchCommands(query: string, commands: PaletteCommand[] = PALETTE_COMMANDS): PaletteCommand[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return commands.filter((command) => words.every((word) => command.label.toLowerCase().includes(word)))
}

/** Shortcuts are written for Windows and Linux; a Mac shows its own keys. */
export const shortcutLabel = (shortcut: string, platform: string) =>
  platform === 'darwin' ? shortcut.replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥').replace(/\bShift\b/g, '⇧') : shortcut

/** What was blocked over the last seven days, for the new tab's privacy card. */
export interface PrivacyWeek {
  blocked: number
  /** Cookie banners turned down for the person. */
  banners: number
  /** Oldest first, ending today. `day` is `YYYY-MM-DD`. */
  daily: { day: string; blocked: number }[]
  /** The trackers stopped most often. */
  topHosts: { host: string; count: number }[]
}
