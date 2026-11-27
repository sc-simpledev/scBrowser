import { Bot, Brain, Check, ChevronRight, Circle, CircleAlert, Compass, Copy, ListChecks, Pencil, Plus, Split, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { CODER_MAX_TODO, CODER_MAX_TODO_CHARS, type CoderAgentRun, type CoderTodo } from '@scbrowser/shared'
import { shortDuration } from './codeState'

/** A spinner the size of a 12px icon, for something under way. */
export const Spinner = ({ label = 'Running', className }: { label?: string; className?: string }) => (
  <span role="status" aria-label={label} className={cx('block size-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent', className)} />
)

/** Seconds since a moment, ticking while it's shown. */
export function useElapsed(since: number | null, until: number | null = null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null || until !== null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since, until])
  if (since === null) return 0
  return Math.max(0, (until ?? now) - since)
}

/** Copies text, and says so for a moment. */
export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  return (
    <IconButton
      size="sm"
      label={copied ? 'Copied' : label}
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.75} />}
    </IconButton>
  )
}

/** The model's reasoning, folded to one line. Open while it's still arriving, so it can be followed. */
export function ReasoningBlock({ text, live = false }: { text: string; live?: boolean }) {
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? false
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (live && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [text, live])
  // The last line written is the best one-line idea of what it's thinking about.
  const gist = text.trim().split('\n').filter(Boolean).at(-1)?.replace(/^[#*\s-]+|\*+$/g, '') ?? ''
  return (
    <section aria-label={live ? 'Thinking' : 'Reasoning'} className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setChosen(!open)} className="group flex h-6.5 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover">
        <Brain aria-hidden size={13} strokeWidth={1.75} className={cx('shrink-0', live ? 'text-accent' : 'text-text-faint')} />
        <span className={cx('shrink-0', live ? 'sc-shimmer text-text' : 'text-text')}>{live ? 'Thinking' : 'Thought'}</span>
        {!open && <span className="min-w-0 flex-1 truncate text-text-faint">{gist}</span>}
        {open && <span className="flex-1" />}
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition', open && 'rotate-90')} />
      </button>
      {open && (
        <div ref={body} className="sc-scroll-quiet ml-3.25 max-h-72 overflow-y-auto border-l border-border py-1 pr-2 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-text-muted select-text [overflow-wrap:anywhere]">
          {text}
        </div>
      )}
    </section>
  )
}

const RUN_WORDS: Record<CoderAgentRun['state'], string> = { running: 'Working', done: 'Done', failed: 'Stopped' }

/** A helper sent off with a task: what it's doing, and what it reported. Its own steps fold inside. */
export function AgentCard({ run, children }: { run: CoderAgentRun; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const elapsed = useElapsed(run.startedAt, run.endedAt)
  const Icon = run.name === 'explore' ? Compass : Bot
  const running = run.state === 'running'
  return (
    <section aria-label={`${run.name} agent`} className="overflow-hidden rounded-lg border border-border bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full min-w-0 items-start gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-surface-hover">
        <span className={cx('mt-px grid size-5 shrink-0 place-items-center rounded-md', running ? 'border border-border bg-surface text-text-muted' : 'bg-surface-hover text-text-muted')}>
          <Icon aria-hidden size={12} strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <span className="shrink-0 font-medium capitalize">{run.name}</span>
            <span className="min-w-0 flex-1 truncate text-text-muted">{run.task}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-text-faint">
            {running ? <Spinner className="size-2.5 border-[1.5px]" /> : run.state === 'done' ? <Check aria-hidden size={11} strokeWidth={2} className="text-success" /> : <CircleAlert aria-hidden size={11} strokeWidth={1.75} className="text-danger" />}
            <span className="shrink-0">{RUN_WORDS[run.state]}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">
              {run.steps} {run.steps === 1 ? 'step' : 'steps'}, {shortDuration(elapsed)}
            </span>
            {running && run.last && (
              <>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate font-mono">{run.last}</span>
              </>
            )}
          </span>
        </span>
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('mt-1 shrink-0 text-text-faint transition', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border px-2.5 py-2">
          <p className="text-xs whitespace-pre-wrap text-text-muted select-text">{run.task}</p>
          {children}
          {run.report && (
            <div className="flex flex-col gap-1">
              <p className="text-2xs font-medium text-text-faint">Report</p>
              <p className="sc-scroll-quiet max-h-60 overflow-y-auto text-xs whitespace-pre-wrap select-text [overflow-wrap:anywhere]">{run.report}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** One step's mark: a tick, the step under way, or an empty circle. */
export function StepMark({ item, working }: { item: CoderTodo; working: boolean }) {
  if (item.done)
    return (
      <span aria-hidden className="grid size-3.5 shrink-0 place-items-center rounded-full bg-success text-surface">
        <Check size={9} strokeWidth={3} />
      </span>
    )
  if (item.active) return working ? <Spinner label="Under way" className="size-3.5" /> : <span aria-hidden className="block size-3.5 shrink-0 rounded-full border-2 border-accent" />
  return <Circle aria-hidden size={14} strokeWidth={1.5} className="shrink-0 text-border-strong" />
}

/** A checklist the person can change: tick steps, rename them, remove them, and add their own. */
export function ChecklistItems({ items, working, className, onChange, onParallel }: { items: CoderTodo[]; working: boolean; className?: string; onChange?: (items: CoderTodo[]) => void; onParallel?: () => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState('')
  const editable = !!onChange
  const change = (next: CoderTodo[]) => onChange?.(next)
  const toggle = (index: number) => change(items.map((item, i) => (i !== index ? item : item.done ? { text: item.text, done: false } : { text: item.text, done: true })))
  const rename = (index: number) => {
    const text = draft.trim().slice(0, CODER_MAX_TODO_CHARS)
    setEditing(null)
    if (!text || text === items[index]?.text) return
    change(items.map((item, i) => (i === index ? { ...item, text } : item)))
  }
  const add = () => {
    const text = added.trim().slice(0, CODER_MAX_TODO_CHARS)
    if (text && items.length < CODER_MAX_TODO) change([...items, { text, done: false }])
    setAdded('')
  }
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className={cx('group flex min-w-0 items-start gap-2 text-xs leading-snug', item.done ? 'text-text-faint line-through decoration-text-faint/60' : item.active ? 'font-medium text-text' : 'text-text-muted')}>
            {editable ? (
              <button type="button" aria-label={item.done ? `Mark not done: ${item.text}` : `Mark done: ${item.text}`} onClick={() => toggle(i)} className="mt-px flex rounded-full transition-opacity hover:opacity-70">
                <StepMark item={item} working={working} />
              </button>
            ) : (
              <span className="mt-px flex">
                <StepMark item={item} working={working} />
              </span>
            )}
            <span className="sr-only">{item.done ? 'Done: ' : item.active ? 'Under way: ' : 'To do: '}</span>
            {editing === i ? (
              <input
                autoFocus
                value={draft}
                aria-label="Step"
                maxLength={CODER_MAX_TODO_CHARS}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => rename(i)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') rename(i)
                  if (event.key === 'Escape') setEditing(null)
                }}
                className="-my-0.5 h-5 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface px-1 text-xs text-text no-underline outline-none"
              />
            ) : (
              <span
                className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                onDoubleClick={
                  editable
                    ? () => {
                        setDraft(item.text)
                        setEditing(i)
                      }
                    : undefined
                }
              >
                {item.text}
              </span>
            )}
            {editable && editing !== i && (
              <span className="-my-1 flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <IconButton
                  size="sm"
                  label={`Edit step: ${item.text}`}
                  onClick={() => {
                    setDraft(item.text)
                    setEditing(i)
                  }}
                >
                  <Pencil size={11} strokeWidth={1.75} />
                </IconButton>
                <IconButton size="sm" label={`Remove step: ${item.text}`} onClick={() => change(items.filter((_, index) => index !== i))}>
                  <X size={12} strokeWidth={1.75} />
                </IconButton>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editable &&
        items.length < CODER_MAX_TODO &&
        (adding ? (
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Plus aria-hidden size={14} strokeWidth={1.5} className="shrink-0 text-text-faint" />
            <input
              autoFocus
              value={added}
              aria-label="New step"
              placeholder="A step for Terra Code"
              maxLength={CODER_MAX_TODO_CHARS}
              onChange={(event) => setAdded(event.target.value)}
              onBlur={() => {
                add()
                setAdding(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add()
                if (event.key === 'Escape') {
                  setAdded('')
                  setAdding(false)
                }
              }}
              className="h-5 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface px-1 text-xs text-text outline-none placeholder:text-text-faint"
            />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setAdding(true)} className="-mx-1 flex h-6 w-fit items-center gap-2 rounded-md px-1 text-xs text-text-faint transition-colors hover:bg-surface-hover hover:text-text">
              <Plus aria-hidden size={14} strokeWidth={1.5} />
              Add a step
            </button>
            {onParallel && !working && items.filter((item) => !item.done).length >= 2 && (
              <button type="button" onClick={onParallel} title="Hands the steps that don’t depend on each other to helpers working at the same time" className="ml-auto flex h-6 items-center gap-1.5 rounded-md px-1 text-xs text-text-faint transition-colors hover:bg-surface-hover hover:text-text">
                <Split aria-hidden size={13} strokeWidth={1.5} />
                Work on these side by side
              </button>
            )}
          </div>
        ))}
    </div>
  )
}

/** The model's checklist above the message box: the step it's on, opening to every step. Open while it works. */
export function Checklist({ items, working, bare = false, onChange, onParallel }: { items: CoderTodo[]; working: boolean; bare?: boolean; onChange?: (items: CoderTodo[]) => void; onParallel?: () => void }) {
  const [chosen, setChosen] = useState<boolean | null>(null)
  const done = items.filter((item) => item.done).length
  const current = items.find((item) => item.active) ?? items.find((item) => !item.done)
  const open = chosen ?? (working && done < items.length)
  return (
    <section aria-label="Checklist" className={cx('flex flex-col', !bare && 'rounded-lg border border-border bg-surface')}>
      <button type="button" aria-expanded={open} onClick={() => setChosen(!open)} className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-surface-hover">
        <ListChecks aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-muted" />
        <span className="shrink-0 font-medium">Checklist</span>
        <span className="min-w-0 flex-1 truncate text-text-muted">{open ? '' : (current?.text ?? 'All steps done')}</span>
        <span className="shrink-0 text-text-faint tabular-nums">
          {done} of {items.length}
        </span>
        <span aria-hidden className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface-hover">
          <span className="block h-full rounded-full bg-success transition-[width]" style={{ width: `${(done / Math.max(1, items.length)) * 100}%` }} />
        </span>
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform', open && '-rotate-90')} />
      </button>
      {open && <ChecklistItems items={items} working={working} onChange={onChange} onParallel={onParallel} className="sc-scroll-quiet max-h-[28vh] overflow-y-auto px-2.5 pt-0.5 pb-2.5" />}
    </section>
  )
}
