import { Check, Coffee, Flame, Newspaper, Pause, Pencil, Play, Plus, ShieldBan, Square, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, cx, IconButton, Input, Select, Switch, Segmented } from '@scbrowser/ui'
import {
  goalLabel,
  MAX_STUDY_SUBJECT_NAME,
  SOURCE_TOPICS,
  scheduleLabel,
  STUDY_BREAK_CHOICES,
  STUDY_FOCUS_CHOICES,
  STUDY_GOALS,
  STUDY_ROUND_CHOICES,
  STUDY_HUES,
  STUDY_IDLE_CHOICES,
  stopwatch,
  studyDayKey,
  studyDuration,
  type BriefSchedule,
  type StudyDay,
  type StudyState,
  type StudySubject
} from '@scbrowser/shared'
import { api } from '../api'

const cleanError = (error: unknown) => (error instanceof Error ? error.message.replace(/^.*Error: /, '') : 'Something went wrong.')
const hueStyle = (hue: number) => ({ '--hue': hue }) as CSSProperties
const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const dayDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
const REMOVED = { id: '', name: 'Removed activity', hue: -1 }

/** Ticks once a second while the timer runs. */
function useNow(running: boolean, from: number): number {
  const [now, setNow] = useState(from)
  useEffect(() => {
    setNow(Date.now())
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, from])
  return now
}

function SubjectDot({ hue, className }: { hue: number; className?: string }) {
  return <span aria-hidden style={hueStyle(hue)} className={cx('sc-hued size-2.5 shrink-0 rounded-full bg-[var(--hued)]', hue < 0 && 'bg-border-strong', className)} />
}

function HuePicker({ value, onChange }: { value: number; onChange: (hue: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex gap-1">
      {STUDY_HUES.map((hue) => (
        <button
          key={hue}
          type="button"
          role="radio"
          aria-checked={value === hue}
          aria-label={`Colour ${STUDY_HUES.indexOf(hue) + 1}`}
          style={hueStyle(hue)}
          onClick={() => onChange(hue)}
          className={cx('sc-hued grid size-6 place-items-center rounded-full bg-[var(--hued)] text-on-accent transition-transform hover:scale-110', value === hue && 'ring-2 ring-[var(--hued)] ring-offset-2 ring-offset-surface')}
        >
          {value === hue && <Check aria-hidden size={12} strokeWidth={2.5} />}
        </button>
      ))}
    </div>
  )
}

function SubjectForm({ initial, onSave, onCancel }: { initial?: StudySubject; onSave: (name: string, hue: number) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [hue, setHue] = useState(initial?.hue ?? STUDY_HUES[1])
  const [problem, setProblem] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <form
      aria-label={initial ? `Change ${initial.name}` : 'New activity'}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim()) return
        onSave(name.trim(), hue).catch((error: unknown) => setProblem(cleanError(error)))
      }}
    >
      <Input ref={ref} aria-label="Activity name" placeholder="Deep work, Writing, Spanish, Guitar…" maxLength={MAX_STUDY_SUBJECT_NAME} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HuePicker value={hue} onChange={setHue} />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {initial ? 'Save' : 'Add activity'}
          </Button>
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </form>
  )
}


/**
 * The day's total, big, with the goal under it. A countdown shows the time left in the round
 * instead, and a break shows the time left in the break.
 */
function Hero({ state, now, todayTotal, onToggle, update }: { state: StudyState; now: number; todayTotal: number; onToggle: () => void; update: (call: Promise<StudyState>) => Promise<void> }) {
  const running = state.running
  const onBreak = state.onBreak
  const subjectId = running?.subjectId ?? onBreak?.subjectId
  const subject = subjectId ? (state.subjects.find((other) => other.id === subjectId) ?? REMOVED) : null
  const goal = state.prefs.goalMinutes * 60_000
  const progress = goal > 0 ? Math.min(1, todayTotal / goal) : 0
  const countdown = running?.endsAt ? running.endsAt - now : null
  const big = onBreak ? stopwatch(onBreak.until - now) : countdown !== null ? stopwatch(countdown + 999) : stopwatch(todayTotal)
  const label = onBreak ? 'Break left' : countdown !== null ? 'Left in this round' : 'Focused today'
  return (
    <section aria-label="Today" style={subject ? hueStyle(subject.hue) : undefined} className={cx('sc-focus-hero relative flex flex-col items-center gap-4 overflow-hidden rounded-lg px-6 pt-5 pb-6 shadow-1', subject && 'sc-hued')} data-running={running ? '' : undefined}>
      <Segmented
        fill={false}
        size="sm"
        label="Timer"
        value={state.prefs.mode}
        disabled={!!running || !!onBreak}
        options={[
          ['stopwatch', 'Stopwatch'],
          ['countdown', 'Countdown']
        ]}
        onChange={(mode) => void update(api().invoke('study:prefs', { mode }))}
      />
      <div className="flex min-h-4 items-center gap-2 text-xs font-medium text-text-muted">
        {subject && running ? (
          <>
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--hued)] opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-[var(--hued)]" />
            </span>
            {subject.name}
            {running.endsAt && <span className="text-text-faint">· Round {running.round ?? 1} of {running.rounds ?? 1}</span>}
          </>
        ) : onBreak ? (
          <>
            <Coffee aria-hidden size={13} strokeWidth={1.75} />
            Break · round {onBreak.round} of {onBreak.rounds} starts by itself
          </>
        ) : state.prefs.mode === 'countdown' ? (
          `${state.prefs.rounds} ${state.prefs.rounds === 1 ? 'round' : 'rounds'} of ${state.prefs.focusMinutes} min${state.prefs.rounds > 1 ? `, ${state.prefs.breakMinutes} min breaks` : ''}`
        ) : (
          new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
        )}
      </div>
      <div role="timer" aria-label={label} className={cx('text-[72px] leading-none font-light tracking-[-0.045em] tabular-nums max-[560px]:text-6xl', onBreak && 'text-text-muted')}>
        {big}
      </div>
      <div className="flex w-full max-w-72 flex-col gap-1.5">
        {goal > 0 ? (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-active">
              <div className={cx('h-full rounded-full transition-[width] duration-500', subject ? 'bg-[var(--hued)]' : 'bg-accent')} style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="flex justify-between text-xs text-text-faint tabular-nums">
              <span>{countdown !== null || onBreak ? `${stopwatch(todayTotal)} today` : progress >= 1 ? 'Goal reached' : `${studyDuration(goal - todayTotal)} to go`}</span>
              <span>Goal {goalLabel(state.prefs.goalMinutes)}</span>
            </div>
          </>
        ) : (
          <div className="text-center text-xs text-text-faint tabular-nums">{countdown !== null || onBreak ? `${stopwatch(todayTotal)} today · ` : ''}No daily goal set</div>
        )}
      </div>
      <Button variant="primary" className="h-9 min-w-32 px-5 text-sm" onClick={onToggle} disabled={state.subjects.length === 0}>
        {running || onBreak ? <Square aria-hidden size={13} strokeWidth={2.25} /> : <Play aria-hidden size={15} strokeWidth={2} />}
        {running || onBreak ? 'Stop' : 'Start'}
      </Button>
      {running && !running.endsAt && <div className="text-xs text-text-faint tabular-nums">This session {stopwatch(now - running.startedAt)} · since {clock(running.startedAt)}</div>}
    </section>
  )
}

function SubjectRow({ subject, today, running, update }: { subject: StudySubject; today: number; running: boolean; update: (call: Promise<StudyState>) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  if (editing)
    return (
      <li className="py-1.5">
        <SubjectForm
          initial={subject}
          onCancel={() => setEditing(false)}
          onSave={async (name, hue) => {
            await update(api().invoke('study:subject-save', subject.id, { name, hue }))
            setEditing(false)
          }}
        />
      </li>
    )
  return (
    <li style={hueStyle(subject.hue)} className={cx('sc-hued group flex items-center gap-3 rounded-md px-2 py-2 transition-colors', running ? 'bg-[var(--hued-soft)]' : 'hover:bg-surface-hover')}>
      <button
        type="button"
        aria-label={running ? `Stop ${subject.name}` : `Start ${subject.name}`}
        aria-pressed={running}
        onClick={() => void update(api().invoke(running ? 'study:stop' : 'study:start', ...((running ? [] : [subject.id]) as [string])))}
        className={cx('grid size-8 shrink-0 place-items-center rounded-full transition-colors', running ? 'bg-[var(--hued)] text-on-accent' : 'border border-[var(--hued)] text-[var(--hued)] hover:bg-[var(--hued-soft)]')}
      >
        {running ? <Pause aria-hidden size={13} strokeWidth={2.25} /> : <Play aria-hidden size={13} strokeWidth={2.25} className="translate-x-px" />}
      </button>
      <span className="min-w-0 flex-1 truncate font-medium">{subject.name}</span>
      <span className={cx('text-sm font-medium tabular-nums', today > 0 ? 'text-text' : 'text-text-faint')}>{stopwatch(today)}</span>
      <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton size="sm" label={`Change ${subject.name}`} onClick={() => setEditing(true)}>
          <Pencil size={12} strokeWidth={1.75} />
        </IconButton>
        {removing ? (
          <Button variant="ghost" className="h-7 text-danger" onClick={() => void update(api().invoke('study:subject-remove', subject.id))}>
            Remove?
          </Button>
        ) : (
          <IconButton size="sm" label={`Remove ${subject.name}`} onClick={() => setRemoving(true)}>
            <X size={12} strokeWidth={2} />
          </IconButton>
        )}
      </div>
    </li>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg px-4 py-3 shadow-1">
      <span className="text-xs text-text-faint">{label}</span>
      <span className="flex items-center gap-1.5 text-lg leading-tight font-semibold tracking-[-0.03em] whitespace-nowrap tabular-nums">
        {icon}
        {value}
      </span>
    </div>
  )
}

/** The last seven days as bars, each split by subject. */
function Week({ days, subjects, goalMinutes }: { days: StudyDay[]; subjects: StudySubject[]; goalMinutes: number }) {
  const week = days.slice(-7)
  const goal = goalMinutes * 60_000
  const top = Math.max(goal, ...week.map((day) => day.total), 3_600_000)
  const hueOf = (id: string) => subjects.find((subject) => subject.id === id)?.hue ?? -1
  return (
    <section aria-label="This week" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Last 7 days</h2>
      <div className="flex flex-col gap-1.5 rounded-lg px-4 pt-4 pb-2.5 shadow-1">
        <div className="relative flex h-28 items-end gap-3">
          {goal > 0 && <div aria-hidden title={`Goal ${goalLabel(goalMinutes)}`} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border-strong" style={{ bottom: `${(goal / top) * 100}%` }} />}
          {week.map((day) => {
            const parts = Object.entries(day.bySubject).filter(([, ms]) => ms > 0)
            return (
              <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col-reverse items-center" title={`${dayDate(day.day).toLocaleDateString(undefined, { weekday: 'long' })}: ${studyDuration(day.total)}`}>
                <div className="flex h-full w-full max-w-9 flex-col-reverse overflow-hidden rounded-sm">
                  {parts.length === 0 && <div className="h-0.5 w-full shrink-0 rounded-full bg-surface-active" />}
                  {parts.map(([id, ms]) => (
                    <div key={id} style={{ ...hueStyle(hueOf(id)), height: `${(ms / top) * 100}%` }} className={cx('sc-hued w-full shrink-0', hueOf(id) < 0 ? 'bg-border-strong' : 'bg-[var(--hued)]')} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-3">
          {week.map((day) => (
            <span key={day.day} className={cx('flex-1 text-center text-2xs', day.day === studyDayKey(Date.now()) ? 'font-semibold text-text' : 'text-text-faint')}>
              {dayDate(day.day).toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Twelve weeks of days, darker for more focused time, like a contributions calendar. */
function Calendar({ days, goalMinutes }: { days: StudyDay[]; goalMinutes: number }) {
  const goal = Math.max(goalMinutes, 60) * 60_000
  // Columns are weeks starting on Monday, so pad the front to line the first day up.
  const lead = (dayDate(days[0]!.day).getDay() + 6) % 7
  const cells: (StudyDay | null)[] = [...Array.from({ length: lead }, () => null), ...days]
  const level = (ms: number) => (ms <= 0 ? 0 : ms < goal * 0.25 ? 1 : ms < goal * 0.6 ? 2 : ms < goal ? 3 : 4)
  const studied = days.filter((day) => day.total > 0).length
  const total = days.reduce((sum, day) => sum + day.total, 0)
  const metGoal = goalMinutes > 0 ? days.filter((day) => day.total >= goalMinutes * 60_000).length : null
  const weeks = Math.ceil(cells.length / 7)
  // A month's name over the first week that starts in it.
  const months = Array.from({ length: weeks }, (_, week) => {
    const first = cells.slice(week * 7, week * 7 + 7).find((cell) => cell !== null)
    if (!first) return ''
    const date = dayDate(first.day)
    return date.getDate() <= 7 || week === 0 ? date.toLocaleDateString(undefined, { month: 'short' }) : ''
  })
  return (
    <section aria-label="Last 12 weeks" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Last 12 weeks</h2>
      <div className="flex items-center gap-8 rounded-lg p-4 shadow-1 max-[640px]:flex-col max-[640px]:items-start">
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-[3px] pl-7 text-2xs text-text-faint">
            {months.map((month, i) => (
              <span key={i} className="w-3.5 overflow-visible whitespace-nowrap">
                {month}
              </span>
            ))}
          </div>
          <div className="flex gap-1.5">
            <div aria-hidden className="grid w-5.5 grid-rows-7 gap-[3px] text-2xs leading-[14px] text-text-faint">
              <span />
              <span>Tue</span>
              <span />
              <span>Thu</span>
              <span />
              <span>Sat</span>
              <span />
            </div>
            <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
              {cells.map((day, i) =>
                day ? (
                  <span
                    key={day.day}
                    data-level={level(day.total)}
                    title={`${dayDate(day.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${studyDuration(day.total)}`}
                    className="sc-heat size-3.5 rounded-[3px]"
                  />
                ) : (
                  <span key={`pad-${i}`} className="size-3.5" />
                )
              )}
            </div>
          </div>
          <div aria-hidden className="flex items-center gap-1 self-end text-2xs text-text-faint">
            Less
            {[0, 1, 2, 3, 4].map((n) => (
              <span key={n} data-level={n} className="sc-heat size-2.5 rounded-[3px]" />
            ))}
            More
          </div>
        </div>
        <dl className="grid flex-1 grid-cols-1 gap-3 text-sm max-[640px]:grid-cols-3">
          <div>
            <dt className="text-xs text-text-faint">Days studied</dt>
            <dd className="font-semibold tabular-nums">
              {studied} <span className="font-normal text-text-faint">of {days.length}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-faint">Total</dt>
            <dd className="font-semibold tabular-nums">{studyDuration(total)}</dd>
          </div>
          {metGoal !== null && (
            <div>
              <dt className="text-xs text-text-faint">Goal reached</dt>
              <dd className="font-semibold tabular-nums">
                {metGoal} {metGoal === 1 ? 'day' : 'days'}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  )
}

/** Blocked sites tried while the timer ran today: the pull to look away, counted. */
function Distractions({ list, focusMode }: { list: { host: string; count: number }[]; focusMode: boolean }) {
  const total = list.reduce((sum, item) => sum + item.count, 0)
  return (
    <section aria-label="Distractions today" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Distractions today</h2>
      <div className="flex items-start gap-3 rounded-lg p-4 shadow-1">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-hover text-text-muted">
          <ShieldBan size={15} strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm">
            {total === 0
              ? 'No blocked sites tried while the timer ran today.'
              : `You reached for a blocked site ${total} ${total === 1 ? 'time' : 'times'} while the timer ran.`}
            {!focusMode && total === 0 && <span className="text-text-muted"> Turn on Focus Mode while timing, below, to block your distracting sites and count each try.</span>}
          </p>
          {list.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {list.slice(0, 8).map(({ host, count }) => (
                <li key={host} className="flex h-6 items-center gap-1.5 rounded-md border border-border px-2 text-xs">
                  {host}
                  <span className="text-text-faint tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

/** Sets up the weekly recap as a brief, or says when it comes. */
function Recap() {
  const [schedule, setSchedule] = useState<BriefSchedule | null | undefined>(undefined)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    void api()
      .invoke('briefs:state')
      .then((briefs) => setSchedule(briefs.schedules.find((other) => other.source === 'focus') ?? null))
      .catch(() => setSchedule(null))
  }, [])
  if (schedule === undefined) return null
  return (
    <section aria-label="Weekly recap" className="flex flex-wrap items-center gap-3 rounded-lg p-4 shadow-1">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <Newspaper size={15} strokeWidth={1.75} />
      </span>
      <div className="flex min-w-60 flex-1 flex-col">
        <span className="font-medium">Weekly recap</span>
        <span className="text-xs text-text-muted">
          {schedule ? `${scheduleLabel(schedule)}, in AI Briefs. Only your timer's totals are sent to your AI model.` : "scAI looks over your week: where the time went, your best day, and a few ideas for next week. Only your timer's totals are sent."}
        </span>
        {problem && (
          <span role="alert" className="text-xs text-danger">
            {problem}
          </span>
        )}
      </div>
      {schedule ? (
        <a href="sc://briefs/" className="flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-surface-hover">
          Open AI Briefs
        </a>
      ) : (
        <Button
          className="shrink-0"
          onClick={() =>
            void api()
              .invoke('briefs:save', null, { title: '', topic: SOURCE_TOPICS.focus.topic, time: '18:00', frequency: 'weekly', weekday: 0, length: 'short', source: 'focus' })
              .then((briefs) => setSchedule(briefs.schedules.find((other) => other.source === 'focus') ?? null))
              .catch((error: unknown) => setProblem(cleanError(error)))
          }
        >
          Get it every Sunday
        </Button>
      )}
    </section>
  )
}

/**
 * The focus timer: a stopwatch or countdown per activity that adds up the day, with a goal, a
 * week of bars and a calendar of the last twelve weeks. It pauses by itself when the person walks
 * away. It's for any kind of focused work, not only study.
 */
export function FocusPage() {
  const [state, setState] = useState<StudyState | null>(null)
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const load = useCallback(() => void api().invoke('study:state').then(setState), [])
  const update = useCallback(
    async (call: Promise<StudyState>) => {
      setProblem(null)
      try {
        setState(await call)
      } catch (error) {
        setProblem(cleanError(error))
        load()
      }
    },
    [load]
  )
  useEffect(() => {
    load()
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(load, 30_000)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(timer)
    }
  }, [load])

  const running = state?.running ?? null
  const onBreak = state?.onBreak ?? null
  const now = useNow(running !== null || onBreak !== null, state?.now ?? 0)
  // A round or break that just ended has moved on in the main process, so look again.
  const due = running?.endsAt ?? onBreak?.until ?? null
  const overdue = due !== null && now >= due + 300
  useEffect(() => {
    if (overdue) load()
  }, [overdue, load])
  const today = state?.days.at(-1)
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const liveMs = running ? now - Math.max(running.startedAt, midnight) : 0
  const todayTotal = (today?.total ?? 0) + liveMs
  const bySubjectToday = (id: string) => (today?.bySubject[id] ?? 0) + (running?.subjectId === id ? liveMs : 0)

  const stats = useMemo(() => {
    if (!state) return null
    const week = state.days.slice(-7)
    const weekTotal = week.reduce((sum, day) => sum + day.total, 0) + liveMs
    const best = state.days.reduce((most, day) => Math.max(most, day.total), 0)
    return { weekTotal, average: weekTotal / 7, best: Math.max(best, todayTotal) }
  }, [state, liveMs, todayTotal])

  if (!state || !stats) return null
  const subjectOf = (id: string) => state.subjects.find((subject) => subject.id === id) ?? REMOVED

  return (
    <>
      <p className="-mt-3 text-xs text-text-muted">Time what you focus on, whether it's work, study, writing or practice. Today's total keeps adding up across sessions, and the timer pauses itself when you step away.</p>

      {state.pausedReason === 'away' && !running && (
        <p role="status" className="rounded-md border border-border px-3 py-2 text-xs text-text-muted">
          The timer paused while you were away, and that time wasn't counted. Press Start to carry on.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}

      <Hero
        state={state}
        now={now}
        todayTotal={todayTotal}
        update={update}
        onToggle={() => {
          if (running || onBreak) return void update(api().invoke('study:stop'))
          const last = state.today[0]?.subjectId
          const subject = state.subjects.find((other) => other.id === last) ?? state.subjects[0]
          if (subject) void update(api().invoke('study:start', subject.id))
        }}
      />

      <section aria-label="Activities" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Activities</h2>
          {!adding && (
            <Button variant="ghost" onClick={() => setAdding(true)}>
              <Plus aria-hidden size={13} strokeWidth={2} />
              Add activity
            </Button>
          )}
        </div>
        {adding && (
          <SubjectForm
            onCancel={() => setAdding(false)}
            onSave={async (name, hue) => {
              setState(await api().invoke('study:subject-save', null, { name, hue }))
              setAdding(false)
            }}
          />
        )}
        <ul className="flex flex-col gap-0.5">
          {state.subjects.map((subject) => (
            <SubjectRow key={subject.id} subject={subject} today={bySubjectToday(subject.id)} running={running?.subjectId === subject.id} update={update} />
          ))}
        </ul>
        {state.subjects.length === 0 && !adding && <p className="text-text-muted">Add an activity to start timing.</p>}
      </section>

      <div className="grid grid-cols-4 gap-3 max-[640px]:grid-cols-2">
        <Stat label="Streak" value={`${state.streak} ${state.streak === 1 ? 'day' : 'days'}`} icon={<Flame aria-hidden size={16} strokeWidth={1.75} className={state.streak > 0 ? 'text-accent' : 'text-text-faint'} />} />
        <Stat label="Last 7 days" value={studyDuration(stats.weekTotal)} />
        <Stat label="Daily average" value={studyDuration(stats.average)} />
        <Stat label="Best day" value={studyDuration(stats.best)} />
      </div>

      <Week days={state.days} subjects={state.subjects} goalMinutes={state.prefs.goalMinutes} />
      <Calendar days={state.days} goalMinutes={state.prefs.goalMinutes} />
      <Distractions list={state.distractions} focusMode={state.prefs.focusMode} />
      <Recap />

      {state.today.length > 0 && (
        <section aria-label="Today's sessions" className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Today's sessions</h2>
          <ul className="flex flex-col divide-y divide-border">
            {state.today.map((session) => {
              const subject = subjectOf(session.subjectId)
              return (
                <li key={session.id} className="group flex items-center gap-3 py-2">
                  <SubjectDot hue={subject.hue} />
                  <span className="min-w-0 flex-1 truncate">{subject.name}</span>
                  <span className="text-xs text-text-faint tabular-nums">
                    {clock(session.start)} – {clock(session.end)}
                  </span>
                  <span className="w-20 text-right text-sm font-medium tabular-nums">{stopwatch(session.end - session.start)}</span>
                  <IconButton size="sm" label="Delete this session" className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => void update(api().invoke('study:session-remove', session.id))}>
                    <Trash2 size={12} strokeWidth={1.75} />
                  </IconButton>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section aria-label="Timer options" className="flex flex-col gap-3 border-t border-border pt-4">
        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span>Daily goal</span>
            <span className="text-xs text-text-faint">Shown under the timer and on the toolbar.</span>
          </span>
          <Select aria-label="Daily goal" className="w-32" value={state.prefs.goalMinutes} onChange={(e) => void update(api().invoke('study:prefs', { goalMinutes: Number(e.target.value) }))}>
            {STUDY_GOALS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {goalLabel(minutes)}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-center justify-between gap-x-4 gap-y-2 max-[720px]:flex-col max-[720px]:items-start">
          <span className="flex flex-col">
            <span>Countdown</span>
            <span className="text-xs text-text-faint">Focus for a set time, take a break, and go again. The next round starts by itself.</span>
          </span>
          <div className="flex shrink-0 gap-2">
            <Select aria-label="Countdown length" className="w-24" value={state.prefs.focusMinutes} onChange={(e) => void update(api().invoke('study:prefs', { focusMinutes: Number(e.target.value) }))}>
              {STUDY_FOCUS_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </Select>
            <Select aria-label="Break length" className="w-28" value={state.prefs.breakMinutes} onChange={(e) => void update(api().invoke('study:prefs', { breakMinutes: Number(e.target.value) }))}>
              {STUDY_BREAK_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min break
                </option>
              ))}
            </Select>
            <Select aria-label="Rounds" className="w-28" value={state.prefs.rounds} onChange={(e) => void update(api().invoke('study:prefs', { rounds: Number(e.target.value) }))}>
              {STUDY_ROUND_CHOICES.map((rounds) => (
                <option key={rounds} value={rounds}>
                  {rounds} {rounds === 1 ? 'round' : 'rounds'}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span>Pause when I'm away</span>
            <span className="text-xs text-text-faint">With no key press or mouse move on this computer for this long, the timer stops and leaves that time out.</span>
          </span>
          <Select aria-label="Pause when I'm away" className="w-32" value={state.prefs.idleMinutes} onChange={(e) => void update(api().invoke('study:prefs', { idleMinutes: Number(e.target.value) }))}>
            {STUDY_IDLE_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? 'Never' : `${minutes} min`}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span>Focus Mode while timing</span>
            <span className="text-xs text-text-faint">
              Blocks the sites on your{' '}
              <a href="sc://blocker/" className="sc-link">
                Focus Mode list
              </a>{' '}
              until you stop the timer.
            </span>
          </span>
          <Switch label="Focus Mode while timing" checked={state.prefs.focusMode} onChange={(focusMode) => void update(api().invoke('study:prefs', { focusMode }))} />
        </label>
      </section>
    </>
  )
}
