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
export const TOOLBAR_SLOTS = ['back', 'forward', 'reload', 'vpn', 'omnibox', 'split', 'downloads', 'passwords', 'extensions'] as const

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
  { id: 'force-dark-pages', name: 'Force dark pages', description: 'Darkens websites that have no dark theme of their own, keeping pictures and video as they are.' },
  { id: 'site-colours', fun: true, name: 'Site colours', description: 'The toolbar takes on a tint of the colour each website asks for.' },
  { id: 'day-cycle', fun: true, name: 'Accent follows the sun', description: 'The accent colour drifts through the day, from indigo nights to a warm dusk.' },
  { id: 'aurora', fun: true, name: 'Aurora new tab', description: 'Slow northern lights behind a new tab, when it has no colour or picture of its own.' },
  { id: 'retro-screen', fun: true, name: 'Retro screen', description: 'Faint scanlines and darker corners on scTerra’s own screens, like an old monitor.' },
  { id: 'wobbly-tabs', fun: true, name: 'Wobbly tabs', description: 'Tabs give a little wiggle when the pointer lands on them.' },
  { id: 'clicky-keys', fun: true, name: 'Clicky address bar', description: 'Typing in the address bar sounds like a mechanical keyboard.' },
  { id: 'download-sparkles', fun: true, name: 'Download sparkles', description: 'A small burst from the downloads button when a download finishes.' },
  { id: 'snowfall', fun: true, name: 'Snowfall', description: 'Gentle snow drifts down behind a new tab.' },
  { id: 'starry-night', fun: true, name: 'Starry night', description: 'Twinkling stars behind a new tab, when it has no picture of its own.' },
  { id: 'rainbow-loading', fun: true, name: 'Rainbow loading', description: 'Loading tabs spin through every colour.' },
  { id: 'disco-accent', fun: true, name: 'Disco accent', description: 'The accent colour slowly cycles through the rainbow.' },
  { id: 'neon-address-bar', fun: true, name: 'Neon address bar', description: 'The address bar glows in the accent colour while you type.' },
  { id: 'squishy-buttons', fun: true, name: 'Squishy buttons', description: 'Buttons squash a little when pressed.' },
  { id: 'typewriter', fun: true, name: 'Typewriter', description: 'scTerra’s own screens use a monospaced typewriter font.' }
]

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  /** Turned off keeps it installed, but it doesn't run. */
  enabled: boolean
  /** It shows its own page in place of the new tab page. */
  newTab: boolean
}

export interface ExtensionSummary {
  /** Whether extensions open in the panel under the toolbar, or their own windows and side panels. */
  display: 'panel' | 'window'
  /** Kept in the extensions menu rather than on the toolbar. */
  unpinned: string[]
  /** Clicking these extensions' buttons opens their side panel. */
  panelOnClick: string[]
}

export interface ExtensionPanelState {
  extensionId: string
  name: string
}

/** How an extension's `chrome.sidePanel` calls reach the main process. */
export const SIDE_PANEL_CHANNEL = 'scb:side-panel'
/** Main to extension pages and workers: a side panel opened or closed. */
export const SIDE_PANEL_EVENT = 'scb:side-panel-event'

export interface ImportSource {
  id: string
  name: string
}

export interface ImportResult {
  bookmarks: number
  history: number
}
