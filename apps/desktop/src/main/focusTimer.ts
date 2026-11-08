import type { Settings } from '@scbrowser/shared'

interface FocusStore {
  get: () => Settings
  set: (patch: Partial<Settings>) => void
  subscribe: (listener: (settings: Settings) => void) => () => void
}

/** Longest a timeout can wait in one go. */
const MAX_WAIT_MS = 2 ** 31 - 1

/**
 * A focus session: Focus Mode on until `focusUntil`, then off again by itself. The end time is a
 * setting, so a session survives a restart and one that ran out while closed ends at start.
 * Turning Focus Mode off by hand ends the session too.
 */
export function startFocusTimer(store: FocusStore, onEnd: () => void, now = () => Date.now()): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = (current: Settings) => {
    clearTimeout(timer)
    if (current.focusUntil <= 0) return
    if (!current.focusMode) return store.set({ focusUntil: 0 })
    const left = current.focusUntil - now()
    if (left <= 0) {
      store.set({ focusMode: false, focusUntil: 0 })
      return onEnd()
    }
    timer = setTimeout(() => check(store.get()), Math.min(left, MAX_WAIT_MS))
  }
  const unsubscribe = store.subscribe(check)
  check(store.get())
  return () => {
    clearTimeout(timer)
    unsubscribe()
  }
}

/** The lengths offered, in minutes. */
export const FOCUS_SESSION_MINUTES = [15, 25, 50] as const
