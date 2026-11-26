/**
 * The browser's keyboard shortcuts, in one place: the main process matches keys against them, menus
 * and the command palette show them, and Settings lets the person change them.
 *
 * Keys are written like `Ctrl+Shift+T`, modifiers first in the order Ctrl, Alt, Shift. Ctrl is ⌘ on a
 * Mac. Keys are letters, digits, F1 to F24, punctuation, and the names in `NAMED_KEYS`.
 */

export const SHORTCUT_GROUPS = ['Tabs and windows', 'Pages', 'Finding and going', 'scTerra'] as const
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

export interface ShortcutDef {
  id: string
  label: string
  group: ShortcutGroup
  keys: readonly string[]
  /** Also works in an installed site's window, which has one page and no tabs. */
  app?: boolean
}

export const SHORTCUTS = [
  { id: 'new-tab', label: 'New tab', group: 'Tabs and windows', keys: ['Ctrl+T'] },
  { id: 'close-tab', label: 'Close tab', group: 'Tabs and windows', keys: ['Ctrl+W'], app: true },
  { id: 'reopen-tab', label: 'Reopen closed tab', group: 'Tabs and windows', keys: ['Ctrl+Shift+T'] },
  { id: 'next-tab', label: 'Next tab', group: 'Tabs and windows', keys: ['Ctrl+Tab', 'Ctrl+PageDown'] },
  { id: 'previous-tab', label: 'Previous tab', group: 'Tabs and windows', keys: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'] },
  { id: 'search-tabs', label: 'Search tabs', group: 'Tabs and windows', keys: ['Ctrl+Shift+E'] },
  { id: 'new-window', label: 'New window', group: 'Tabs and windows', keys: ['Ctrl+N'] },
  { id: 'private-window', label: 'New private window', group: 'Tabs and windows', keys: ['Ctrl+Shift+N'] },
  { id: 'fullscreen', label: 'Full screen', group: 'Tabs and windows', keys: ['F11'], app: true },
  { id: 'quit', label: 'Quit', group: 'Tabs and windows', keys: ['Ctrl+Q'], app: true },

  { id: 'reload', label: 'Reload', group: 'Pages', keys: ['Ctrl+R', 'F5'], app: true },
  { id: 'hard-reload', label: 'Reload without the cache', group: 'Pages', keys: ['Ctrl+Shift+R', 'Shift+F5', 'Ctrl+F5'], app: true },
  { id: 'back', label: 'Back', group: 'Pages', keys: ['Alt+Left', 'Ctrl+['], app: true },
  { id: 'forward', label: 'Forward', group: 'Pages', keys: ['Alt+Right', 'Ctrl+]'], app: true },
  { id: 'home', label: 'Home', group: 'Pages', keys: ['Alt+Home'] },
  { id: 'zoom-in', label: 'Zoom in', group: 'Pages', keys: ['Ctrl+=', 'Ctrl+Plus', 'Ctrl+Shift+Plus', 'Ctrl+Shift+='], app: true },
  { id: 'zoom-out', label: 'Zoom out', group: 'Pages', keys: ['Ctrl+-'], app: true },
  { id: 'zoom-reset', label: 'Actual size', group: 'Pages', keys: ['Ctrl+0'], app: true },
  { id: 'print', label: 'Print', group: 'Pages', keys: ['Ctrl+P'], app: true },
  { id: 'save-page', label: 'Save page', group: 'Pages', keys: ['Ctrl+S'] },
  { id: 'reader', label: 'Reader view', group: 'Pages', keys: ['F9'] },
  { id: 'screenshot', label: 'Screenshot', group: 'Pages', keys: ['Ctrl+Shift+S'] },
  { id: 'view-source', label: 'View page source', group: 'Pages', keys: ['Ctrl+U'] },
  { id: 'devtools', label: 'Developer tools', group: 'Pages', keys: ['F12', 'Ctrl+Shift+I'], app: true },

  { id: 'address-bar', label: 'Go to the address bar', group: 'Finding and going', keys: ['Ctrl+L', 'Alt+D', 'F6'] },
  { id: 'find', label: 'Find in page', group: 'Finding and going', keys: ['Ctrl+F'], app: true },
  { id: 'palette', label: 'Command palette', group: 'Finding and going', keys: ['Ctrl+K'] },
  { id: 'link-hints', label: 'Link hints', group: 'Finding and going', keys: ['Ctrl+.'] },
  { id: 'open-file', label: 'Open file', group: 'Finding and going', keys: ['Ctrl+O'] },

  { id: 'assistant', label: 'Assistant', group: 'scTerra', keys: ['Ctrl+Shift+A'] },
  { id: 'bookmark', label: 'Bookmark this page', group: 'scTerra', keys: ['Ctrl+D'] },
  { id: 'bookmarks-bar', label: 'Show or hide bookmarks bar', group: 'scTerra', keys: ['Ctrl+Shift+B'] },
  { id: 'bookmarks', label: 'Bookmarks', group: 'scTerra', keys: ['Ctrl+Shift+O'] },
  { id: 'history', label: 'History', group: 'scTerra', keys: ['Ctrl+H'] },
  { id: 'downloads', label: 'Downloads', group: 'scTerra', keys: ['Ctrl+J'] },
  { id: 'settings', label: 'Settings', group: 'scTerra', keys: ['Ctrl+,'] },
  { id: 'clear-data', label: 'Clear browsing data', group: 'scTerra', keys: ['Ctrl+Shift+Delete'] },
  { id: 'passwords', label: 'Fill a saved password', group: 'scTerra', keys: ['Ctrl+Shift+L'] },
  { id: 'task-manager', label: 'Task Manager', group: 'scTerra', keys: ['Shift+Escape'] }
] as const satisfies readonly ShortcutDef[]

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

/** Keys that can't be changed, listed so Settings can say what they are and warn before reusing them. */
export const FIXED_SHORTCUTS = [
  { label: 'Go to tab 1 to 8, or the last tab', keys: 'Ctrl 1 to 9' },
  { label: 'Switch workspace', keys: 'Ctrl Alt 1 to 9' }
] as const

export const MAX_KEYS_PER_SHORTCUT = 3

const NAMED_KEYS = ['Tab', 'Escape', 'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown', 'Left', 'Right', 'Up', 'Down', 'Space', 'Enter', 'Insert', 'Plus'] as const
const PUNCTUATION = ['.', ',', '-', '=', '[', ']', '/', ';', "'", '`', '\\'] as const
const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const

const isKeyName = (key: string) =>
  /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || (NAMED_KEYS as readonly string[]).includes(key) || (PUNCTUATION as readonly string[]).includes(key)

/** Whether a combination is written the one way this file writes it, and has a key. */
export function isCombo(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false
  // `Ctrl++` can't be split on `+`, which is why the plus key is called Plus.
  const parts = value.split('+')
  const key = parts.pop()!
  if (!isKeyName(key)) return false
  const order = parts.map((part) => (MODIFIERS as readonly string[]).indexOf(part))
  return order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]!))
}

/** A function key, or anything with Ctrl or Alt: plain letters and Shift alone belong to the page. */
export function isUsableCombo(combo: string): boolean {
  if (!isCombo(combo)) return false
  const key = combo.split('+').pop()!
  return /^F\d+$/.test(key) || /(^|\+)(Ctrl|Alt)\+/.test(combo) || combo === 'Shift+Escape'
}

export const isShortcutOverrides = (value: unknown): value is Record<string, string[]> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([id, keys]) => SHORTCUTS.some((shortcut) => shortcut.id === id) && Array.isArray(keys) && keys.length <= MAX_KEYS_PER_SHORTCUT && keys.every(isUsableCombo)
  )
}

/** What a shortcut is set to now: the person's own keys if they changed it, or the usual ones. */
export const shortcutKeys = (id: ShortcutId, overrides: Record<string, readonly string[]>): readonly string[] =>
  overrides[id] ?? SHORTCUTS.find((shortcut) => shortcut.id === id)!.keys

/** Every combination in use, and the shortcut it runs. A key the person gave one shortcut leaves the one it came from. */
export function buildKeymap(overrides: Record<string, readonly string[]>): Map<string, ShortcutId> {
  const map = new Map<string, ShortcutId>()
  for (const shortcut of SHORTCUTS) if (!overrides[shortcut.id]) for (const combo of shortcut.keys) map.set(combo, shortcut.id)
  for (const shortcut of SHORTCUTS) for (const combo of overrides[shortcut.id] ?? []) map.set(combo, shortcut.id)
  return map
}

/** The shortcut already using a combination, other than `except`. */
export function shortcutUsing(combo: string, overrides: Record<string, readonly string[]>, except?: ShortcutId): ShortcutId | null {
  const id = buildKeymap(overrides).get(combo)
  return id && id !== except ? id : null
}

const fixedCombo = (combo: string) => /^Ctrl\+(Alt\+)?[1-9]$/.test(combo)

/** True when a combination would never reach a changeable shortcut, as it's one of the fixed ones. */
export const isFixedCombo = fixedCombo

/** The keys a key press makes, written as above, or null for a press of only modifiers. */
export function comboFromKey(
  event: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
  platform: string
): string | null {
  const ctrl = platform === 'darwin' ? event.metaKey || (event.ctrlKey && event.key === 'Tab') : event.ctrlKey
  const key = keyName(event.key, event.code, event.shiftKey)
  if (!key) return null
  return [ctrl && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+')
}

const CODE_KEYS: Record<string, string> = {
  Period: '.',
  Comma: ',',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  NumpadAdd: 'Plus',
  NumpadSubtract: '-'
}
const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ' ': 'Space',
  '+': 'Plus',
  Esc: 'Escape',
  Del: 'Delete'
}

function keyName(key: string, code: string, shift: boolean): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'].includes(key)) return null
  if (/^[a-z]$/i.test(key)) return key.toUpperCase()
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key
  if (KEY_NAMES[key]) return KEY_NAMES[key]!
  if ((NAMED_KEYS as readonly string[]).includes(key)) return key
  // With Shift held, the key is the shifted sign (`>` for `.`), so where it sits says which it is.
  const digit = /^(Digit|Numpad)([0-9])$/.exec(code)
  if (digit) return digit[2]!
  if (!shift && (PUNCTUATION as readonly string[]).includes(key)) return key
  if (CODE_KEYS[code]) return CODE_KEYS[code]!
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  return null
}

/** As people read it: `Ctrl Shift T`, with arrows and ⌘ where they belong. */
export function comboLabel(combo: string, platform: string): string {
  const parts = combo.split('+').map((part) => ({ Left: '←', Right: '→', Up: '↑', Down: '↓', Plus: '+', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn' })[part] ?? part)
  const label = parts.join(' ')
  return platform === 'darwin' ? label.replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥').replace(/\bShift\b/g, '⇧') : label
}

/** For Electron's menus. */
export const comboAccelerator = (combo: string): string => combo.replace(/^Ctrl\b/, 'CmdOrCtrl').replace(/\bEscape$/, 'Esc')

/** Palette commands that do what a shortcut does, by palette id, so the palette shows the key as it is now. */
export const PALETTE_SHORTCUTS: Record<string, ShortcutId> = {
  'new-tab': 'new-tab',
  'private-window': 'private-window',
  'reopen-tab': 'reopen-tab',
  find: 'find',
  bookmark: 'bookmark',
  'bookmarks-bar': 'bookmarks-bar',
  reader: 'reader',
  'fill-password': 'passwords',
  assistant: 'assistant',
  'new-window': 'new-window',
  'task-manager': 'task-manager',
  'link-hints': 'link-hints',
  'open-file': 'open-file',
  'view-source': 'view-source',
  'search-tabs': 'search-tabs',
  history: 'history',
  bookmarks: 'bookmarks',
  downloads: 'downloads',
  settings: 'settings',
  screenshot: 'screenshot',
  print: 'print',
  fullscreen: 'fullscreen',
  devtools: 'devtools',
  'save-page': 'save-page',
  'clear-data': 'clear-data',
  'go-home': 'home'
}
