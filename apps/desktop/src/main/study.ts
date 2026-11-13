import { randomUUID } from 'node:crypto'
import {
  addDistraction,
  DEFAULT_STUDY_PREFS,
  DEFAULT_STUDY_SUBJECTS,
  focusWeekText,
  MAX_STUDY_SUBJECTS,
  MIN_STUDY_SESSION_MS,
  sanitizeStudyPrefs,
  STUDY_HISTORY_DAYS,
  studyDayKey,
  studyDays,
  studyStreak,
  sumDistractions,
  type StudyBreak,
  type StudyPrefs,
  type StudyRunning,
  type StudySession,
  type StudyState,
  type StudySubject,
  type StudySummary
} from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const SUBJECTS = 'study:subjects'
const SESSIONS = 'study:sessions'
const RUNNING = 'study:running'
const BREAK = 'study:break'
const PREFS = 'study:prefs'
/** When the running timer was last seen alive, so a crash or shutdown ends it there. */
const HEARTBEAT = 'study:heartbeat'
const TICK_MS = 20_000
/** Far more than anyone keeps a stopwatch running, but a guard against a clock jump. */
const MAX_SESSION_MS = 16 * 3_600_000
/** The longest wait one timeout can take. */
const MAX_WAIT_MS = 2 ** 31 - 1

export interface StudyDeps {
  kv: KeyValueRepo
  /** Seconds since the last key press or mouse move anywhere on the computer. */
  idleSeconds: () => number
  focusMode: () => boolean
  setFocusMode: (on: boolean) => void
  onChange: (summary: StudySummary) => void
  /** Said when the timer stops or moves on by itself. */
  notify: (text: string) => void
  now?: () => number
  /** Off in tests, which call `tick` themselves. */
  timers?: boolean
}

/** The focus timer. Kept on this computer and never synced. */
export class StudyService {
  private readonly timers: ReturnType<typeof setInterval>[] = []
  private wake: ReturnType<typeof setTimeout> | undefined
  private pausedReason: 'away' | null = null

  constructor(private readonly deps: StudyDeps) {
    this.recover()
    if (deps.timers === false) return
    const every = setInterval(() => this.tick(), TICK_MS)
    every.unref?.()
    this.timers.push(every)
    this.schedule()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  subjects(): StudySubject[] {
    const saved = this.deps.kv.get(SUBJECTS)
    if (Array.isArray(saved)) return saved as StudySubject[]
    const made = DEFAULT_STUDY_SUBJECTS.map((subject) => ({ ...subject, id: randomUUID() }))
    this.deps.kv.set(SUBJECTS, made)
    return made
  }

  private sessions(): StudySession[] {
    const saved = this.deps.kv.get(SESSIONS)
    return Array.isArray(saved) ? (saved as StudySession[]) : []
  }

  running(): StudyRunning | null {
    const saved = this.deps.kv.get(RUNNING) as StudyRunning | null | undefined
    return saved && typeof saved.startedAt === 'number' ? saved : null
  }

  onBreak(): StudyBreak | null {
    const saved = this.deps.kv.get(BREAK) as StudyBreak | null | undefined
    return saved && typeof saved.until === 'number' ? saved : null
  }

  prefs(): StudyPrefs {
    return sanitizeStudyPrefs(this.deps.kv.get(PREFS), DEFAULT_STUDY_PREFS)
  }

  /**
   * A timer left running when scTerra closed ends when it was last seen, not now, or at its
   * countdown's end if that came first. A break that was under way is dropped.
   */
  private recover(): void {
    const running = this.running()
    const paused = this.onBreak()
    if (paused) this.deps.kv.set(BREAK, null)
    if (!running) return
    const seen = this.deps.kv.get(HEARTBEAT)
    const last = typeof seen === 'number' && seen >= running.startedAt ? seen : running.startedAt
    this.finish(running, running.endsAt ? Math.min(last, running.endsAt) : last)
    if (running.focusModeByTimer && this.deps.focusMode()) this.deps.setFocusMode(false)
  }

  private finish(running: StudyRunning, end: number): void {
    this.deps.kv.set(RUNNING, null)
    const length = Math.min(end - running.startedAt, MAX_SESSION_MS)
    if (length < MIN_STUDY_SESSION_MS) return
    const oldest = this.now() - (STUDY_HISTORY_DAYS + 1) * 86_400_000
    const kept = this.sessions().filter((session) => session.end > oldest)
    const session: StudySession = { id: randomUUID(), subjectId: running.subjectId, start: running.startedAt, end: running.startedAt + length, ...(running.distractions ? { distractions: running.distractions } : {}) }
    this.deps.kv.set(SESSIONS, [...kept, session])
  }

  /**
   * Starts timing an activity, with the stopwatch or a countdown as the prefs say. `round` carries
   * a countdown on after its break; `mode` overrides the prefs, as the palette's countdown does.
   */
  start(subjectId: string, options: { round?: number; mode?: 'stopwatch' | 'countdown'; focusMode?: boolean } = {}): void {
    if (!this.subjects().some((subject) => subject.id === subjectId)) throw new Error('That activity is gone.')
    const current = this.running()
    const prefs = this.prefs()
    const mode = options.mode ?? prefs.mode
    if (current?.subjectId === subjectId && options.round === undefined && (mode === 'countdown') === !!current.endsAt) return
    const previous = this.onBreak()
    if (current) this.finish(current, this.now())
    this.deps.kv.set(BREAK, null)
    // A countdown's break lets blocked sites through; the next round blocks them again.
    const turnOn = ((options.focusMode ?? prefs.focusMode) || !!previous?.focusModeByTimer) && !this.deps.focusMode()
    const keep = current?.focusModeByTimer ?? previous?.focusModeByTimer ?? false
    const now = this.now()
    const countdown = mode === 'countdown' ? { endsAt: now + prefs.focusMinutes * 60_000, round: options.round ?? 1, rounds: previous?.rounds ?? prefs.rounds } : {}
    this.deps.kv.set(RUNNING, { subjectId, startedAt: now, focusModeByTimer: keep || turnOn, ...countdown } satisfies StudyRunning)
    this.deps.kv.set(HEARTBEAT, now)
    this.pausedReason = null
    if (turnOn) this.deps.setFocusMode(true)
    this.changed()
  }

  /** Stops the timer, keeping the time so far. `at` ends it earlier, as when the person walked away. */
  stop(at = this.now(), reason: 'away' | null = null): void {
    const running = this.running()
    const paused = this.onBreak()
    if (!running && !paused) return
    if (running) this.finish(running, Math.max(running.startedAt, Math.min(at, this.now())))
    this.deps.kv.set(BREAK, null)
    this.pausedReason = reason
    if (running?.focusModeByTimer && this.deps.focusMode()) this.deps.setFocusMode(false)
    this.changed()
  }

  /** A blocked site was tried while the timer ran. Counted by host. */
  noteDistraction(url: string): void {
    const running = this.running()
    if (!running || !URL.canParse(url)) return
    const host = new URL(url).hostname.replace(/^www\./, '')
    this.deps.kv.set(RUNNING, { ...running, distractions: addDistraction(running.distractions, host) })
  }

  /**
   * Keeps the heartbeat fresh, ends countdown rounds and breaks on time, and pauses the timer once
   * the person has been away long enough.
   */
  tick(): void {
    const now = this.now()
    const paused = this.onBreak()
    if (paused && now >= paused.until) {
      if (this.subjects().some((subject) => subject.id === paused.subjectId)) {
        this.start(paused.subjectId, { round: paused.round, mode: 'countdown', focusMode: false })
        this.deps.notify(`Break over. Round ${paused.round} of ${paused.rounds}: ${this.prefs().focusMinutes} minutes.`)
      } else {
        this.deps.kv.set(BREAK, null)
        this.changed()
      }
      return this.schedule()
    }
    const running = this.running()
    if (!running) return
    if (running.endsAt && now >= running.endsAt) {
      this.finish(running, running.endsAt)
      const round = running.round ?? 1
      const rounds = running.rounds ?? 1
      if (round < rounds) {
        const breakMinutes = this.prefs().breakMinutes
        this.deps.kv.set(BREAK, { subjectId: running.subjectId, until: running.endsAt + breakMinutes * 60_000, round: round + 1, rounds, focusModeByTimer: running.focusModeByTimer } satisfies StudyBreak)
        if (running.focusModeByTimer && this.deps.focusMode()) this.deps.setFocusMode(false)
        this.deps.notify(`Round ${round} of ${rounds} done. Take a ${breakMinutes}-minute break.`)
      } else {
        if (running.focusModeByTimer && this.deps.focusMode()) this.deps.setFocusMode(false)
        this.deps.notify(rounds > 1 ? `All ${rounds} rounds done. Nice work.` : 'Countdown done. Nice work.')
      }
      this.changed()
      return this.schedule()
    }
    const idleMinutes = this.prefs().idleMinutes
    const idle = this.deps.idleSeconds()
    if (idleMinutes > 0 && idle >= idleMinutes * 60) {
      this.stop(now - idle * 1000, 'away')
      this.deps.notify(`Focus timer paused: you were away for ${Math.round(idle / 60)} minutes. That time isn't counted.`)
      return
    }
    this.deps.kv.set(HEARTBEAT, now)
  }

  /** Wakes exactly when a countdown or break ends, rather than at the next regular tick. */
  private schedule(): void {
    clearTimeout(this.wake)
    if (this.deps.timers === false) return
    const due = this.running()?.endsAt ?? this.onBreak()?.until
    if (!due) return
    this.wake = setTimeout(() => this.tick(), Math.min(Math.max(0, due - this.now()) + 50, MAX_WAIT_MS))
    this.wake.unref?.()
  }

  /** The activity timed most recently, or the first one. */
  lastSubject(): StudySubject | null {
    const subjects = this.subjects()
    const last = this.sessions().at(-1)?.subjectId
    return subjects.find((subject) => subject.id === last) ?? subjects[0] ?? null
  }

  saveSubject(id: string | null, input: Omit<StudySubject, 'id'>): void {
    const all = this.subjects()
    const subject = { name: input.name.trim(), hue: input.hue }
    if (id === null) {
      if (all.length >= MAX_STUDY_SUBJECTS) throw new Error(`You can have ${MAX_STUDY_SUBJECTS} activities at most.`)
      this.deps.kv.set(SUBJECTS, [...all, { ...subject, id: randomUUID() }])
    } else {
      this.deps.kv.set(SUBJECTS, all.map((other) => (other.id === id ? { ...other, ...subject } : other)))
    }
    this.changed()
  }

  /** Removes an activity. Its past time stays in the totals, under "Removed activity". */
  removeSubject(id: string): void {
    if (this.running()?.subjectId === id || this.onBreak()?.subjectId === id) this.stop()
    this.deps.kv.set(SUBJECTS, this.subjects().filter((subject) => subject.id !== id))
    this.changed()
  }

  removeSession(id: string): void {
    this.deps.kv.set(SESSIONS, this.sessions().filter((session) => session.id !== id))
    this.changed()
  }

  setPrefs(patch: unknown): void {
    this.deps.kv.set(PREFS, sanitizeStudyPrefs(patch, this.prefs()))
    this.changed()
  }

  state(): StudyState {
    const now = this.now()
    const sessions = this.sessions()
    const days = studyDays(sessions, now)
    const today = studyDayKey(now)
    const todays = sessions.filter((session) => studyDayKey(session.end) === today || studyDayKey(session.start) === today)
    const running = this.running()
    return {
      subjects: this.subjects(),
      running,
      onBreak: this.onBreak(),
      prefs: this.prefs(),
      today: todays.toSorted((a, b) => b.start - a.start),
      days,
      streak: studyStreak(days),
      pausedReason: this.pausedReason,
      distractions: sumDistractions([...todays.map((session) => session.distractions), running?.distractions]),
      now
    }
  }

  /** The last seven days in words, for the weekly recap brief. Null when there's nothing to say. */
  weekText(): string | null {
    const state = this.state()
    if (state.days.slice(-14).every((day) => day.total === 0)) return null
    return focusWeekText(state, this.sessions(), state.now)
  }

  summary(): StudySummary {
    const now = this.now()
    const running = this.running()
    const paused = this.onBreak()
    const subjectId = running?.subjectId ?? paused?.subjectId
    const subject = subjectId ? this.subjects().find((other) => other.id === subjectId) : undefined
    const todayBefore = studyDays(this.sessions(), now, 1)[0]!.total
    // A session started before midnight only counts from midnight today.
    const midnight = new Date(now).setHours(0, 0, 0, 0)
    return {
      running: running ? { subject: subject?.name ?? 'Focus', hue: subject?.hue ?? 200, startedAt: Math.max(running.startedAt, midnight), endsAt: running.endsAt ?? null, round: running.round ?? 1, rounds: running.rounds ?? 1 } : null,
      breakUntil: paused?.until ?? null,
      todayBefore,
      goalMinutes: this.prefs().goalMinutes
    }
  }

  private changed(): void {
    this.schedule()
    this.deps.onChange(this.summary())
  }

  /**
   * Leaves a running timer saved: the next start ends it at the last heartbeat, at most
   * `TICK_MS` ago, and turns Focus Mode back off. Nothing is written here, as the database may
   * already be closing.
   */
  destroy(): void {
    clearTimeout(this.wake)
    this.timers.forEach((timer) => clearInterval(timer))
  }
}
