export interface Container {
  id: string
  name: string
  /** Hue of the tab marker. */
  hue: number
}

/** Tabs in a container have their own cookies and site data, like Firefox containers. */
export const CONTAINERS: Container[] = [
  { id: 'personal', name: 'Personal', hue: 240 },
  { id: 'work', name: 'Work', hue: 40 },
  { id: 'shopping', name: 'Shopping', hue: 330 },
  { id: 'banking', name: 'Banking', hue: 150 }
]

export const containerPartition = (id: string) => `persist:container-${id}`

export const TOOLBAR_ITEMS = [
  { id: 'assistant', name: 'Assistant' },
  { id: 'reader', name: 'Reader view' },
  { id: 'bookmark', name: 'Bookmark star' },
  { id: 'protection', name: 'Tracking protection' }
] as const

export type ToolbarItemId = (typeof TOOLBAR_ITEMS)[number]['id']

/** What can be dragged around the toolbar. Profiles, the assistant and More stay at its end. */
export const TOOLBAR_SLOTS = ['back', 'forward', 'reload', 'vpn', 'omnibox', 'downloads', 'passwords', 'extensions'] as const

export type ToolbarSlot = (typeof TOOLBAR_SLOTS)[number]

export const isToolbarOrder = (value: unknown): value is ToolbarSlot[] =>
  Array.isArray(value) && value.length === new Set(value).size && value.every((slot) => TOOLBAR_SLOTS.includes(slot))

/** Slots added by a later version go at the end, so a saved order never hides one. */
export const fullToolbarOrder = (order: readonly ToolbarSlot[]): ToolbarSlot[] => [...order, ...TOOLBAR_SLOTS.filter((slot) => !order.includes(slot))]

export interface BrowserFlag {
  id: string
  name: string
  description: string
}

/** Experimental switches, applied when the browser starts. */
export const BROWSER_FLAGS: BrowserFlag[] = [
  { id: 'no-gpu', name: 'Turn off hardware acceleration', description: 'Try this if pages flicker or the window draws incorrectly.' },
  { id: 'no-smooth-scrolling', name: 'Turn off smooth scrolling', description: 'Pages jump when scrolled instead of gliding.' },
  { id: 'force-dark-pages', name: 'Force dark pages', description: 'Darkens websites that have no dark theme of their own.' }
]

export interface ExtensionInfo {
  id: string
  name: string
  version: string
}

export interface ImportSource {
  id: string
  name: string
}

export interface ImportResult {
  bookmarks: number
  history: number
}
