import type { Settings } from '@scbrowser/shared'

interface FocusStore {
  get: () => Settings
  set: (patch: Partial<Settings>) => void
  subscribe: (listener: (settings: Settings) => void) => () => void
}

/** Longest a timeout can wait in one go. */
const MAX_WAIT_MS = 2 ** 31 - 1

/** A study session's rounds: focus, then a short break, four times over. */
export const STUDY_FOCUS_MINUTES = 25
export const STUDY_BREAK_MINUTES = 5

export type StudyEvent = { kind: 'break'; round: number; rounds: number } | { kind: 'round'; round: number; rounds: number } | { kind: 'done'; rounds: number }

/**
 * A focus session: Focus Mode on until `focusUntil`, then off again by itself. The end time is a
 * setting, so a session survives a restart and one that ran out while closed ends at start.
 * Turning Focus Mode off by hand ends the session too. A study session is a run of these with a
 * break between each, kept in `studyRound` and `focusBreakUntil`.
 */
export function startFocusTimer(store: FocusStore, onEnd: () => void, now = () => Date.now(), onStudy: (event: StudyEvent) => void = () => undefined): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wait = (until: number, current: Settings) => {
    timer = setTimeout(() => check(store.get()), Math.min(until - now(), MAX_WAIT_MS))
    return current
  }
  const check = (current: Settings) => {
    clearTimeout(timer)
    if (current.focusBreakUntil > 0) {
      if (current.studyRound <= 0) return store.set({ focusBreakUntil: 0 })
      if (current.focusBreakUntil > now()) return void wait(current.focusBreakUntil, current)
      const round = current.studyRound + 1
      store.set({ focusBreakUntil: 0, focusMode: true, focusUntil: now() + STUDY_FOCUS_MINUTES * 60_000, studyRound: round })
      return onStudy({ kind: 'round', round, rounds: current.studyRounds })
    }
    if (current.focusUntil <= 0) {
      if (current.studyRound > 0 && !current.focusMode) store.set({ studyRound: 0 })
      return
    }
    if (!current.focusMode) return store.set({ focusUntil: 0, studyRound: 0 })
    const left = current.focusUntil - now()
    if (left > 0) return void wait(current.focusUntil, current)
    if (current.studyRound > 0 && current.studyRound < current.studyRounds) {
      store.set({ focusMode: false, focusUntil: 0, focusBreakUntil: now() + STUDY_BREAK_MINUTES * 60_000 })
      return onStudy({ kind: 'break', round: current.studyRound, rounds: current.studyRounds })
    }
    const studied = current.studyRound > 0
    store.set({ focusMode: false, focusUntil: 0, studyRound: 0 })
    return studied ? onStudy({ kind: 'done', rounds: current.studyRounds }) : onEnd()
  }
  const unsubscribe = store.subscribe(check)
  check(store.get())
  return () => {
    clearTimeout(timer)
    unsubscribe()
  }
}

/** Starts round one of a study session. */
export const studySession = (rounds = 4) => ({ focusMode: true, focusUntil: Date.now() + STUDY_FOCUS_MINUTES * 60_000, focusBreakUntil: 0, studyRound: 1, studyRounds: rounds })

/** The lengths offered, in minutes. */
export const FOCUS_SESSION_MINUTES = [15, 25, 50] as const
