import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@scbrowser/shared'
import { startFocusTimer, studySession, STUDY_BREAK_MINUTES, STUDY_FOCUS_MINUTES } from './focusTimer'

function store(initial: Partial<Settings>) {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial }
  const listeners = new Set<(s: Settings) => void>()
  return {
    get: () => settings,
    set: (patch: Partial<Settings>) => {
      settings = { ...settings, ...patch }
      listeners.forEach((listener) => listener(settings))
    },
    subscribe: (listener: (s: Settings) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

describe('focus sessions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('turn Focus Mode off when the time is up, and say so', () => {
    const settings = store({})
    const ended = vi.fn()
    startFocusTimer(settings, ended)
    settings.set({ focusMode: true, focusUntil: Date.now() + 25 * 60_000 })
    vi.advanceTimersByTime(24 * 60_000)
    expect(settings.get().focusMode).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(settings.get()).toMatchObject({ focusMode: false, focusUntil: 0 })
    expect(ended).toHaveBeenCalledOnce()
  })

  it('end at start when the time ran out while closed', () => {
    const settings = store({ focusMode: true, focusUntil: Date.now() - 1 })
    startFocusTimer(settings, () => {})
    expect(settings.get().focusMode).toBe(false)
  })

  it('end the session when Focus Mode is turned off by hand', () => {
    const settings = store({ focusMode: true, focusUntil: Date.now() + 60_000 })
    const ended = vi.fn()
    startFocusTimer(settings, ended)
    settings.set({ focusMode: false })
    expect(settings.get().focusUntil).toBe(0)
    vi.advanceTimersByTime(120_000)
    expect(ended).not.toHaveBeenCalled()
  })
})

describe('study sessions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs rounds of focus with breaks between, then ends', () => {
    const settings = store({})
    const ended = vi.fn()
    const events: string[] = []
    startFocusTimer(settings, ended, undefined, (event) => events.push(`${event.kind}${'round' in event ? event.round : ''}`))
    settings.set({ ...studySession(2) })
    expect(settings.get()).toMatchObject({ focusMode: true, studyRound: 1 })
    vi.advanceTimersByTime(STUDY_FOCUS_MINUTES * 60_000)
    expect(settings.get()).toMatchObject({ focusMode: false, studyRound: 1 })
    expect(settings.get().focusBreakUntil).toBeGreaterThan(0)
    vi.advanceTimersByTime(STUDY_BREAK_MINUTES * 60_000)
    expect(settings.get()).toMatchObject({ focusMode: true, studyRound: 2, focusBreakUntil: 0 })
    vi.advanceTimersByTime(STUDY_FOCUS_MINUTES * 60_000)
    expect(settings.get()).toMatchObject({ focusMode: false, studyRound: 0, focusBreakUntil: 0, focusUntil: 0 })
    expect(events).toEqual(['break1', 'round2', 'done'])
    expect(ended).not.toHaveBeenCalled()
  })

  it('stops the whole session when Focus Mode is turned off by hand', () => {
    const settings = store({})
    startFocusTimer(settings, vi.fn())
    settings.set({ ...studySession() })
    settings.set({ focusMode: false })
    expect(settings.get()).toMatchObject({ studyRound: 0, focusUntil: 0 })
    vi.advanceTimersByTime(60 * 60_000)
    expect(settings.get().focusMode).toBe(false)
  })
})
