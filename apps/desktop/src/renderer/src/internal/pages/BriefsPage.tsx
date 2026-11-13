import { ArrowUp, BellPlus, CalendarClock, ChevronRight, Download, FileDown, FileText, Headphones, StickyNote, Newspaper, Pencil, Play, Plus, Square, Trash2, Volume2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, cx, IconButton, Input, Select, Switch, Segmented } from '@scbrowser/ui'
import {
  BRIEF_FREQUENCIES,
  BRIEF_SOURCES,
  cleanFollow,
  MAX_BRIEF_FOLLOW,
  SOURCE_LABELS,
  SOURCE_TOPICS,
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
/** A steady hue for a name, so each brief keeps its colour. */
const hueOf = (name: string) => {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return [200, 155, 38, 285, 0, 240, 95, 330][hash % 8]!
}
const hueStyle = (name: string) => ({ '--hue': hueOf(name) }) as CSSProperties
const readMinutes = (text: string) => Math.max(1, Math.round(text.split(/\s+/).length / 220))
const greeting = () => {
  const hour = new Date().getHours()
  return hour < 5 ? 'Hello' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

/** A rounded square with the brief's first letter, in its own colour. */
function Monogram({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span aria-hidden style={hueStyle(name)} className={cx('sc-hued grid shrink-0 place-items-center rounded-md bg-[var(--hued-soft)] font-semibold text-[var(--hued)]', size === 'md' ? 'size-9 text-md' : 'size-7 text-xs')}>
      {name.trim().charAt(0).toUpperCase() || '·'}
    </span>
  )
}

const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const whenLabel = (time: number) => `${dayLabel(time)} at ${clock(time)}`

/** Reads the address's fragment, which names a brief to show. */
const fragmentId = () => decodeURIComponent(location.hash.slice(1)) || null


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
  const source = input.source ?? 'web'
  const web = source === 'web'
  const ready = !web || input.topic.trim().length > 0
  return (
    <form
      aria-label={editing ? 'Change brief' : 'New brief'}
      className="flex flex-col gap-4 rounded-lg bg-surface p-4 shadow-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || busy) return
        setBusy(true)
        setProblem(null)
        onSave({ ...input, topic: web ? input.topic : SOURCE_TOPICS[source].topic, sites: web ? briefSites(sites) : [] })
          .catch((error: unknown) => setProblem(cleanError(error)))
          .finally(() => setBusy(false))
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-muted">Brief me from</span>
        <div className="max-w-md">
          <Segmented
            label="Brief me from"
            value={source}
            options={BRIEF_SOURCES.map((option) => [option, SOURCE_LABELS[option]])}
            onChange={(next) => set({ source: next, ...(next === 'focus' ? { frequency: 'weekly', weekday: 0, time: '18:00', length: 'short' } : {}) })}
          />
        </div>
        {!web && (
          <span className="text-xs text-text-faint">
            {source === 'reading'
              ? 'scAI reads a few of the pages waiting in your reading list and tells you what they say and which to read first.'
              : "scAI looks over your focus timer's week: where the time went, your best day and ideas for next week. Only the timer's totals are sent."}
          </span>
        )}
      </div>
      {web && <Label text="What should scAI research?">
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
      </Label>}
      {web && !editing && !input.topic && (
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
          <Input aria-label="Name" maxLength={MAX_BRIEF_TITLE} placeholder={!web ? SOURCE_TOPICS[source].title : input.topic.trim() ? briefTitle(input.topic) : 'Named after the topic'} value={input.title} onChange={(e) => set({ title: e.target.value })} />
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
      {web && <>
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
      </>}
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

function ScheduleCard({ schedule, running, onEdit, update, onStarted }: { schedule: BriefSchedule; running: boolean; onEdit: () => void; update: (call: Promise<BriefState>) => Promise<void>; onStarted: () => void }) {
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    if (!removing) return
    const timer = setTimeout(() => setRemoving(false), 4000)
    return () => clearTimeout(timer)
  }, [removing])
  const [problem, setProblem] = useState<string | null>(null)
  const source = schedule.source ?? 'web'
  const detail = [scheduleLabel(schedule), LENGTH_LABELS[schedule.length], ...(source !== 'web' ? [`From ${SOURCE_LABELS[source].replace(/^My /, 'your ')}`] : []), ...(schedule.sites?.length ? [`Always ${schedule.sites.join(', ')}`] : []), ...(schedule.onlyNew ? ["Only what's new"] : [])]
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg bg-surface p-3.5 shadow-1">
      <div className={cx('flex items-start gap-3', schedule.paused && 'opacity-60')}>
        <Monogram name={schedule.title} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="truncate font-medium">{schedule.title}</div>
          <div className="truncate text-xs text-text-faint" title={detail.join(' · ')}>
            {detail.join(' · ')}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <CalendarClock aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
            <span className="truncate">{schedule.paused ? 'Paused' : `Next ${whenLabel(schedule.nextRunAt).replace(/^(Today|Tomorrow|Yesterday)/, (c) => c.toLowerCase())}`}</span>
          </div>
        </div>
        <Switch label={schedule.paused ? `Resume ${schedule.title}` : `Pause ${schedule.title}`} checked={!schedule.paused} onChange={(on) => void update(api().invoke('briefs:pause', schedule.id, !on))} />
      </div>
      {(schedule.follows?.length ?? 0) > 0 && (
        <ul aria-label="Stories followed" className="flex flex-wrap gap-1.5">
          {schedule.follows!.map((story) => (
            <li key={story} className="flex h-6 max-w-full items-center gap-1 rounded-md bg-surface-hover pr-0.5 pl-2 text-xs">
              <BellPlus aria-hidden size={11} strokeWidth={1.75} className="shrink-0 text-text-faint" />
              <span className="truncate">{story}</span>
              <button type="button" aria-label={`Stop following ${story}`} className="grid size-5 shrink-0 place-items-center rounded-sm text-text-faint hover:bg-surface-active hover:text-text" onClick={() => void update(api().invoke('briefs:unfollow', schedule.id, story))}>
                <X aria-hidden size={10} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1 border-t border-border pt-2.5">
        <Button
          variant="ghost"
          className="h-7 shrink-0 px-2"
          disabled={running}
          onClick={() => {
            setProblem(null)
            void update(api().invoke('briefs:run', schedule.id)).catch((error: unknown) => setProblem(cleanError(error)))
            // The call only answers once the brief is written, so the card is told it has started.
            setTimeout(onStarted, 150)
          }}
        >
          {running ? <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Play aria-hidden size={12} strokeWidth={2} />}
          {running ? 'Writing…' : 'Run now'}
        </Button>
        <span className="flex-1" />
        <IconButton size="sm" label={`Change ${schedule.title}`} onClick={onEdit}>
          <Pencil size={12} strokeWidth={1.75} />
        </IconButton>
        {removing ? (
          <Button variant="ghost" className="h-7 shrink-0 px-2 text-danger" onClick={() => void update(api().invoke('briefs:remove', schedule.id))}>
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
    <div className="flex flex-col gap-2.5">
      <form
        aria-label={`Ask about ${issue.title}`}
        className="flex items-center gap-2 rounded-lg border border-border bg-field py-1 pr-1 pl-3 transition-colors focus-within:border-border-strong"
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
        <input
          aria-label="Ask about this brief"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          maxLength={MAX_BRIEF_QUESTION}
          placeholder="Ask a follow-up about this brief"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" variant="primary" aria-label="Ask" className="size-8 shrink-0 px-0" disabled={!question.trim() || busy}>
          <ArrowUp aria-hidden size={15} strokeWidth={2} />
        </Button>
      </form>
      {asked && <p className="self-end rounded-lg bg-surface-hover px-3 py-1.5 text-sm">{asked}</p>}
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

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * A brief as a page to print: the text as it's drawn here (no scripts, images or raw HTML ever
 * reach it), with its sources, under a policy that blocks every request.
 */
function briefHtml(issue: BriefIssue, prose: HTMLElement, sources: BriefIssue['sources']): string {
  const list = sources.map((source) => `<li>${escapeHtml(source.title || hostOf(source.url))} <span class="host">${escapeHtml(source.url)}</span></li>`).join('')
  const when = new Date(issue.createdAt).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(issue.title)}</title><style>
body{font:15px/1.65 system-ui,sans-serif;color:#111;max-width:680px;margin:0 auto}
h1{font-size:26px;letter-spacing:-.02em;margin:0 0 4px}.meta{color:#6b6b6b;font-size:12px;margin-bottom:24px}
h2,h3{font-size:17px;margin:22px 0 6px}ul,ol{padding-left:22px}li{margin:4px 0}li::marker{color:#2fa3a8}
button{all:unset}.sc-cite{display:inline-block;min-width:14px;padding:0 4px;border-radius:4px;background:#e6f4f5;color:#1b7479;font-size:10px;text-align:center;vertical-align:2px}
.sources{border-top:1px solid #e4e4e4;margin-top:28px;padding-top:12px;font-size:12px}.sources h2{font-size:12px;color:#555;margin:0 0 6px}.host{color:#8a8a8a}
</style></head><body><h1>${escapeHtml(issue.title)}</h1><div class="meta">${escapeHtml(when)} · AI Brief from scTerra</div>${prose.innerHTML}${list ? `<div class="sources"><h2>Sources</h2><ol>${list}</ol></div>` : ''}</body></html>`
}

/** A brief as Markdown, with its sources as a numbered list. */
const briefMarkdown = (issue: BriefIssue, sources: BriefIssue['sources']) =>
  `# ${issue.title}\n\n${issue.text}\n${sources.length ? `\n## Sources\n\n${sources.map((source) => `${source.n}. [${source.title || hostOf(source.url)}](${source.url})`).join('\n')}\n` : ''}`

/** Save as PDF or Markdown, or add to the new tab's notes. */
function SaveMenu({ issue, sources, prose, onDone }: { issue: BriefIssue; sources: BriefIssue['sources']; prose: () => HTMLElement | null; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const run = (call: () => Promise<unknown>, success: (result: unknown) => string | null) => {
    setOpen(false)
    call()
      .then((result) => {
        const message = success(result)
        if (message) onDone(message)
      })
      .catch((error: unknown) => onDone(cleanError(error)))
  }
  const item = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-surface-hover'
  return (
    <div ref={root} className="relative">
      <Button variant="ghost" className="h-7 px-2" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Download aria-hidden size={13} strokeWidth={1.75} />
        Save
      </Button>
      {open && (
        <div role="menu" aria-label="Save this brief" className="absolute top-8 left-0 z-10 flex w-52 flex-col rounded-lg border border-border bg-surface p-1 shadow-2">
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              const element = prose()
              if (element) run(() => api().invoke('report:save', issue.title, 'pdf', briefHtml(issue, element, sources)), (saved) => (saved ? 'Saved as a PDF' : null))
            }}
          >
            <FileText aria-hidden size={14} strokeWidth={1.75} className="text-text-faint" />
            Save as PDF
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => run(() => api().invoke('report:save', issue.title, 'md', briefMarkdown(issue, sources)), (saved) => (saved ? 'Saved as Markdown' : null))}>
            <FileDown aria-hidden size={14} strokeWidth={1.75} className="text-text-faint" />
            Save as Markdown
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => run(() => api().invoke('briefs:to-notes', issue.id), (message) => String(message))}>
            <StickyNote aria-hidden size={14} strokeWidth={1.75} className="text-text-faint" />
            Add to new tab notes
          </button>
        </div>
      )}
    </div>
  )
}

/** Follows a story from this brief, starting from any words selected in it. */
function FollowForm({ initial, onFollow, onCancel }: { initial: string; onFollow: (story: string) => Promise<void>; onCancel: () => void }) {
  const [story, setStory] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <form
      aria-label="Follow a story"
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (story.trim()) onFollow(story).catch((error: unknown) => setProblem(cleanError(error)))
      }}
    >
      <span className="text-xs text-text-muted">Each brief after this starts with what's new on it.</span>
      <div className="flex gap-2">
        <Input ref={ref} aria-label="Story to follow" className="min-w-0 flex-1" maxLength={MAX_BRIEF_FOLLOW} placeholder="For example: the chip export rules" value={story} onChange={(e) => setStory(e.target.value)} />
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!story.trim()}>
          Follow
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </form>
  )
}

function IssueCard({ issue, open, onToggle, onDelete, canFollow, onFollow, icons }: { issue: BriefIssue; open: boolean; onToggle: () => void; onDelete: () => void; canFollow: boolean; onFollow: (story: string) => Promise<void>; icons: Record<string, string> }) {
  const speech = useSpeak(issue.id)
  const preview = briefPreview(issue.text)
  const sources = issue.sources.filter((source) => !/duckduckgo\.com$/.test(hostOf(source.url)) && /^https?:/i.test(source.url))
  const meta = [clock(issue.createdAt), LENGTH_LABELS[issue.length], `${readMinutes(issue.text)} min read`, ...(sources.length ? [`${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`] : [])]
  const proseRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(null), 4000)
    return () => clearTimeout(timer)
  }, [note])
  return (
    <article id={issue.id} aria-label={issue.title} className={cx('flex scroll-mt-6 flex-col rounded-lg bg-surface transition-shadow', open ? 'shadow-2' : 'shadow-1 hover:shadow-2')}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-start gap-3.5 rounded-lg p-4 text-left">
        <Monogram name={issue.title} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h3 className={cx('truncate font-semibold tracking-[-0.01em]', open ? 'text-lg' : 'text-md')}>{issue.title}</h3>
            {issue.unseen && (
              <span aria-label="New" className="shrink-0 rounded-sm bg-accent-soft px-1.5 py-px text-2xs font-medium text-accent">
                New
              </span>
            )}
          </div>
          <div className="text-xs text-text-faint">{meta.join(' · ')}</div>
          {!open && <p className="mt-1.5 line-clamp-2 text-text-muted">{preview}</p>}
        </div>
        <ChevronRight aria-hidden size={15} strokeWidth={2} className={cx('mt-1 shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="flex flex-col gap-5 px-4 pb-5 sm:pr-6 sm:pl-[4.125rem]">
          <div className="flex flex-wrap items-center gap-1 border-y border-border py-1.5">
            <Button variant="ghost" className="h-7 px-2" aria-pressed={speech.speaking} onClick={() => speech.toggle(`${issue.title}. ${speechText(issue.text)}`)}>
              {speech.speaking ? <Square aria-hidden size={11} strokeWidth={2} /> : <Volume2 aria-hidden size={13} strokeWidth={1.75} />}
              {speech.speaking ? 'Stop' : 'Listen'}
            </Button>
            <CopyReply text={issue.text} />
            <SaveMenu issue={issue} sources={sources} prose={() => proseRef.current} onDone={setNote} />
            {canFollow && (
              <Button
                variant="ghost"
                className="h-7 px-2"
                aria-expanded={following !== null}
                onClick={() => {
                  const selected = window.getSelection()
                  const inside = selected && proseRef.current?.contains(selected.anchorNode) ? selected.toString() : ''
                  setFollowing(following === null ? cleanFollow(inside) : null)
                }}
              >
                <BellPlus aria-hidden size={13} strokeWidth={1.75} />
                Follow a story
              </Button>
            )}
            <span className="flex-1" />
            {note && (
              <span role="status" className="text-xs text-text-muted">
                {note}
              </span>
            )}
            <IconButton size="sm" label="Delete this brief" onClick={onDelete}>
              <Trash2 size={12} strokeWidth={1.75} />
            </IconButton>
          </div>
          {following !== null && (
            <FollowForm
              initial={following}
              onCancel={() => setFollowing(null)}
              onFollow={async (story) => {
                await onFollow(story)
                setFollowing(null)
                setNote(`Following “${cleanFollow(story)}”`)
              }}
            />
          )}
          {speech.problem && (
            <p role="alert" className="text-xs text-danger">
              {speech.problem}
            </p>
          )}
          <div ref={proseRef} className="sc-brief-prose select-text">
            <ReplyMarkdown text={issue.text} onOpenLink={openLink} sources={issue.sources} onOpenSource={openSource} />
          </div>
          {sources.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-medium text-text-muted">Sources</h4>
              <ol className="grid grid-cols-2 gap-2 max-[560px]:grid-cols-1">
                {sources.map((source) => {
                  const host = hostOf(source.url)
                  const icon = icons[host]
                  return (
                    <li key={source.n} className="min-w-0">
                      <button
                        type="button"
                        title={source.url}
                        className="flex w-full items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                        onClick={() => openSource(source, { quote: null, seconds: null })}
                      >
                        <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-accent-soft text-2xs font-medium text-accent tabular-nums">{source.n}</span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-xs font-medium">{source.title || host}</span>
                          <span className="flex min-w-0 items-center gap-1 text-2xs text-text-faint">
                            {icon && <img src={icon} alt="" className="size-3 shrink-0 rounded-[2px]" />}
                            <span className="truncate">{host}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
          <AskBrief issue={issue} />
        </div>
      )}
    </article>
  )
}

/** Today's briefs as one front page, to skim or hear one after another. */
function Edition({ issues, onOpen }: { issues: BriefIssue[]; onOpen: (id: string) => void }) {
  const speech = useSpeak('edition')
  const minutes = issues.reduce((sum, issue) => sum + readMinutes(issue.text), 0)
  const unseen = issues.filter((issue) => issue.unseen)
  const queue = unseen.length > 0 ? unseen : issues
  return (
    <section aria-label="Today's edition" className="flex flex-col gap-3 rounded-lg bg-surface p-4 shadow-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold">Today's edition</h2>
          <span className="text-xs text-text-faint">
            {issues.length} briefs · about {minutes} min to read
          </span>
        </div>
        <Button aria-pressed={speech.speaking} onClick={() => speech.toggle(queue.map((issue, index) => `${index === 0 ? '' : 'Next. '}${issue.title}. ${speechText(issue.text)}`).join(' '))}>
          {speech.speaking ? <Square aria-hidden size={11} strokeWidth={2} /> : <Headphones aria-hidden size={13} strokeWidth={1.75} />}
          {speech.speaking ? 'Stop' : unseen.length > 0 && unseen.length < issues.length ? `Listen to the ${unseen.length} new` : 'Listen to all'}
        </Button>
      </div>
      {speech.problem && (
        <p role="alert" className="text-xs text-danger">
          {speech.problem}
        </p>
      )}
      <ol className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-3 max-[640px]:grid-cols-1">
        {issues.map((issue) => (
          <li key={issue.id} className="min-w-0">
            <button type="button" className="group flex w-full min-w-0 flex-col gap-0.5 text-left" onClick={() => onOpen(issue.id)}>
              <span className="flex items-center gap-1.5 text-2xs font-medium text-text-faint">
                {issue.unseen && <span aria-label="New" className="size-1.5 rounded-full bg-accent" />}
                {clock(issue.createdAt)}
              </span>
              <span className="truncate font-semibold group-hover:text-accent">{issue.title}</span>
              <span className="line-clamp-2 text-xs text-text-muted">{briefPreview(issue.text, 160)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Briefs under a heading for each day. */
function byDay(issues: BriefIssue[]): [string, BriefIssue[]][] {
  const groups = new Map<string, BriefIssue[]>()
  for (const issue of issues) {
    const label = dayLabel(issue.createdAt)
    groups.set(label, [...(groups.get(label) ?? []), issue])
  }
  return [...groups]
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
  const [icons, setIcons] = useState<Record<string, string>>({})
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

  // Icons saved for bookmarked sites, so sources show them without contacting anyone.
  const hostList = [...new Set((state?.issues ?? []).flatMap((issue) => issue.sources.map((source) => hostOf(source.url))))].slice(0, 50).join(' ')
  useEffect(() => {
    if (!hostList) return
    void api().invoke('site-icons:for', hostList.split(' ')).then(setIcons).catch(() => undefined)
  }, [hostList])

  useEffect(() => {
    const onHash = () => load()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [load])

  if (!state) return null
  const unseen = state.issues.filter((issue) => issue.unseen).length
  const todays = state.issues.filter((issue) => dayLabel(issue.createdAt) === 'Today')
  const openBrief = (id: string) => {
    show(id)
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const save = async (input: BriefInput) => {
    setState(await api().invoke('briefs:save', form?.id ?? null, input))
    setForm(null)
  }

  const nextUp = state.schedules.filter((schedule) => !schedule.paused).toSorted((a, b) => a.nextRunAt - b.nextRunAt)[0]
  const line = [
    new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
    unseen > 0 ? `${unseen} new ${unseen === 1 ? 'brief' : 'briefs'}` : state.issues.length > 0 ? "You're all caught up" : null,
    nextUp ? `Next: ${nextUp.title}, ${whenLabel(nextUp.nextRunAt).replace(/^(Today|Tomorrow|Yesterday)/, (c) => c.toLowerCase())}` : null
  ].filter(Boolean)

  return (
    <>
      <header className="sc-briefs-masthead flex flex-col gap-5 rounded-lg px-6 pt-6 pb-5 shadow-1">
        <div className="flex items-start justify-between gap-4 max-[560px]:flex-col">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
              <Newspaper aria-hidden size={13} strokeWidth={2} />
              AI Briefs
            </span>
            <h1 className="text-display leading-[1.1] font-semibold tracking-[-0.035em] max-[720px]:text-xl">{greeting()}</h1>
            <p className="text-sm text-text-muted">{line.join(' · ')}</p>
          </div>
          {!form && (
            <Button variant="primary" className="shrink-0" onClick={() => setForm({ id: null, input: blankInput() })}>
              <Plus aria-hidden size={14} strokeWidth={2} />
              New brief
            </Button>
          )}
        </div>
        <p className="max-w-[60ch] text-xs text-text-muted">
          Tell scAI what to keep you up to date on, and when. At that time it searches the web and writes you a brief, which waits here, on the new tab page and in the toolbar. If scTerra is closed then, it writes it as soon as scTerra opens.
        </p>
        {state.hosted === null && (
          <p role="alert" className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-muted">
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
      </header>

      {form && <BriefForm key={form.id ?? 'new'} initial={form.input} editing={form.id !== null} onSave={save} onCancel={() => setForm(null)} />}

      {todays.length >= 2 && <Edition issues={todays} onOpen={openBrief} />}

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
          byDay(state.issues).map(([day, issues]) => (
            <div key={day} className="flex flex-col gap-2.5">
              <h3 className="pt-1 text-xs font-medium text-text-faint">{day}</h3>
              {issues.map((issue) => (
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
                  canFollow={(state.schedules.find((schedule) => schedule.id === issue.scheduleId)?.source ?? 'web') === 'web' && state.schedules.some((schedule) => schedule.id === issue.scheduleId)}
                  onFollow={async (story) => setState(await api().invoke('briefs:follow', issue.scheduleId, story))}
                  icons={icons}
                />
              ))}
            </div>
          ))
        )}
      </section>

      {state.schedules.length > 0 && (
        <section aria-label="Scheduled briefs" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Scheduled</h2>
          <ul className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
            {state.schedules.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                running={state.running.includes(schedule.id)}
                update={update}
                onStarted={load}
                onEdit={() => setForm({ id: schedule.id, input: { title: schedule.title, topic: schedule.topic, time: schedule.time, frequency: schedule.frequency, weekday: schedule.weekday, length: schedule.length, sites: schedule.sites ?? [], onlyNew: schedule.onlyNew ?? false, source: schedule.source ?? 'web' } })}
              />
            ))}
          </ul>
        </section>
      )}

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
