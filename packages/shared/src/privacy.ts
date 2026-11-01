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
}

export const PALETTE_COMMANDS: PaletteCommand[] = [
  { id: 'new-tab', label: 'New tab', shortcut: 'Ctrl T' },
  { id: 'reopen-tab', label: 'Reopen closed tab', shortcut: 'Ctrl Shift T' },
  { id: 'find', label: 'Find in page', shortcut: 'Ctrl F' },
  { id: 'bookmark', label: 'Bookmark this page', shortcut: 'Ctrl D' },
  { id: 'bookmarks-bar', label: 'Show or hide bookmarks bar', shortcut: 'Ctrl Shift B' },
  { id: 'reader', label: 'Reader view', shortcut: 'F9' },
  { id: 'focus-mode', label: 'Turn Focus Mode on or off' },
  { id: 'site-blocker', label: 'Site blocker' },
  { id: 'vpn', label: 'VPN' },
  { id: 'assistant', label: 'Open assistant', shortcut: 'Ctrl Shift A' },
  { id: 'summarise', label: 'Summarise this page' },
  { id: 'translate', label: 'Translate this page' },
  { id: 'organise-tabs', label: 'Organise tabs into groups' },
  { id: 'ungroup-tabs', label: 'Remove tab groups' },
  { id: 'vertical-tabs', label: 'Switch tab layout' },
  { id: 'split', label: 'Split view with the next tab' },
  { id: 'history', label: 'History', shortcut: 'Ctrl H' },
  { id: 'bookmarks', label: 'Bookmarks', shortcut: 'Ctrl Shift O' },
  { id: 'downloads', label: 'Downloads', shortcut: 'Ctrl J' },
  { id: 'settings', label: 'Settings' },
  { id: 'ai-settings', label: 'AI settings' },
  { id: 'screenshot', label: 'Take a screenshot of this page', shortcut: 'Ctrl Shift S' },
  { id: 'print', label: 'Print', shortcut: 'Ctrl P' },
  { id: 'fullscreen', label: 'Full screen', shortcut: 'F11' },
  { id: 'devtools', label: 'Developer tools', shortcut: 'F12' }
]

/** Matches every typed word against a label, in any order. */
export function matchCommands(query: string, commands: PaletteCommand[] = PALETTE_COMMANDS): PaletteCommand[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return commands.filter((command) => words.every((word) => command.label.toLowerCase().includes(word)))
}
