/** Mouse gestures: hold the right button and draw. Paths are the directions drawn, L R U D in order. */
export const GESTURE_ACTIONS = [
  { id: 'back', label: 'Back', path: 'L' },
  { id: 'forward', label: 'Forward', path: 'R' },
  { id: 'top', label: 'Scroll to the top', path: 'U' },
  { id: 'bottom', label: 'Scroll to the bottom', path: 'D' },
  { id: 'reload', label: 'Reload', path: 'UD' },
  { id: 'close', label: 'Close tab', path: 'DR' },
  { id: 'new-tab', label: 'New tab', path: 'DU' },
  { id: 'reopen', label: 'Reopen closed tab', path: 'UL' }
] as const

export type GestureAction = (typeof GESTURE_ACTIONS)[number]['id']

/** What a drawn path does, if anything. */
export const gestureFrom = (path: string): GestureAction | null => GESTURE_ACTIONS.find((gesture) => gesture.path === path)?.id ?? null

export const isGestureAction = (value: unknown): value is GestureAction => GESTURE_ACTIONS.some((gesture) => gesture.id === value)

/** A path as arrows, for Settings. */
export const gestureArrows = (path: string): string => [...path].map((step) => ({ L: '←', R: '→', U: '↑', D: '↓' })[step] ?? step).join(' ')

/** What a website's preload asks for once per page: the switches it needs to know about. */
export interface PagePrefs {
  globalPrivacyControl: boolean
  mouseGestures: boolean
  middleClickScroll: boolean
  /** The page may use Widevine. False when protected content is off, everywhere or for its site. */
  protectedContent: boolean
  /** Sound and video wait for the person to press something on the page first. */
  blockAutoplay: boolean
}
