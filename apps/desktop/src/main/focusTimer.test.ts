import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@scbrowser/shared'
import { startFocusTimer } from './focusTimer'

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
