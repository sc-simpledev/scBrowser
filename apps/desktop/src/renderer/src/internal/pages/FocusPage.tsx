import { Check, ChevronDown, Coffee, Flame, Newspaper, Pause, Pencil, Play, Plus, Settings2, ShieldBan, Square, Target, Timer, Trash2, TrendingUp, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, cx, IconButton, Input, Segmented, Select, Switch } from '@scbrowser/ui'
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
  shortDuration,
  stopwatch,
  studyDayKey,
  studyDuration,
  type BriefSchedule,
  type StudyDay,
  type StudySession,
  type StudyState,
  type StudySubject
} from '@scbrowser/shared'
import { api } from '../api'

type Update = (call: Promise<StudyState>) => Promise<void>

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
  return <span aria-hidden style={hueStyle(hue)} className={cx('sc-hued size-2 shrink-0 rounded-full', hue < 0 ? 'bg-border-strong' : 'bg-[var(--hued)]', className)} />
}

/** A card in the scSpace style: thin border, 10 px corners, an optional heading with a line under it. */
function Panel({ title, detail, action, children, className, label }: { title?: string; detail?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label ?? title} className={cx('flex min-w-0 flex-col rounded-lg bg-surface shadow-1', className)}>
      {title && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-md font-semibold tracking-[-0.01em]">{title}</h2>
            {detail && <div className="text-xs text-text-faint">{detail}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** A ring that fills as the goal, round or break gets closer. */
function Ring({ progress, hued, children }: { progress: number; hued: boolean; children: ReactNode }) {
  const radius = 92
  const length = 2 * Math.PI * radius
  return (
    <div className="relative grid size-[216px] place-items-center max-[560px]:size-[184px]">
      <svg aria-hidden viewBox="0 0 200 200" className="absolute inset-0 size-full -rotate-90">
        <circle cx="100" cy="100" r={radius} fill="none" strokeWidth="6" className="stroke-surface-active" />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - Math.min(1, Math.max(0, progress)))}
          className={cx('transition-[stroke-dashoffset] duration-700 ease-out', hued ? 'stroke-[var(--hued)]' : 'stroke-accent')}
        />
      </svg>
      <div className="relative flex flex-col items-center gap-1 text-center">{children}</div>
    </div>
  )
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
 * The timer itself: the mode, a ring with the time in it, and one button. The stopwatch shows the
 * day's total against the goal; a countdown shows the time left in the round; a break, its time left.
 */
function TimerPanel({ state, now, todayTotal, onToggle, update }: { state: StudyState; now: number; todayTotal: number; onToggle: () => void; update: Update }) {
  const { running, onBreak, prefs } = state
  const subjectId = running?.subjectId ?? onBreak?.subjectId ?? state.today[0]?.subjectId
  const subject = subjectId ? (state.subjects.find((other) => other.id === subjectId) ?? null) : (state.subjects[0] ?? null)
  const busy = !!running || !!onBreak
  const goal = prefs.goalMinutes * 60_000
  const countdown = running?.endsAt ? running.endsAt - now : null
  const round = prefs.focusMinutes * 60_000
  const progress = onBreak ? 1 - (onBreak.until - now) / (prefs.breakMinutes * 60_000) : countdown !== null ? 1 - countdown / round : goal > 0 ? todayTotal / goal : 0
  const big = onBreak ? stopwatch(onBreak.until - now) : countdown !== null ? stopwatch(countdown + 999) : stopwatch(todayTotal)
  const label = onBreak ? 'Break left' : countdown !== null ? 'Left in this round' : 'Focused today'
  const below = onBreak
    ? `Round ${onBreak.round} of ${onBreak.rounds} starts by itself`
    : countdown !== null
      ? `Round ${running!.round ?? 1} of ${running!.rounds ?? 1} · ${stopwatch(todayTotal)} today`
      : goal > 0
        ? todayTotal >= goal
          ? 'Goal reached'
          : `of ${goalLabel(prefs.goalMinutes)} · ${studyDuration(goal - todayTotal)} to go`
        : 'today'
  return (
    <section aria-label="Today" style={subject ? hueStyle(subject.hue) : undefined} className={cx('sc-focus-hero relative flex min-w-0 flex-1 flex-col items-center gap-5 px-6 pt-5 pb-6', subject && busy && 'sc-hued')}>
      <div className="flex w-full items-center justify-between gap-3">
        <Segmented
          fill={false}
          size="sm"
          label="Timer"
          value={prefs.mode}
          disabled={busy}
          options={[
            ['stopwatch', 'Stopwatch'],
            ['countdown', 'Countdown']
          ]}
          onChange={(mode) => void update(api().invoke('study:prefs', { mode }))}
        />
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-text-muted">
          {onBreak ? (
            <>
              <Coffee aria-hidden size={13} strokeWidth={1.75} />
              On a break
            </>
          ) : running && subject ? (
            <>
              <span aria-hidden className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--hued)] opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-[var(--hued)]" />
              </span>
              <span className="truncate">{subject.name}</span>
            </>
          ) : (
            new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
          )}
        </span>
      </div>
      <Ring progress={progress} hued={!!subject && busy}>
        <div role="timer" aria-label={label} className={cx('text-[52px] leading-none font-light tracking-[-0.045em] tabular-nums max-[560px]:text-[42px]', onBreak && 'text-text-muted')}>
          {big}
        </div>
        <div className="max-w-40 text-xs text-text-faint tabular-nums">{below}</div>
      </Ring>
      {prefs.mode === 'countdown' && !busy && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Select aria-label="Countdown length" className="h-8 w-24" value={prefs.focusMinutes} onChange={(e) => void update(api().invoke('study:prefs', { focusMinutes: Number(e.target.value) }))}>
            {STUDY_FOCUS_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min
              </option>
            ))}
          </Select>
          <Select aria-label="Break length" className="h-8 w-28" value={prefs.breakMinutes} onChange={(e) => void update(api().invoke('study:prefs', { breakMinutes: Number(e.target.value) }))}>
            {STUDY_BREAK_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min break
              </option>
            ))}
          </Select>
          <Select aria-label="Rounds" className="h-8 w-28" value={prefs.rounds} onChange={(e) => void update(api().invoke('study:prefs', { rounds: Number(e.target.value) }))}>
            {STUDY_ROUND_CHOICES.map((rounds) => (
              <option key={rounds} value={rounds}>
                {rounds} {rounds === 1 ? 'round' : 'rounds'}
              </option>
            ))}
          </Select>
        </div>
      )}
      <Button variant="primary" className="h-10 min-w-40 px-6 text-sm" onClick={onToggle} disabled={state.subjects.length === 0}>
        {busy ? <Square aria-hidden size={13} strokeWidth={2.25} /> : <Play aria-hidden size={15} strokeWidth={2} />}
        {busy ? 'Stop' : subject ? `Start ${subject.name}` : 'Start'}
      </Button>
      {running && !running.endsAt && <div className="-mt-2 text-xs text-text-faint tabular-nums">This session {stopwatch(now - running.startedAt)} · since {clock(running.startedAt)}</div>}
    </section>
  )
}

function SubjectRow({ subject, today, share, running, update }: { subject: StudySubject; today: number; share: number; running: boolean; update: Update }) {
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
    <li style={hueStyle(subject.hue)} className={cx('sc-hued group relative flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors', running ? 'bg-[var(--hued-soft)]' : 'hover:bg-surface-hover')}>
      <button
        type="button"
        aria-label={running ? `Stop ${subject.name}` : `Start ${subject.name}`}
        aria-pressed={running}
        onClick={() => void update(running ? api().invoke('study:stop') : api().invoke('study:start', subject.id))}
        className={cx('grid size-8 shrink-0 place-items-center rounded-full transition-colors', running ? 'bg-[var(--hued)] text-on-accent' : 'bg-[var(--hued-soft)] text-[var(--hued)] hover:bg-[var(--hued)] hover:text-on-accent')}
      >
        {running ? <Pause aria-hidden size={13} strokeWidth={2.25} /> : <Play aria-hidden size={13} strokeWidth={2.25} className="translate-x-px" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{subject.name}</span>
          <span className={cx('text-sm font-medium tabular-nums', today > 0 ? 'text-text' : 'text-text-faint')}>{stopwatch(today)}</span>
        </div>
        <div aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-active">
          <div className="h-full rounded-full bg-[var(--hued)] transition-[width] duration-500" style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
      </div>
      <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <IconButton size="sm" label={`Change ${subject.name}`} onClick={() => setEditing(true)}>
          <Pencil size={12} strokeWidth={1.75} />
        </IconButton>
        {removing ? (
          <Button variant="ghost" className="h-7 px-2 text-danger" onClick={() => void update(api().invoke('study:subject-remove', subject.id))}>
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

/** The activities beside the timer, each with today's time and its share of the day. */
function Activities({ state, bySubjectToday, update }: { state: StudyState; bySubjectToday: (id: string) => number; update: Update }) {
  const [adding, setAdding] = useState(false)
  const most = Math.max(1, ...state.subjects.map((subject) => bySubjectToday(subject.id)))
  return (
    <section aria-label="Activities" className="flex w-[22rem] shrink-0 flex-col border-l border-border max-[860px]:w-auto max-[860px]:border-t max-[860px]:border-l-0">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 className="text-md font-semibold tracking-[-0.01em]">Activities</h2>
        {!adding && (
          <Button variant="ghost" className="h-7 px-2" onClick={() => setAdding(true)}>
            <Plus aria-hidden size={13} strokeWidth={2} />
            Add activity
          </Button>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pb-4">
        {adding && (
          <SubjectForm
            onCancel={() => setAdding(false)}
            onSave={async (name, hue) => {
              await update(api().invoke('study:subject-save', null, { name, hue }))
              setAdding(false)
            }}
          />
        )}
        <ul className="flex flex-col gap-0.5">
          {state.subjects.map((subject) => {
            const today = bySubjectToday(subject.id)
            return <SubjectRow key={subject.id} subject={subject} today={today} share={today / most} running={state.running?.subjectId === subject.id} update={update} />
          })}
        </ul>
        {state.subjects.length === 0 && !adding && <p className="px-2.5 text-text-muted">Add an activity to start timing: work, study, writing or practice.</p>}
      </div>
    </section>
  )
}

function Stat({ label, value, icon, hint }: { label: string; value: string; icon: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface px-4 py-3.5 shadow-1">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-hover text-text-muted">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-text-faint">{label}</span>
        <span className="truncate text-lg leading-tight font-semibold tracking-[-0.03em] tabular-nums" title={hint}>
          {value}
        </span>
      </div>
    </div>
  )
}

/** The last seven days as bars, each split by activity, with a key under them. */
function Week({ days, subjects, goalMinutes }: { days: StudyDay[]; subjects: StudySubject[]; goalMinutes: number }) {
  const week = days.slice(-7)
  const goal = goalMinutes * 60_000
  const top = Math.max(goal, ...week.map((day) => day.total), 3_600_000)
  const hueOf = (id: string) => subjects.find((subject) => subject.id === id)?.hue ?? -1
  const used = new Set(week.flatMap((day) => Object.keys(day.bySubject)))
  const total = week.reduce((sum, day) => sum + day.total, 0)
  return (
    <Panel title="Last 7 days" detail={`${studyDuration(total)} in all${goal > 0 ? ` · dashed line is your ${goalLabel(goalMinutes)} goal` : ''}`} label="This week" className="flex-[1.6]">
      <div className="flex flex-1 flex-col gap-2 px-5 pb-4">
        <div className="relative flex h-36 items-end gap-3">
          {goal > 0 && <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border-strong" style={{ bottom: `${(goal / top) * 100}%` }} />}
          {week.map((day) => {
            const parts = Object.entries(day.bySubject).filter(([, ms]) => ms > 0)
            return (
              <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col-reverse items-center" title={`${dayDate(day.day).toLocaleDateString(undefined, { weekday: 'long' })}: ${studyDuration(day.total)}`}>
                <div className="flex h-full w-full max-w-10 flex-col-reverse gap-px overflow-hidden rounded-[4px]">
                  {parts.length === 0 && <div className="h-1 w-full shrink-0 rounded-full bg-surface-active" />}
                  {parts.map(([id, ms]) => (
                    <div key={id} style={{ ...hueStyle(hueOf(id)), height: `${(ms / top) * 100}%` }} className={cx('sc-hued w-full shrink-0', hueOf(id) < 0 ? 'bg-border-strong' : 'bg-[var(--hued)]')} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-3 border-t border-border pt-2">
          {week.map((day) => (
            <span key={day.day} className={cx('flex-1 text-center text-2xs', day.day === studyDayKey(Date.now()) ? 'font-semibold text-text' : 'text-text-faint')}>
              {dayDate(day.day).toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
          ))}
        </div>
        {used.size > 0 && (
          <ul aria-label="Key" className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-text-muted">
            {[...used].map((id) => {
              const subject = subjects.find((other) => other.id === id) ?? REMOVED
              return (
                <li key={id} className="flex items-center gap-1.5">
                  <SubjectDot hue={subject.hue} />
                  {subject.name}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}

/** Today on a line from the first session to now, then each session under it. */
function Today({ sessions, subjects, running, now, update }: { sessions: StudySession[]; subjects: StudySubject[]; running: StudyState['running']; now: number; update: Update }) {
  const subjectOf = (id: string) => subjects.find((subject) => subject.id === id) ?? REMOVED
  const live = running ? [{ id: 'live', subjectId: running.subjectId, start: running.startedAt, end: now }] : []
  const all = [...live, ...sessions]
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const from = Math.min(midnight + 6 * 3_600_000, ...all.map((session) => Math.max(session.start, midnight)))
  const to = Math.max(from + 3_600_000, now)
  const at = (time: number) => `${((Math.max(time, from) - from) / (to - from)) * 100}%`
  return (
    <Panel title="Today" detail={all.length === 0 ? 'Nothing timed yet' : `${all.length} ${all.length === 1 ? 'session' : 'sessions'} since ${clock(from)}`} label="Today's sessions" className="flex-1">
      <div className="flex flex-col gap-3 px-5 pb-4">
        <div aria-hidden className="relative h-3 overflow-hidden rounded-full bg-surface-active">
          {all.map((session) => (
            <span key={session.id} style={{ ...hueStyle(subjectOf(session.subjectId).hue), left: at(session.start), width: `max(3px, calc(${at(session.end)} - ${at(session.start)}))` }} className="sc-hued absolute inset-y-0 bg-[var(--hued)]" />
          ))}
        </div>
        <div aria-hidden className="-mt-2 flex justify-between text-2xs text-text-faint tabular-nums">
          <span>{clock(from)}</span>
          <span>now</span>
        </div>
        {sessions.length > 0 && (
          <ul className="flex max-h-48 flex-col overflow-y-auto [scrollbar-width:thin]">
            {sessions.map((session) => {
              const subject = subjectOf(session.subjectId)
              const tried = Object.values(session.distractions ?? {}).reduce((sum, count) => sum + count, 0)
              return (
                <li key={session.id} className="group flex items-center gap-2.5 border-t border-border py-2 first:border-t-0">
                  <SubjectDot hue={subject.hue} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{subject.name}</span>
                    <span className="text-2xs text-text-faint tabular-nums">
                      {clock(session.start)}–{clock(session.end)}
                    </span>
                  </span>
                  {tried > 0 && (
                    <span title={`${tried} blocked ${tried === 1 ? 'site' : 'sites'} tried`} className="flex items-center gap-1 text-2xs text-text-faint">
                      <ShieldBan aria-hidden size={11} strokeWidth={1.75} />
                      {tried}
                    </span>
                  )}
                  <span className="w-14 text-right text-sm font-medium tabular-nums">{stopwatch(session.end - session.start)}</span>
                  <IconButton size="sm" label="Delete this session" className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onClick={() => void update(api().invoke('study:session-remove', session.id))}>
                    <Trash2 size={12} strokeWidth={1.75} />
                  </IconButton>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}

/** Blocked sites tried while the timer ran today: the pull to look away, counted. */
function Distractions({ list, focusMode, gaveIn }: { list: { host: string; count: number }[]; focusMode: boolean; gaveIn: number }) {
  const total = list.reduce((sum, item) => sum + item.count, 0)
  const most = Math.max(1, ...list.map((item) => item.count))
  return (
    <Panel
      title="Distractions today"
      detail={total === 0 ? 'No blocked sites tried while the timer ran' : `You reached for a blocked site ${total} ${total === 1 ? 'time' : 'times'}${gaveIn > 0 ? `, and took one more minute ${gaveIn === 1 ? 'once' : `${gaveIn} times`}` : ''}`}
      className="flex-1"
    >
      <div className="flex flex-col gap-2 px-5 pb-4">
        {list.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {list.slice(0, 5).map(({ host, count }) => (
              <li key={host} className="flex items-center gap-3 text-xs">
                <span className="w-32 truncate">{host}</span>
                <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-active">
                  <span className="block h-full rounded-full bg-text-faint" style={{ width: `${(count / most) * 100}%` }} />
                </span>
                <span className="w-5 text-right text-text-muted tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-muted">{focusMode ? 'Nice. Each try at a blocked site while timing shows up here.' : 'Turn on Focus Mode while timing, in the timer settings, to block your distracting sites and count each try.'}</p>
        )}
      </div>
    </Panel>
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
    <Panel title="Last 12 weeks" detail="Darker days came closer to your goal">
      <div className="flex items-center gap-10 px-5 pb-5 max-[640px]:flex-col max-[640px]:items-start">
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
        <dl className="grid flex-1 grid-cols-3 gap-6 text-sm">
          <div>
            <dt className="text-xs text-text-faint">Days studied</dt>
            <dd className="text-lg font-semibold tracking-[-0.02em] tabular-nums">
              {studied} <span className="font-normal text-text-faint">of {days.length}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-faint">Total</dt>
            <dd className="text-lg font-semibold tracking-[-0.02em] tabular-nums">{studyDuration(total)}</dd>
          </div>
          {metGoal !== null && (
            <div>
              <dt className="text-xs text-text-faint">Goal reached</dt>
              <dd className="text-lg font-semibold tracking-[-0.02em] tabular-nums">
                {metGoal} {metGoal === 1 ? 'day' : 'days'}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </Panel>
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
    <section aria-label="Weekly recap" className="flex flex-1 flex-wrap items-center gap-3 rounded-lg bg-surface px-5 py-4 shadow-1">
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

/** Goal, pausing when away, and Focus Mode, folded away until wanted. */
function Settings({ state, update }: { state: StudyState; update: Update }) {
  const [open, setOpen] = useState(false)
  const row = 'flex items-center justify-between gap-4 border-t border-border px-5 py-3 first:border-t-0'
  return (
    <section aria-label="Timer settings" className="rounded-lg bg-surface shadow-1">
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-3 rounded-lg px-5 py-3.5 text-left" onClick={() => setOpen(!open)}>
        <Settings2 aria-hidden size={15} strokeWidth={1.75} className="text-text-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">Timer settings</span>
          <span className="truncate text-xs text-text-faint">
            Goal {goalLabel(state.prefs.goalMinutes)} · pauses after {state.prefs.idleMinutes === 0 ? 'never' : `${state.prefs.idleMinutes} min away`} · Focus Mode {state.prefs.focusMode ? 'on' : 'off'} while timing
          </span>
        </span>
        <ChevronDown aria-hidden size={15} strokeWidth={2} className={cx('text-text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col border-t border-border">
          <label className={row}>
            <span className="flex flex-col">
              <span>Daily goal</span>
              <span className="text-xs text-text-faint">Shown in the ring, on the toolbar and in the sidebar.</span>
            </span>
            <Select aria-label="Daily goal" className="w-32" value={state.prefs.goalMinutes} onChange={(e) => void update(api().invoke('study:prefs', { goalMinutes: Number(e.target.value) }))}>
              {STUDY_GOALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {goalLabel(minutes)}
                </option>
              ))}
            </Select>
          </label>
          <label className={row}>
            <span className="flex flex-col">
              <span>Pause when I'm away</span>
              <span className="text-xs text-text-faint">With no key press or mouse move for this long, the timer stops and leaves that time out.</span>
            </span>
            <Select aria-label="Pause when I'm away" className="w-32" value={state.prefs.idleMinutes} onChange={(e) => void update(api().invoke('study:prefs', { idleMinutes: Number(e.target.value) }))}>
              {STUDY_IDLE_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0 ? 'Never' : `${minutes} min`}
                </option>
              ))}
            </Select>
          </label>
          <label className={row}>
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
          <label className={row}>
            <span className="flex flex-col">
              <span>Show the timer in the sidebar</span>
              <span className="text-xs text-text-faint">Under your side tabs, to start and stop it from any page.</span>
            </span>
            <SidebarSwitch />
          </label>
        </div>
      )}
    </section>
  )
}

function SidebarSwitch() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => void api().invoke('settings:get').then((settings) => setOn(settings.sidebarTimer)), [])
  if (on === null) return null
  return (
    <Switch
      label="Show the timer in the sidebar"
      checked={on}
      onChange={(next) => {
        setOn(next)
        void api().invoke('settings:set', { sidebarTimer: next })
      }}
    />
  )
}

/**
 * The focus timer: a stopwatch or countdown per activity that adds up the day, with a goal, a
 * week of bars and a calendar of the last twelve weeks. It pauses by itself when the person walks
 * away. It's for any kind of focused work, not only study.
 */
export function FocusPage() {
  const [state, setState] = useState<StudyState | null>(null)
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
  const goal = state.prefs.goalMinutes

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <Timer aria-hidden size={13} strokeWidth={2} />
            Focus
          </span>
          <h1 className="text-display leading-[1.1] font-semibold tracking-[-0.035em] max-[720px]:text-xl">Focus timer</h1>
          <p className="text-sm text-text-muted">Time what you focus on: work, study, writing or practice. It adds up the day and pauses itself when you step away.</p>
        </div>
      </header>

      {state.pausedReason === 'away' && !running && (
        <p role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-muted">
          The timer paused while you were away, and that time wasn't counted. Press Start to carry on.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}

      <div className="flex overflow-hidden rounded-lg bg-surface shadow-1 max-[860px]:flex-col">
        <TimerPanel
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
        <Activities state={state} bySubjectToday={bySubjectToday} update={update} />
      </div>

      <div className="grid grid-cols-4 gap-3 max-[860px]:grid-cols-2">
        <Stat label="Streak" value={`${state.streak} ${state.streak === 1 ? 'day' : 'days'}`} icon={<Flame size={16} strokeWidth={1.75} className={state.streak > 0 ? 'text-accent' : undefined} />} />
        <Stat label="Last 7 days" value={shortDuration(stats.weekTotal)} icon={<TrendingUp size={16} strokeWidth={1.75} />} />
        <Stat label="Daily average" value={shortDuration(stats.average)} icon={<Timer size={16} strokeWidth={1.75} />} />
        <Stat label="Best day" value={shortDuration(stats.best)} icon={<Target size={16} strokeWidth={1.75} />} hint={goal > 0 ? `Goal ${goalLabel(goal)}` : undefined} />
      </div>

      <div className="flex gap-3 max-[860px]:flex-col">
        <Week days={state.days} subjects={state.subjects} goalMinutes={goal} />
        <Today sessions={state.today} subjects={state.subjects} running={running} now={now} update={update} />
      </div>

      <Calendar days={state.days} goalMinutes={goal} />

      <div className="flex gap-3 max-[860px]:flex-col">
        <Distractions list={state.distractions} focusMode={state.prefs.focusMode} gaveIn={state.gaveIn} />
        <Recap />
      </div>

      <Settings state={state} update={update} />
    </>
  )
}
