import { describe, expect, it } from 'vitest'
import { splitByDay, stopwatch, studyDays, studyStreak, type StudySummary } from '@scbrowser/shared'
import { StudyService } from './study'
import type { KeyValueRepo } from './storage/kv'

const memoryKv = () => {
  const map = new Map<string, unknown>()
  return { get: (key: string) => map.get(key), set: (key: string, value: unknown) => void map.set(key, value) } as unknown as KeyValueRepo
}

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()

function service(start = at(13, 9)) {
  let now = start
  let idle = 0
  let focus = false
  const said: string[] = []
  const changes: StudySummary[] = []
  const kv = memoryKv()
  const make = () =>
    new StudyService({ kv, idleSeconds: () => idle, focusMode: () => focus, setFocusMode: (on) => (focus = on), onChange: (summary) => changes.push(summary), notify: (text) => said.push(text), now: () => now, timers: false })
  const study = make()
  return {
    study,
    make,
    kv,
    said,
    changes,
    advance: (ms: number) => (now += ms),
    setIdle: (seconds: number) => (idle = seconds),
    focus: () => focus,
    setFocus: (on: boolean) => (focus = on)
  }
}

describe('study timer', () => {
  it('adds each session to the day, by subject', () => {
    const t = service()
    const [first] = t.study.subjects()
    t.study.saveSubject(null, { name: 'Maths', hue: 38 })
    const maths = t.study.subjects()[1]!
    t.study.start(first!.id)
    t.advance(30 * 60_000)
    t.study.start(maths.id)
    t.advance(15 * 60_000)
    t.study.stop()
    const today = t.study.state().days.at(-1)!
    expect(today.total).toBe(45 * 60_000)
    expect(today.bySubject[maths.id]).toBe(15 * 60_000)
    expect(t.study.state().today).toHaveLength(2)
    expect(t.study.summary()).toMatchObject({ running: null, todayBefore: 45 * 60_000 })
  })

  it('drops accidental clicks shorter than ten seconds', () => {
    const t = service()
    t.study.start(t.study.subjects()[0]!.id)
    t.advance(4_000)
    t.study.stop()
    expect(t.study.state().today).toHaveLength(0)
  })

  it('pauses after the person has been away, leaving the time away out', () => {
    const t = service()
    t.study.setPrefs({ idleMinutes: 5 })
    t.study.start(t.study.subjects()[0]!.id)
    t.advance(20 * 60_000)
    t.setIdle(6 * 60)
    t.study.tick()
    expect(t.study.running()).toBeNull()
    expect(t.study.state().days.at(-1)!.total).toBe(14 * 60_000)
    expect(t.study.state().pausedReason).toBe('away')
    expect(t.said[0]).toContain('away for 6 minutes')
  })

  it('turns Focus Mode on while timing, and only turns off what it turned on', () => {
    const t = service()
    t.study.setPrefs({ focusMode: true })
    const id = t.study.subjects()[0]!.id
    t.study.start(id)
    expect(t.focus()).toBe(true)
    t.advance(60_000)
    t.study.stop()
    expect(t.focus()).toBe(false)

    t.setFocus(true)
    t.study.start(id)
    t.advance(60_000)
    t.study.stop()
    expect(t.focus()).toBe(true)
  })

  it('ends a timer left running at the last heartbeat when scTerra starts again', () => {
    const t = service()
    t.study.setPrefs({ focusMode: true })
    t.study.start(t.study.subjects()[0]!.id)
    t.advance(10 * 60_000)
    t.study.tick()
    t.advance(3 * 3_600_000)
    const again = t.make()
    expect(again.running()).toBeNull()
    expect(again.state().days.at(-1)!.total).toBe(10 * 60_000)
    expect(t.focus()).toBe(false)
  })

  it('splits a session over midnight between both days', () => {
    expect(splitByDay(at(12, 23, 30), at(13, 0, 45))).toEqual([
      { day: '2026-11-12', ms: 30 * 60_000 },
      { day: '2026-11-13', ms: 45 * 60_000 }
    ])
    const days = studyDays([{ subjectId: 'a', start: at(12, 23, 30), end: at(13, 0, 45) }], at(13, 10), 3)
    expect(days.map((day) => day.total / 60_000)).toEqual([0, 30, 45])
  })

  it('counts a streak back from today, or from yesterday while today is empty', () => {
    const day = (total: number) => ({ day: '', total, bySubject: {} })
    expect(studyStreak([day(1), day(0), day(1), day(1), day(1)])).toBe(3)
    expect(studyStreak([day(1), day(1), day(0)])).toBe(2)
    expect(studyStreak([day(1), day(0), day(0)])).toBe(0)
  })

  it('shows hours only when there are some', () => {
    expect(stopwatch(65_000)).toBe('1:05')
    expect(stopwatch(3_725_000)).toBe('1:02:05')
  })

  it('removing the running subject stops the timer and keeps its time', () => {
    const t = service()
    const id = t.study.subjects()[0]!.id
    t.study.start(id)
    t.advance(5 * 60_000)
    t.study.removeSubject(id)
    expect(t.study.running()).toBeNull()
    expect(t.study.state().days.at(-1)!.total).toBe(5 * 60_000)
  })
})

describe('focus timer countdown', () => {
  it('runs rounds with breaks, turning Focus Mode off for each break and on for each round', () => {
    const t = service()
    t.study.setPrefs({ mode: 'countdown', focusMinutes: 25, breakMinutes: 5, rounds: 2, focusMode: true })
    const id = t.study.subjects()[0]!.id
    t.study.start(id)
    expect(t.study.running()).toMatchObject({ round: 1, rounds: 2 })
    expect(t.focus()).toBe(true)
    t.advance(26 * 60_000)
    t.study.tick()
    expect(t.study.running()).toBeNull()
    expect(t.study.onBreak()).toMatchObject({ round: 2, rounds: 2 })
    expect(t.focus()).toBe(false)
    // The round counts up to its end, not to when the tick came.
    expect(t.study.state().days.at(-1)!.total).toBe(25 * 60_000)
    t.advance(5 * 60_000)
    t.study.tick()
    expect(t.study.running()).toMatchObject({ round: 2, rounds: 2 })
    expect(t.focus()).toBe(true)
    t.advance(25 * 60_000)
    t.study.tick()
    expect(t.study.running()).toBeNull()
    expect(t.study.onBreak()).toBeNull()
    expect(t.focus()).toBe(false)
    expect(t.said.at(-1)).toContain('All 2 rounds done')
    expect(t.study.summary().todayBefore).toBe(50 * 60_000)
  })

  it('counts blocked sites tried while the timer runs', () => {
    const t = service()
    t.study.noteDistraction('https://www.youtube.com/watch?v=1')
    t.study.start(t.study.subjects()[0]!.id)
    t.study.noteDistraction('https://www.youtube.com/watch?v=1')
    t.study.noteDistraction('https://youtube.com/')
    t.study.noteDistraction('https://reddit.com/r/all')
    expect(t.study.state().distractions).toEqual([
      { host: 'youtube.com', count: 2 },
      { host: 'reddit.com', count: 1 }
    ])
    t.advance(60_000)
    t.study.stop()
    expect(t.study.state().distractions[0]).toEqual({ host: 'youtube.com', count: 2 })
    expect(t.study.weekText()).toContain('youtube.com (2)')
  })
})
