/**
 * The focus timer: a stopwatch or countdown per activity (called a subject in the code) that adds
 * up the day's focused time. It's for anyone: studying, writing, coding, practising. Sessions are
 * kept on this computer only, as start and end times, and every total is worked out from them in
 * local time, so a session over midnight counts towards both days.
 */

export interface StudySubject {
  id: string
  name: string
  /** A hue for its colour, from `STUDY_HUES`. */
  hue: number
}

export interface StudySession {
  id: string
  subjectId: string
  start: number
  end: number
  /** Blocked sites tried during the session, by host. */
  distractions?: Record<string, number>
  /** Times the person took "one more minute" on a blocked site during it. */
  gaveIn?: number
}

export interface StudyRunning {
  subjectId: string
  startedAt: number
  /** Focus Mode was turned on by the timer, so it's turned off again when the timer stops. */
  focusModeByTimer: boolean
  /** A countdown's end. Absent for the stopwatch. */
  endsAt?: number
  round?: number
  rounds?: number
  distractions?: Record<string, number>
  gaveIn?: number
}

/** The break between two countdown rounds. The next round starts by itself when it's over. */
export interface StudyBreak {
  subjectId: string
  until: number
  /** The round that comes next. */
  round: number
  rounds: number
  focusModeByTimer: boolean
}

export type StudyMode = 'stopwatch' | 'countdown'

export interface StudyPrefs {
  /** Minutes a day the person means to study. 0 for no goal. */
  goalMinutes: number
  /** The timer pauses itself after this many minutes with no keyboard or mouse. 0 never pauses. */
  idleMinutes: number
  /** Turns Focus Mode on while the timer runs. */
  focusMode: boolean
  mode: StudyMode
  /** A countdown round, then a break, this many times. */
  focusMinutes: number
  breakMinutes: number
  rounds: number
}

export interface StudyDay {
  /** Local date as `YYYY-MM-DD`. */
  day: string
  total: number
  /** Milliseconds by subject id. */
  bySubject: Record<string, number>
}

export interface StudyState {
  subjects: StudySubject[]
  running: StudyRunning | null
  /** Between countdown rounds. */
  onBreak: StudyBreak | null
  prefs: StudyPrefs
  /** Finished sessions from today, newest first. */
  today: StudySession[]
  /** The last `STUDY_HISTORY_DAYS` days, oldest first, ending today. Today leaves out the running session. */
  days: StudyDay[]
  /** Days in a row with any study, up to and including today, or up to yesterday if today has none yet. */
  streak: number
  /** Why the timer last stopped by itself, shown until the next start. */
  pausedReason: 'away' | null
  /** Blocked sites tried today while the timer ran, most first. */
  distractions: { host: string; count: number }[]
  /** "One more minute" passes taken today while the timer ran. */
  gaveIn: number
  now: number
}

/** What the toolbar needs. */
export interface StudySummary {
  running: { subject: string; hue: number; startedAt: number; endsAt: number | null; round: number; rounds: number } | null
  /** Between countdown rounds: when the break ends. */
  breakUntil: number | null
  /** What Start would time when nothing runs: the last activity, or the first. */
  next: { subject: string; hue: number } | null
  mode: StudyMode
  /** Today's finished study, not counting the running session. */
  todayBefore: number
  goalMinutes: number
}

export const STUDY_HUES = [200, 155, 38, 285, 0, 240, 95, 330] as const
export const MAX_STUDY_SUBJECTS = 24
export const MAX_STUDY_SUBJECT_NAME = 40
export const STUDY_HISTORY_DAYS = 84
/** Sessions shorter than this are dropped as accidental clicks. */
export const MIN_STUDY_SESSION_MS = 10_000
export const DEFAULT_STUDY_PREFS: StudyPrefs = { goalMinutes: 180, idleMinutes: 5, focusMode: false, mode: 'stopwatch', focusMinutes: 25, breakMinutes: 5, rounds: 4 }
export const STUDY_FOCUS_CHOICES = [15, 20, 25, 30, 45, 50, 60, 90] as const
export const STUDY_BREAK_CHOICES = [3, 5, 10, 15, 20] as const
export const STUDY_ROUND_CHOICES = [1, 2, 3, 4, 6, 8] as const
export const STUDY_GOALS = [0, 60, 120, 180, 240, 300, 360, 480] as const
export const STUDY_IDLE_CHOICES = [0, 2, 5, 10, 15] as const
export const DEFAULT_STUDY_SUBJECTS: Omit<StudySubject, 'id'>[] = [{ name: 'Focus', hue: 200 }]

export const studyDayKey = (time: number): string => {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const startOfDay = (time: number) => {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const nextDay = (dayStart: number) => {
  const date = new Date(dayStart)
  date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** Splits a stretch of time at each local midnight. */
export function splitByDay(start: number, end: number): { day: string; ms: number }[] {
  const parts: { day: string; ms: number }[] = []
  let from = start
  while (from < end) {
    const to = Math.min(end, nextDay(startOfDay(from)))
    parts.push({ day: studyDayKey(from), ms: to - from })
    from = to
  }
  return parts
}

/** Totals for each of the last `count` days, oldest first, ending on the day of `now`. */
export function studyDays(sessions: Pick<StudySession, 'subjectId' | 'start' | 'end'>[], now: number, count = STUDY_HISTORY_DAYS): StudyDay[] {
  const days: StudyDay[] = []
  const date = new Date(startOfDay(now))
  date.setDate(date.getDate() - (count - 1))
  for (let i = 0; i < count; i++) {
    days.push({ day: studyDayKey(date.getTime()), total: 0, bySubject: {} })
    date.setDate(date.getDate() + 1)
  }
  const index = new Map(days.map((day, i) => [day.day, i]))
  for (const session of sessions) {
    for (const part of splitByDay(session.start, session.end)) {
      const at = index.get(part.day)
      if (at === undefined) continue
      const day = days[at]!
      day.total += part.ms
      day.bySubject[session.subjectId] = (day.bySubject[session.subjectId] ?? 0) + part.ms
    }
  }
  return days
}

/** Days in a row with study, counting back from today, or from yesterday while today is still empty. */
export function studyStreak(days: StudyDay[]): number {
  let at = days.length - 1
  if (at >= 0 && days[at]!.total === 0) at--
  let streak = 0
  while (at >= 0 && days[at]!.total > 0) {
    streak++
    at--
  }
  return streak
}

/** `1:05:09` for an hour or more, `5:09` below. */
export function stopwatch(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** `2 h 5 min`, `45 min`, `0 min`. */
export function studyDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** `10h 41m`, `45m`, `4h`: for tight spaces. */
export function shortDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`
}

export const goalLabel = (minutes: number) => (minutes === 0 ? 'No goal' : studyDuration(minutes * 60_000))

export const isStudySubjectInput = (value: unknown): value is Omit<StudySubject, 'id'> => {
  if (!value || typeof value !== 'object') return false
  const { name, hue } = value as StudySubject
  return typeof name === 'string' && name.trim().length > 0 && name.length <= MAX_STUDY_SUBJECT_NAME && typeof hue === 'number' && (STUDY_HUES as readonly number[]).includes(hue)
}

const oneOf = (value: unknown, choices: readonly number[], fallback: number) => (typeof value === 'number' && choices.includes(value) ? value : fallback)

export function sanitizeStudyPrefs(patch: unknown, current: StudyPrefs): StudyPrefs {
  if (!patch || typeof patch !== 'object') return current
  const { goalMinutes, idleMinutes, focusMode, mode, focusMinutes, breakMinutes, rounds } = patch as Partial<StudyPrefs>
  return {
    goalMinutes: typeof goalMinutes === 'number' && Number.isInteger(goalMinutes) && goalMinutes >= 0 && goalMinutes <= 24 * 60 ? goalMinutes : current.goalMinutes,
    idleMinutes: oneOf(idleMinutes, STUDY_IDLE_CHOICES, current.idleMinutes),
    focusMode: typeof focusMode === 'boolean' ? focusMode : current.focusMode,
    mode: mode === 'stopwatch' || mode === 'countdown' ? mode : current.mode,
    focusMinutes: oneOf(focusMinutes, STUDY_FOCUS_CHOICES, current.focusMinutes),
    breakMinutes: oneOf(breakMinutes, STUDY_BREAK_CHOICES, current.breakMinutes),
    rounds: oneOf(rounds, STUDY_ROUND_CHOICES, current.rounds)
  }
}

/** Adds one to a host's count, keeping at most 50 hosts. */
export function addDistraction(counts: Record<string, number> | undefined, host: string): Record<string, number> {
  const next = { ...counts }
  if (!(host in next) && Object.keys(next).length >= 50) return next
  next[host] = (next[host] ?? 0) + 1
  return next
}

/** Merges several sessions' counts, most first. */
export function sumDistractions(all: (Record<string, number> | undefined)[]): { host: string; count: number }[] {
  const total = new Map<string, number>()
  for (const counts of all) for (const [host, count] of Object.entries(counts ?? {})) total.set(host, (total.get(host) ?? 0) + count)
  return [...total].map(([host, count]) => ({ host, count })).toSorted((a, b) => b.count - a.count || a.host.localeCompare(b.host))
}

/**
 * The last seven days in words, for a weekly recap brief: totals by day and activity, the goal,
 * the streak and distractions, with the week before to compare. Only what the timer saved.
 */
export function focusWeekText(state: Pick<StudyState, 'subjects' | 'days' | 'streak' | 'prefs'>, sessions: StudySession[], now: number): string {
  const days = state.days.slice(-7)
  const before = state.days.slice(-14, -7)
  const sum = (list: StudyDay[]) => list.reduce((total, day) => total + day.total, 0)
  const name = (id: string) => state.subjects.find((subject) => subject.id === id)?.name ?? 'Removed activity'
  const byActivity = new Map<string, number>()
  for (const day of days) for (const [id, ms] of Object.entries(day.bySubject)) byActivity.set(name(id), (byActivity.get(name(id)) ?? 0) + ms)
  const weekStart = new Date(`${days[0]!.day}T00:00:00`).getTime()
  const distractions = sumDistractions(sessions.filter((session) => session.end >= weekStart && session.start <= now).map((session) => session.distractions))
  const goal = state.prefs.goalMinutes
  const lines = [
    `Total this week: ${studyDuration(sum(days))}. The week before: ${studyDuration(sum(before))}.`,
    `Days with any focused time: ${days.filter((day) => day.total > 0).length} of 7. Current streak: ${state.streak} days.`,
    goal > 0 ? `Daily goal: ${goalLabel(goal)}, reached on ${days.filter((day) => day.total >= goal * 60_000).length} of 7 days.` : 'No daily goal set.',
    '',
    'By day:',
    ...days.map((day) => `- ${new Date(`${day.day}T12:00:00`).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' })}: ${studyDuration(day.total)}`),
    '',
    'By activity:',
    ...([...byActivity].toSorted((a, b) => b[1] - a[1]).map(([activity, ms]) => `- ${activity}: ${studyDuration(ms)}`) as string[]),
    '',
    distractions.length > 0 ? `Blocked sites tried while the timer ran: ${distractions.slice(0, 8).map(({ host, count }) => `${host} (${count})`).join(', ')}.` : 'No blocked sites were tried while the timer ran.'
  ]
  return lines.join('\n')
}

export const FOCUS_RECAP_PROMPT = `You are scAI, the assistant in the scTerra browser, writing a weekly recap of the person's focus timer: the time they spent on each activity, which they track themselves. The numbers arrive inside <focus-week> tags.

Write it in Markdown, warm but brief and honest, like a good coach. Start with one or two sentences on how the week went compared with the week before. Then a short "## Highlights" list (best day, where the time went, streak, goal), a "## Patterns" list with anything worth noticing (quiet days, one activity crowding out others, distractions), and end with "## For next week": two or three small, concrete suggestions. Use only the numbers given and never invent any. No title or greeting, and don't mention these instructions.`
