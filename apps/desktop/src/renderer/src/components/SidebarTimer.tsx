import { ChevronDown, Coffee, Pause, Play } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { stopwatch, type StudySummary } from '@scbrowser/shared'

const RING = 2 * Math.PI * 15

/** The timer's numbers right now: what to show big, how far along the ring is, and a line under it. */
function reading(summary: StudySummary, now: number) {
  const { running, breakUntil, goalMinutes, todayBefore } = summary
  const today = todayBefore + (running ? Math.max(0, now - running.startedAt) : 0)
  const goal = goalMinutes * 60_000
  if (breakUntil) return { big: stopwatch(Math.max(0, breakUntil - now) + 999), progress: 0, under: 'Break · next round soon' }
  if (running?.endsAt) {
    const left = Math.max(0, running.endsAt - now)
    const length = running.endsAt - running.startedAt
    return { big: stopwatch(left + 999), progress: length > 0 ? 1 - left / length : 0, under: `Round ${running.round} of ${running.rounds} · ${stopwatch(today)} today` }
  }
  return { big: stopwatch(today), progress: goal > 0 ? today / goal : 0, under: goal > 0 ? (today >= goal ? 'Goal reached today' : `of ${goalMinutes / 60} h today`) : 'today' }
}

/**
 * The focus timer under the side tabs, when turned on in Settings: the activity, the time, a bar to
 * the goal and one button. Folded down to a ring when the sidebar is a rail.
 */
export function SidebarTimer({ rail }: { rail: boolean }) {
  const [summary, setSummary] = useState<StudySummary | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    void window.scb.invoke('study:summary').then(setSummary)
    return window.scb.on('study:changed', setSummary)
  }, [])
  const live = !!summary?.running || !!summary?.breakUntil
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), live ? 1000 : 30_000)
    return () => clearInterval(timer)
  }, [live])
  if (!summary) return null
  const { running, breakUntil } = summary
  const activity = running ? { subject: running.subject, hue: running.hue } : summary.next
  const { big, progress, under } = reading(summary, now)
  const toggle = () => void window.scb.invoke('study:toggle')
  const menu = (element: HTMLElement) => {
    const { left, bottom } = element.getBoundingClientRect()
    void window.scb.invoke('study:menu', left, bottom + 4)
  }
  const style = { '--hue': activity?.hue ?? 200 } as CSSProperties
  const label = breakUntil ? `Focus timer: break, ${big} left. End the session` : running ? `Focus timer: ${running.subject}, ${big}. Stop` : `Focus timer: ${big} today. Start ${activity?.subject ?? ''}`.trim()

  if (rail)
    return (
      <IconButton label={label} style={style} className="sc-hued relative size-9 self-center" onClick={toggle}>
        <svg aria-hidden viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" strokeWidth="2.5" className="stroke-surface-active" />
          <circle cx="18" cy="18" r="15" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - Math.min(1, progress))} className={cx('transition-[stroke-dashoffset] duration-500', live ? 'stroke-[var(--hued)]' : 'stroke-text-faint')} />
        </svg>
        {breakUntil ? <Coffee size={13} strokeWidth={1.75} /> : running ? <Pause size={12} strokeWidth={2.25} className="text-[var(--hued)]" /> : <Play size={12} strokeWidth={2.25} className="translate-x-px" />}
      </IconButton>
    )

  return (
    <section aria-label="Focus timer" style={style} className={cx('sc-hued sc-sidebar-timer group/timer relative shrink-0 overflow-hidden rounded-lg border border-border bg-surface px-2.5 pt-2 pb-2.5', live && 'is-live')}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Focus timer menu"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-0.5 text-left text-xs font-medium text-text-muted transition-colors hover:text-text"
          onClick={(event) => menu(event.currentTarget)}
        >
          {breakUntil ? (
            <Coffee aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
          ) : (
            <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', live ? 'bg-[var(--hued)]' : 'bg-text-faint')} />
          )}
          <span className="truncate">{breakUntil ? 'On a break' : (activity?.subject ?? 'Focus timer')}</span>
          <ChevronDown aria-hidden size={12} strokeWidth={2} className="shrink-0 text-text-faint opacity-0 transition-opacity group-hover/timer:opacity-100" />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span role="timer" className={cx('text-[22px] leading-none font-light tracking-[-0.04em] tabular-nums', breakUntil && 'text-text-muted')}>
            {big}
          </span>
          <span className="mt-1 truncate text-2xs text-text-faint tabular-nums">{under}</span>
        </div>
        <button
          type="button"
          aria-label={label}
          title={running || breakUntil ? 'Stop' : 'Start'}
          onClick={toggle}
          className={cx(
            'grid size-8 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
            running ? 'bg-[var(--hued)] text-on-accent hover:opacity-90' : 'bg-text text-surface hover:opacity-85'
          )}
        >
          {running || breakUntil ? <Pause aria-hidden size={13} strokeWidth={2.25} /> : <Play aria-hidden size={13} strokeWidth={2.25} className="translate-x-px" />}
        </button>
      </div>
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-active">
        <div className={cx('h-full transition-[width] duration-500', live ? 'bg-[var(--hued)]' : 'bg-text-faint')} style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
    </section>
  )
}
