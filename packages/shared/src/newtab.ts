export const NEW_TAB_WIDGETS = [
  { id: 'greeting', name: 'Greeting' },
  { id: 'clock', name: 'Clock' },
  { id: 'search', name: 'Search' },
  { id: 'ai', name: 'Quick AI' },
  { id: 'shortcuts', name: 'Shortcuts' },
  { id: 'bookmarks', name: 'Bookmarks' },
  { id: 'notes', name: 'Notes' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'downloads', name: 'Recent downloads' },
  { id: 'reading', name: 'Reading list' },
  { id: 'watching', name: 'Watched pages' }
] as const

export type NewTabWidgetId = (typeof NEW_TAB_WIDGETS)[number]['id']

export interface NewTabWidget {
  id: NewTabWidgetId
  size: 'full' | 'half'
}

export interface NewTabLink {
  title: string
  url: string
}

export interface NewTabConfig {
  /** Only these are shown, in this order. */
  widgets: NewTabWidget[]
  background: 'none' | 'color' | 'image'
  /** `#rrggbb`, for the colour background. */
  color: string
  /** Changes with each new picture, so the old one isn't served from cache. */
  imageVersion: number
  /** How much the background is darkened, as a percentage. */
  dim: number
  /** Blur on the picture, in pixels. */
  blur: number
  clock24: boolean
  clockSeconds: boolean
  /** Used in the greeting. */
  name: string
  align: 'center' | 'top'
  width: 'narrow' | 'wide'
  links: NewTabLink[]
  /** Fill the shortcuts with the most visited sites. */
  topSites: boolean
  notes: string
}

export const DEFAULT_NEW_TAB: NewTabConfig = {
  widgets: [
    { id: 'clock', size: 'full' },
    { id: 'greeting', size: 'full' },
    { id: 'search', size: 'full' },
    { id: 'ai', size: 'full' },
    { id: 'shortcuts', size: 'full' }
  ],
  background: 'none',
  color: '#2f3b45',
  imageVersion: 0,
  dim: 25,
  blur: 0,
  clock24: false,
  clockSeconds: false,
  name: '',
  align: 'center',
  width: 'narrow',
  links: [],
  topSites: true,
  notes: ''
}

export const MAX_NEW_TAB_LINKS = 12
export const MAX_NOTES_LENGTH = 8000
export const MAX_BACKGROUND_BYTES = 25 * 1024 * 1024

const isLink = (value: unknown): value is NewTabLink => {
  const link = value as NewTabLink | null
  return typeof link?.title === 'string' && link.title.length <= 80 && typeof link.url === 'string' && link.url.length <= 2048 && /^https?:\/\//i.test(link.url)
}

const isWidgets = (value: unknown): value is NewTabWidget[] =>
  Array.isArray(value) &&
  new Set(value.map((w: NewTabWidget) => w?.id)).size === value.length &&
  value.every((w: NewTabWidget) => NEW_TAB_WIDGETS.some(({ id }) => id === w?.id) && (w.size === 'full' || w.size === 'half'))

const inRange = (value: unknown, max: number) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max

const fields: { [K in keyof NewTabConfig]: (value: unknown) => boolean } = {
  widgets: isWidgets,
  background: (v) => v === 'none' || v === 'color' || v === 'image',
  color: (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
  imageVersion: (v) => Number.isSafeInteger(v) && (v as number) >= 0,
  dim: (v) => inRange(v, 80),
  blur: (v) => inRange(v, 24),
  clock24: (v) => typeof v === 'boolean',
  clockSeconds: (v) => typeof v === 'boolean',
  name: (v) => typeof v === 'string' && v.length <= 40,
  align: (v) => v === 'center' || v === 'top',
  width: (v) => v === 'narrow' || v === 'wide',
  links: (v) => Array.isArray(v) && v.length <= MAX_NEW_TAB_LINKS && v.every(isLink),
  topSites: (v) => typeof v === 'boolean',
  notes: (v) => typeof v === 'string' && v.length <= MAX_NOTES_LENGTH
}

/** Fields added in later versions may be missing from stored settings, but none may be wrong. */
export const isNewTabConfig = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  Object.entries(value).every(([key, field]) => Object.hasOwn(fields, key) && fields[key as keyof NewTabConfig](field))

/** The picture's real type, from its first bytes. SVG is left out because it can hold scripts. */
export function imageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return 'image/avif'
  return null
}

/** Whether light text reads better than dark on a `#rrggbb` colour. */
export function isDarkColor(color: string): boolean {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16))
  return 0.299 * r! + 0.587 * g! + 0.114 * b! < 140
}
