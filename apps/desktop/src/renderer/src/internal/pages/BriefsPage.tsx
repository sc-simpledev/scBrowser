import { ChevronRight, Newspaper, Pencil, Play, Plus, Square, Trash2, Volume2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, cx, IconButton, Input, Select, Switch } from '@scbrowser/ui'
import {
  BRIEF_FREQUENCIES,
  BRIEF_IDEAS,
  BRIEF_LENGTHS,
  briefPreview,
  briefSites,
  briefTitle,
  MAX_BRIEF_QUESTION,
  speechText,
  FREQUENCY_LABELS,
  HOSTED_BRIEFS_PER_DAY,
  LENGTH_LABELS,
  MAX_BRIEF_TITLE,
  MAX_BRIEF_TOPIC,
  scheduleLabel,
  WEEKDAYS,
  type BriefInput,
  type BriefIssue,
  type BriefLength,
  type BriefSchedule,
  type BriefState
} from '@scbrowser/shared'
import { api } from '../api'
import { EmptyState } from '../EmptyState'
import { CopyReply, ReplyMarkdown, type OpenSource } from '../../shared/ReplyContent'
import { useSpeak } from '../../shared/speak'

const openLink = (href: string) => void api().invoke('browser:open', href)
const openSource: OpenSource = (source, target) => void api().invoke('ai:open-source', { tabId: source.tabId, url: source.url }, target)
const cleanError = (error: unknown) => (error instanceof Error ? error.message.replace(/^.*Error: /, '') : "Something went wrong.")
const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : url)

const LENGTH_HINTS: Record<BriefLength, string> = {
  short: 'A few bullet points. About a minute to read.',
  medium: 'The main stories with a little detail. About two minutes.',
  long: 'Each story explained, with what to watch next. Five minutes or so.'
}

function dayLabel(time: number): string {
  const day = new Date(time)
  const today = new Date()
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((start(day) - start(today)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === -1) return 'Yesterday'
  if (days === 1) return 'Tomorrow'
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const whenLabel = (time: number) => `${dayLabel(time)} at ${clock(time)}`

/** Reads the address's fragment, which names a brief to show. */
const fragmentId = () => decodeURIComponent(location.hash.slice(1)) || null

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-border p-0.5">
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cx('h-7 flex-1 rounded-sm px-2 text-sm transition-colors', value === option ? 'bg-surface-hover font-medium text-text' : 'text-text-muted hover:text-text')}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-text-muted">{text}</span>
      {children}
    </label>
  )
}

const blankInput = (topic = ''): BriefInput => ({ title: '', topic, time: '08:00', frequency: 'daily', weekday: new Date().getDay(), length: 'medium', sites: [], onlyNew: false })

/** Setting up a brief, or changing one. */
function BriefForm({ initial, editing, onSave, onCancel }: { initial: BriefInput; editing: boolean; onSave: (input: BriefInput) => Promise<void>; onCancel: () => void }) {
  const [input, setInput] = useState(initial)
  const [sites, setSites] = useState((initial.sites ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const topicRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => topicRef.current?.focus(), [])
  const set = (patch: Partial<BriefInput>) => setInput((current) => ({ ...current, ...patch }))
  const ready = input.topic.trim().length > 0
  return (
    <form
      aria-label={editing ? 'Change brief' : 'New brief'}
      className="flex flex-col gap-4 rounded-lg bg-surface p-4 shadow-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || busy) return
        setBusy(true)
        setProblem(null)
        onSave({ ...input, sites: briefSites(sites) })
          .catch((error: unknown) => setProblem(cleanError(error)))
          .finally(() => setBusy(false))
      }}
    >
      <Label text="What should scAI research?">
        <textarea
          ref={topicRef}
          aria-label="What should scAI research?"
          rows={2}
          maxLength={MAX_BRIEF_TOPIC}
          placeholder="For example: the latest AI news, with anything about open models"
          value={input.topic}
          onChange={(e) => set({ topic: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          className="resize-none rounded-md border border-border bg-field px-2.5 py-1.5 text-sm text-text outline-none placeholder:text-text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
        />
      </Label>
      {!editing && !input.topic && (
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {BRIEF_IDEAS.map((idea) => (
            <button key={idea} type="button" className="h-6 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text" onClick={() => set({ topic: idea })}>
              {idea}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 max-[560px]:grid-cols-2">
        <Label text="Name">
          <Input aria-label="Name" maxLength={MAX_BRIEF_TITLE} placeholder={input.topic.trim() ? briefTitle(input.topic) : 'Named after the topic'} value={input.title} onChange={(e) => set({ title: e.target.value })} />
        </Label>
        <Label text="Time">
          <Input aria-label="Time" type="time" required className="w-28" value={input.time} onChange={(e) => e.target.value && set({ time: e.target.value })} />
        </Label>
        <Label text="Repeat">
          <div className="flex gap-2">
            <Select aria-label="Repeat" className="w-36" value={input.frequency} onChange={(e) => set({ frequency: e.target.value as BriefInput['frequency'] })}>
              {BRIEF_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {FREQUENCY_LABELS[frequency]}
                </option>
              ))}
            </Select>
            {input.frequency === 'weekly' && (
              <Select aria-label="Day" className="w-32" value={input.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    on {day}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </Label>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-muted">Length</span>
        <div className="max-w-80">
          <Segmented label="Length" value={input.length} options={BRIEF_LENGTHS.map((length) => [length, LENGTH_LABELS[length]])} onChange={(length) => set({ length })} />
        </div>
        <span className="text-xs text-text-faint">{LENGTH_HINTS[input.length]}</span>
      </div>
      <Label text="Always include these sites (optional)">
        <Input aria-label="Always include these sites" placeholder="theverge.com, arstechnica.com" value={sites} onChange={(e) => setSites(e.target.value)} onBlur={() => setSites(briefSites(sites).join(', '))} />
      </Label>
      <label className="flex items-center justify-between gap-4">
        <span className="flex flex-col">
          <span>Only what's new</span>
          <span className="text-xs text-text-faint">Leaves out what the last brief already told you.</span>
        </span>
        <Switch label="Only what's new" checked={input.onlyNew ?? false} onChange={(onlyNew) => set({ onlyNew })} />
      </label>
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!ready || busy}>
          {editing ? 'Save changes' : 'Add brief'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ScheduleRow({ schedule, running, onEdit, update, onStarted }: { schedule: BriefSchedule; running: boolean; onEdit: () => void; update: (call: Promise<BriefState>) => Promise<void>; onStarted: () => void }) {
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    if (!removing) return
    const timer = setTimeout(() => setRemoving(false), 4000)
    return () => clearTimeout(timer)
  }, [removing])
  const [problem, setProblem] = useState<string | null>(null)
  const detail = [scheduleLabel(schedule), LENGTH_LABELS[schedule.length], ...(schedule.sites?.length ? [`Always ${schedule.sites.join(', ')}`] : []), ...(schedule.onlyNew ? ["Only what's new"] : []), schedule.paused ? 'Paused' : `Next ${whenLabel(schedule.nextRunAt).replace(/^\w/, (c) => c.toLowerCase())}`]
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex items-center gap-3">
        <div className={cx('min-w-0 flex-1', schedule.paused && 'opacity-60')}>
          <div className="truncate font-medium">{schedule.title}</div>
          <div className="truncate text-xs text-text-faint">{detail.join(' · ')}</div>
        </div>
        <Button
          variant="ghost"
          className="shrink-0"
          disabled={running}
          onClick={() => {
            setProblem(null)
            void update(api().invoke('briefs:run', schedule.id)).catch((error: unknown) => setProblem(cleanError(error)))
            // The call only answers once the brief is written, so the row is told it has started.
            setTimeout(onStarted, 150)
          }}
        >
          {running ? <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Play aria-hidden size={12} strokeWidth={2} />}
          {running ? 'Writing…' : 'Run now'}
        </Button>
        <Switch label={schedule.paused ? `Resume ${schedule.title}` : `Pause ${schedule.title}`} checked={!schedule.paused} onChange={(on) => void update(api().invoke('briefs:pause', schedule.id, !on))} />
        <IconButton size="sm" label={`Change ${schedule.title}`} onClick={onEdit}>
          <Pencil size={12} strokeWidth={1.75} />
        </IconButton>
        {removing ? (
          <Button variant="ghost" className="shrink-0 text-danger" onClick={() => void update(api().invoke('briefs:remove', schedule.id))}>
            Remove?
          </Button>
        ) : (
          <IconButton size="sm" label={`Remove ${schedule.title}`} onClick={() => setRemoving(true)}>
            <X size={12} strokeWidth={2} />
          </IconButton>
        )}
      </div>
      {(problem ?? schedule.error) && (
        <p role="alert" className="text-xs text-danger">
          {problem ?? schedule.error}
        </p>
      )}
    </li>
  )
}

/** One brief to read: its first lines while folded, all of it with its sources when open. */
/** A question about one brief, answered under it. Asking again replaces the answer; nothing is kept. */
function AskBrief({ issue }: { issue: BriefIssue }) {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const busy = asked !== null && answer === null && problem === null
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <form
        aria-label={`Ask about ${issue.title}`}
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const text = question.trim()
          if (!text || busy) return
          setAsked(text)
          setAnswer(null)
          setProblem(null)
          setQuestion('')
          api()
            .invoke('briefs:ask', issue.id, text)
            .then((reply) => (reply ? setAnswer(reply) : setProblem('The AI sent back nothing. Try again.')))
            .catch((error: unknown) => setProblem(cleanError(error)))
        }}
      >
        <Input aria-label="Ask about this brief" className="min-w-0 flex-1" maxLength={MAX_BRIEF_QUESTION} placeholder="Ask about this brief" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" disabled={!question.trim() || busy}>
          Ask
        </Button>
      </form>
      {asked && <p className="text-xs text-text-muted">{asked}</p>}
      {busy && (
        <p role="status" className="flex items-center gap-2 text-xs text-text-faint">
          <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Thinking…
        </p>
      )}
      {answer && (
        <div className="select-text">
          <ReplyMarkdown text={answer} onOpenLink={openLink} sources={issue.sources} onOpenSource={openSource} />
        </div>
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </div>
  )
}

function IssueCard({ issue, open, onToggle, onDelete }: { issue: BriefIssue; open: boolean; onToggle: () => void; onDelete: () => void }) {
  const speech = useSpeak(issue.id)
  const preview = briefPreview(issue.text)
  const sources = issue.sources.filter((source) => !/duckduckgo\.com$/.test(hostOf(source.url)))
  return (
    <article id={issue.id} aria-label={issue.title} className="flex scroll-mt-6 flex-col rounded-lg bg-surface shadow-1">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-start gap-3 rounded-lg p-4 text-left">
        <ChevronRight aria-hidden size={14} strokeWidth={2} className={cx('mt-1 shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            {issue.unseen && <span aria-label="New" className="size-1.5 shrink-0 rounded-full bg-accent" />}
            <h3 className="truncate font-semibold">{issue.title}</h3>
          </div>
          <div className="text-xs text-text-faint">
            {whenLabel(issue.createdAt)} · {LENGTH_LABELS[issue.length]}
          </div>
          {!open && <p className="mt-1 line-clamp-2 text-text-muted">{preview}</p>}
        </div>
      </button>
      {open && (
        <div className="flex flex-col gap-4 px-4 pb-4 pl-11">
          <div className="select-text">
            <ReplyMarkdown text={issue.text} onOpenLink={openLink} sources={issue.sources} onOpenSource={openSource} />
          </div>
          {sources.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <h4 className="text-xs font-medium text-text-muted">Sources</h4>
              <ol className="flex flex-col">
                {sources.map((source) => (
                  <li key={source.n} className="min-w-0">
                    <button type="button" className="flex max-w-full items-baseline gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-surface-hover" onClick={() => openSource(source, { quote: null, seconds: null })}>
                      <span className="shrink-0 text-text-faint tabular-nums">{source.n}</span>
                      <span className="truncate">{source.title || hostOf(source.url)}</span>
                      <span className="shrink-0 text-text-faint">{hostOf(source.url)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <AskBrief issue={issue} />
          {speech.problem && (
            <p role="alert" className="text-xs text-danger">
              {speech.problem}
            </p>
          )}
          <div className="flex items-center gap-1">
            <Button variant="ghost" aria-pressed={speech.speaking} onClick={() => speech.toggle(`${issue.title}. ${speechText(issue.text)}`)}>
              {speech.speaking ? <Square aria-hidden size={11} strokeWidth={2} /> : <Volume2 aria-hidden size={13} strokeWidth={1.75} />}
              {speech.speaking ? 'Stop' : 'Listen'}
            </Button>
            <CopyReply text={issue.text} />
            <IconButton size="sm" label="Delete this brief" onClick={onDelete}>
              <Trash2 size={12} strokeWidth={1.75} />
            </IconButton>
          </div>
        </div>
      )}
    </article>
  )
}

/**
 * AI Briefs: research the person sets up once and gets at a time of their choosing, every day,
 * every other day or every week, from a web search and their chat model.
 */
export function BriefsPage() {
  const [state, setState] = useState<BriefState | null>(null)
  const [form, setForm] = useState<{ id: string | null; input: BriefInput } | null>(() => {
    const wanted = new URLSearchParams(location.search).get('new')
    return wanted === null ? null : { id: null, input: blankInput(wanted.slice(0, MAX_BRIEF_TOPIC)) }
  })
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const picked = useRef(false)

  const load = useCallback(() => void api().invoke('briefs:state').then(setState), [])
  const update = useCallback(async (call: Promise<BriefState>) => {
    try {
      setState(await call)
    } finally {
      load()
    }
  }, [load])

  useEffect(() => {
    load()
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [load])

  // Quicker while one is being written, so it shows as soon as it's done.
  const busy = (state?.running.length ?? 0) > 0
  useEffect(() => {
    const timer = setInterval(load, busy ? 3_000 : 30_000)
    return () => clearInterval(timer)
  }, [busy, load])

  const show = useCallback((id: string) => {
    setOpenIds((current) => new Set(current).add(id))
    void api().invoke('briefs:seen', id)
  }, [])

  // Opens the brief named in the address, or else the newest unread one.
  useEffect(() => {
    if (!state) return
    const wanted = fragmentId()
    const target = (wanted && state.issues.find((issue) => issue.id === wanted)) || (!picked.current ? state.issues.find((issue) => issue.unseen) : undefined)
    if (target && !openIds.has(target.id)) {
      show(target.id)
      requestAnimationFrame(() => document.getElementById(target.id)?.scrollIntoView({ block: 'start' }))
    }
    picked.current = true
    if (wanted) history.replaceState(null, '', location.pathname + location.search)
  }, [state, openIds, show])

  useEffect(() => {
    const onHash = () => load()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [load])

  if (!state) return null
  const unseen = state.issues.filter((issue) => issue.unseen).length
  const save = async (input: BriefInput) => {
    setState(await api().invoke('briefs:save', form?.id ?? null, input))
    setForm(null)
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-text-muted">
          Tell scAI what to keep you up to date on, and when. At that time it searches the web and writes you a brief, which waits here, on the new tab page and in the toolbar. If scTerra is closed then, it writes it as soon as scTerra opens.
        </p>
        {!form && (
          <Button variant="primary" className="shrink-0" onClick={() => setForm({ id: null, input: blankInput() })}>
            <Plus aria-hidden size={14} strokeWidth={2} />
            New brief
          </Button>
        )}
      </div>

      {state.hosted === null && (
        <p role="alert" className="rounded-md border border-border px-3 py-2 text-xs text-text-muted">
          Briefs need an AI model.{' '}
          <a href="sc://ai/" className="sc-link">
            Choose one in AI settings
          </a>
          .
        </p>
      )}
      {state.hosted === true && (
        <p className="text-xs text-text-faint">
          On scTerra AI, you get {HOSTED_BRIEFS_PER_DAY} briefs a day ({state.hostedLeft} left today). Briefs on your own API key have no limit.
        </p>
      )}

      {form && <BriefForm key={form.id ?? 'new'} initial={form.input} editing={form.id !== null} onSave={save} onCancel={() => setForm(null)} />}

      {state.schedules.length > 0 && (
        <section aria-label="Scheduled briefs" className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Scheduled</h2>
          <ul className="flex flex-col divide-y divide-border">
            {state.schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                running={state.running.includes(schedule.id)}
                update={update}
                onStarted={load}
                onEdit={() => setForm({ id: schedule.id, input: { title: schedule.title, topic: schedule.topic, time: schedule.time, frequency: schedule.frequency, weekday: schedule.weekday, length: schedule.length, sites: schedule.sites ?? [], onlyNew: schedule.onlyNew ?? false } })}
              />
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Your briefs" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{unseen > 0 ? `Your briefs · ${unseen} new` : 'Your briefs'}</h2>
          {unseen > 0 && (
            <Button variant="ghost" onClick={() => void api().invoke('briefs:seen', null).then(load)}>
              Mark all as read
            </Button>
          )}
        </div>
        {state.issues.length === 0 ? (
          state.schedules.length === 0 ? (
            <EmptyState icon={Newspaper} title="No briefs yet">
              Set one up, like “Latest AI news” every day at 8:00, and it will appear here.
            </EmptyState>
          ) : (
            <p className="text-text-muted">{busy ? 'Writing your first brief…' : 'Your first brief will appear here at its time. Press Run now to see one straight away.'}</p>
          )
        ) : (
          state.issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              open={openIds.has(issue.id)}
              onToggle={() => {
                if (openIds.has(issue.id)) {
                  const next = new Set(openIds)
                  next.delete(issue.id)
                  setOpenIds(next)
                } else show(issue.id)
              }}
              onDelete={() => void update(api().invoke('briefs:delete-issue', issue.id))}
            />
          ))
        )}
      </section>

      <section aria-label="Brief options" className="flex flex-col gap-3 border-t border-border pt-4">
        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span>Open new briefs when scTerra starts</span>
            <span className="text-xs text-text-faint">The first time you open scTerra after a brief is written, it opens in a tab.</span>
          </span>
          <Switch label="Open new briefs when scTerra starts" checked={state.prefs.openOnStart} onChange={(openOnStart) => void update(api().invoke('briefs:prefs', { openOnStart }))} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span>Notify me when a brief is ready</span>
            <span className="text-xs text-text-faint">A system notification while scTerra is open.</span>
          </span>
          <Switch label="Notify me when a brief is ready" checked={state.prefs.notify} onChange={(notify) => void update(api().invoke('briefs:prefs', { notify }))} />
        </label>
      </section>
    </>
  )
}
