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
  /** Just for enjoyment, rather than for fixing a problem. */
  fun?: boolean
}

/** Experimental switches, applied when the browser starts. */
export const BROWSER_FLAGS: BrowserFlag[] = [
  { id: 'no-gpu', name: 'Turn off hardware acceleration', description: 'Try this if pages flicker or the window draws incorrectly.' },
  { id: 'no-smooth-scrolling', name: 'Turn off smooth scrolling', description: 'Pages jump when scrolled instead of gliding.' },
  { id: 'force-dark-pages', name: 'Force dark pages', description: 'Darkens websites that have no dark theme of their own.' },
  { id: 'site-colours', fun: true, name: 'Site colours', description: 'The toolbar takes on a tint of the colour each website asks for.' },
  { id: 'day-cycle', fun: true, name: 'Accent follows the sun', description: 'The accent colour drifts through the day, from indigo nights to a warm dusk.' },
  { id: 'aurora', fun: true, name: 'Aurora new tab', description: 'Slow northern lights behind a new tab, when it has no colour or picture of its own.' },
  { id: 'retro-screen', fun: true, name: 'Retro screen', description: 'Faint scanlines and darker corners on scTerra’s own screens, like an old monitor.' },
  { id: 'wobbly-tabs', fun: true, name: 'Wobbly tabs', description: 'Tabs give a little wiggle when the pointer lands on them.' },
  { id: 'clicky-keys', fun: true, name: 'Clicky address bar', description: 'Typing in the address bar sounds like a mechanical keyboard.' },
  { id: 'download-sparkles', fun: true, name: 'Download sparkles', description: 'A small burst from the downloads button when a download finishes.' }
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
