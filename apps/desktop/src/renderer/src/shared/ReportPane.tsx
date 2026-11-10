import { ArrowUp, BookmarkPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, EllipsisVertical, FileText, GitCompareArrows, GraduationCap, Highlighter, List, Maximize2, MessageCircleQuestion, Pencil, Presentation, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import contentCss from '@scbrowser/ui/content.css?raw'
import tokensCss from '@scbrowser/ui/tokens.css?raw'
import { Button, cx, IconButton, Select } from '@scbrowser/ui'
import {
  cardKey,
  changeCounts,
  diffReports,
  DOCUMENT_FORMATS,
  quizCsv,
  dueLabel,
  isDue,
  orderCards,
  quizCardsOf,
  quizWorksheetHtml,
  REPORT_FORMATS,
  REPORT_THEMES,
  reportHtml,
  reportMarkdown,
  STRUCTURED_FORMATS,
  type CardProgress,
  type CitationSource,
  type QuizProgress,
  type Report,
  type ReportFormat,
  type ReportThemeId
} from '@scbrowser/shared'
import { ReplyMarkdown, ReportView, Thinking, type OpenSource } from './ReplyContent'
import { ResizeHandle } from './ResizeHandle'
import { PresentMode } from './PresentMode'

// A saved report stands alone, so it takes the tokens but not the fonts they import.
const REPORT_CSS = `${tokensCss.replace(/^@import .*$/gm, '')}\n${contentCss}`

export type SaveReport = (title: string, format: ReportFormat, content: string) => Promise<boolean>

/** A menu that closes on a click elsewhere or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) close()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', dismiss)
    }
  }, [open, close])
  return root
}

const menuItem = 'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50'
const menuPanel = 'absolute top-full right-0 z-10 mt-1 flex flex-col rounded-md border border-border bg-surface p-1 shadow-2'

function DownloadMenu({ report, save, speakerNotes }: { report: Report; save: SaveReport; speakerNotes: boolean }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const root = useDismiss(open, () => setOpen(false))
  const hasQuiz = quizCardsOf(report).length > 0

  const run = (title: string, format: ReportFormat, content: string, waiting: string | null) => {
    setOpen(false)
    setNote(waiting)
    void save(title, format, content)
      .then((saved) => setNote(saved ? 'Saved' : null))
      .catch(() => setNote("Couldn't save"))
  }
  const download = (format: ReportFormat) =>
    run(report.title, format, format === 'md' ? reportMarkdown(report) : STRUCTURED_FORMATS.includes(format) ? JSON.stringify(report) : reportHtml(report, REPORT_CSS), null)

  return (
    <div ref={root} className="relative flex items-center gap-2">
      {note && <span role="status" className="text-xs whitespace-nowrap text-text-muted">{note}</span>}
      <Button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        Download
        <ChevronDown aria-hidden size={14} strokeWidth={1.75} />
      </Button>
      {open && (
        <div role="menu" aria-label="Download as" className={cx(menuPanel, 'w-56')}>
          {DOCUMENT_FORMATS.map((format) => (
            <button key={format} type="button" role="menuitem" onClick={() => download(format)} className={menuItem}>
              {REPORT_FORMATS[format].label}
            </button>
          ))}
          {(speakerNotes || hasQuiz) && <div className="my-1 border-t border-border" />}
          {speakerNotes && (
            <button type="button" role="menuitem" title="Your AI writes what to say for each slide" onClick={() => run(report.title, 'pptx', JSON.stringify({ ...report, speakerNotes: true }), 'Writing speaker notes…')} className={menuItem}>
              Slides with speaker notes
            </button>
          )}
          {hasQuiz && (
            <button type="button" role="menuitem" title="Questions with room to write, and the answers on the last page" onClick={() => run(`${report.title} worksheet`, 'pdf', quizWorksheetHtml(report, REPORT_CSS), null)} className={menuItem}>
              Quiz worksheet (PDF)
            </button>
          )}
          {hasQuiz && (
            <button type="button" role="menuitem" title="Question and answer rows, to import into Anki, Quizlet or a spreadsheet" onClick={() => run(`${report.title} cards`, 'csv', quizCsv(report), null)} className={menuItem}>
              {REPORT_FORMATS.csv.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Less used actions, kept out of the header's way. */
function MoreMenu({ items }: { items: { label: string; icon: ReactNode; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const root = useDismiss(open, () => setOpen(false))
  if (items.length === 0) return null
  return (
    <div ref={root} className="relative">
      <IconButton label="More report actions" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <EllipsisVertical size={15} strokeWidth={1.75} />
      </IconButton>
      {open && (
        <div role="menu" aria-label="More report actions" className={cx(menuPanel, 'w-52')}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              <span className="text-text-muted">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The report's sections, to jump between in a long one. */
function Outline({ headings, onJump }: { headings: { text: string; level: 2 | 3; index: number }[]; onJump: (index: number) => void }) {
  const [open, setOpen] = useState(false)
  const root = useDismiss(open, () => setOpen(false))
  return (
    <div ref={root} className="relative -ml-2 shrink-0">
      <IconButton label="Sections" side="bottom" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <List size={15} strokeWidth={1.75} />
      </IconButton>
      {open && (
        <div role="menu" aria-label="Sections" className="sc-scroll-quiet absolute top-full left-0 z-10 mt-1 flex max-h-96 w-64 flex-col overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-2">
          {headings.map((heading) => (
            <button
              key={heading.index}
              type="button"
              role="menuitem"
              title={heading.text}
              className={cx('flex min-h-8 w-full shrink-0 items-center rounded-sm px-2 py-1 text-left hover:bg-surface-hover', heading.level === 3 && 'pl-5 text-xs text-text-muted')}
              onClick={() => {
                setOpen(false)
                onJump(heading.index)
              }}
            >
              <span className="line-clamp-2">{heading.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const MIN_WIDTH = 360

type QuizCard = { question: string; answer: string }

export interface QuizMemory {
  load: (keys: string[]) => Promise<QuizProgress>
  record: (key: string, knew: boolean) => Promise<CardProgress>
}

/**
 * One question at a time: think of the answer, show it, then say how it went. Missed ones come
 * back at the end. With a memory, questions due for review come first, and each first answer
 * decides when that question comes back in a later session.
 */
function QuizMode({ cards, memory, progress, onClose }: { cards: QuizCard[]; memory?: QuizMemory; progress: QuizProgress; onClose: () => void }) {
  const [start] = useState(() => orderCards(cards, progress, Date.now()))
  const [queue, setQueue] = useState(start)
  const [shown, setShown] = useState(false)
  const [right, setRight] = useState(0)
  const [missed, setMissed] = useState(0)
  const [next, setNext] = useState<Record<string, CardProgress>>({})
  const card = queue[0]
  const answer = (knew: boolean) => {
    if (knew) setRight(right + 1)
    else setMissed(missed + 1)
    const key = cardKey(card!.question)
    // Only the first try counts towards when it comes back.
    if (memory && !next[key]) void memory.record(key, knew).then((saved) => setNext((current) => ({ ...current, [key]: saved })))
    setQueue(knew ? queue.slice(1) : [...queue.slice(1), card!])
    setShown(false)
  }
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === ' ' && card && !shown) {
        event.preventDefault()
        setShown(true)
      }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [card, shown, onClose])
  const done = cards.length - queue.length
  const now = Date.now()
  const comingBack = Object.values(next).reduce<Record<string, number>>((counts, saved) => {
    const when = dueLabel(saved.due, now)
    counts[when] = (counts[when] ?? 0) + 1
    return counts
  }, {})
  return (
    <div role="dialog" aria-label="Quiz" className="absolute inset-0 z-20 flex flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface pr-2 pl-4">
        <GraduationCap aria-hidden size={15} strokeWidth={1.75} className="text-accent" />
        <div className="flex-1 font-medium">Quiz</div>
        <span className="text-xs text-text-muted tabular-nums">
          {done} of {cards.length}
        </span>
        <IconButton label="Close quiz" onClick={onClose}>
          <X size={15} strokeWidth={1.75} />
        </IconButton>
      </header>
      <div className="h-0.5 shrink-0 bg-border">
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${(done / cards.length) * 100}%` }} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-6">
        {card ? (
          <>
            <div className="flex w-full max-w-140 flex-col gap-4 rounded-lg border border-border bg-surface px-7 py-8 shadow-1">
              <div className="flex items-center gap-2 text-2xs font-medium tracking-wide text-accent uppercase">
                Question
                {progress[cardKey(card.question)] && isDue(progress[cardKey(card.question)], now) && <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 tracking-normal normal-case">Due for review</span>}
              </div>
              <p className="text-md leading-snug font-medium">{card.question}</p>
              {shown && (
                <>
                  <div className="border-t border-dashed border-border" />
                  <div className="text-2xs font-medium tracking-wide text-text-faint uppercase">Answer</div>
                  <p className="text-text-muted">{card.answer}</p>
                </>
              )}
            </div>
            {shown ? (
              <div className="flex gap-2">
                <Button onClick={() => answer(false)}>
                  <RotateCcw aria-hidden size={14} strokeWidth={1.75} />
                  Again
                </Button>
                <Button variant="primary" onClick={() => answer(true)}>
                  <Check aria-hidden size={14} strokeWidth={1.75} />
                  Got it
                </Button>
              </div>
            ) : (
              <Button variant="primary" onClick={() => setShown(true)}>
                Show answer
              </Button>
            )}
            <p className="text-2xs text-text-faint">Space shows the answer. Ones you miss come back at the end{memory ? ', and sooner next time' : ''}.</p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
              <Check aria-hidden size={22} strokeWidth={2} />
            </div>
            <p className="text-md font-medium">All {cards.length} done</p>
            <p className="text-text-muted">
              {missed === 0 ? 'You knew every one first time.' : `${right} right, with ${missed} ${missed === 1 ? 'retry' : 'retries'} along the way.`}
            </p>
            {Object.keys(comingBack).length > 0 && (
              <p className="text-xs text-text-faint">
                Coming back:{' '}
                {Object.entries(comingBack)
                  .map(([when, count]) => `${count} ${when}`)
                  .join(', ')}
                .
              </p>
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setQueue(start)
                  setRight(0)
                  setMissed(0)
                }}
              >
                Start again
              </Button>
              <Button variant="primary" onClick={onClose}>
                Back to the report
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export interface PageHighlight {
  text: string
  title: string
  url: string
}

/** Highlights from pages, to add to a report as quotes that say where they came from. */
function HighlightPicker({ load, onPick, onClose }: { load: () => Promise<PageHighlight[]>; onPick: (highlight: PageHighlight) => void; onClose: () => void }) {
  const [items, setItems] = useState<PageHighlight[] | null>(null)
  const [filter, setFilter] = useState('')
  const root = useDismiss(true, onClose)
  useEffect(() => {
    void load().then(setItems)
  }, [load])
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = (items ?? []).filter((item) => words.every((word) => `${item.text} ${item.title}`.toLowerCase().includes(word))).slice(0, 40)
  return (
    <div ref={root} role="dialog" aria-label="Add a highlight" className="absolute top-full right-0 z-10 mt-1 flex max-h-96 w-80 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-2">
      <input
        autoFocus
        aria-label="Find a highlight"
        placeholder="Find a highlight"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="h-9 shrink-0 border-b border-border bg-transparent px-3 text-sm text-text outline-none placeholder:text-text-faint"
      />
      <div className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto p-1">
        {items === null && <p className="p-2 text-xs text-text-faint">Loading…</p>}
        {items?.length === 0 && <p className="p-2 text-xs text-text-faint">No highlights yet. Select words on a page, right-click and pick Highlight.</p>}
        {shown.map((item, index) => (
          <button key={index} type="button" onClick={() => onPick(item)} className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover">
            <span className="line-clamp-2 text-xs">“{item.text}”</span>
            <span className="truncate text-2xs text-text-faint">{item.title || item.url}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Asks for a new draft, or asks a question answered here without changing the report. */
function ChangeBox({ busy, onRevise, onAsk }: { busy: boolean; onRevise?: (change: string) => void; onAsk?: (question: string) => Promise<string> }) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'change' | 'ask'>(onRevise ? 'change' : 'ask')
  const [answer, setAnswer] = useState<{ question: string; text: string | null; error: string | null } | null>(null)
  const asking = answer !== null && answer.text === null && answer.error === null
  const submit = () => {
    const value = text.trim()
    if (!value || busy || asking) return
    setText('')
    if (mode === 'change' && onRevise) return onRevise(value)
    if (!onAsk) return
    setAnswer({ question: value, text: null, error: null })
    void onAsk(value)
      .then((reply) => setAnswer({ question: value, text: reply, error: null }))
      .catch((error: Error) => setAnswer({ question: value, text: null, error: error.message.replace(/^.*Error: /, '') }))
  }
  return (
    <div className="flex shrink-0 flex-col border-t border-border bg-surface">
      {answer && (
        <div role="region" aria-label="Answer" className="sc-scroll-quiet flex max-h-64 flex-col gap-1.5 overflow-y-auto border-b border-border px-4 py-3">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-xs font-medium text-text-muted">{answer.question}</p>
            <IconButton size="sm" label="Close answer" onClick={() => setAnswer(null)}>
              <X size={12} strokeWidth={2} />
            </IconButton>
          </div>
          {answer.text !== null ? (
            <div className="text-sm">
              <ReplyMarkdown text={answer.text} onOpenLink={() => undefined} />
            </div>
          ) : answer.error ? (
            <p role="alert" className="text-xs text-danger">{answer.error}</p>
          ) : (
            <Thinking />
          )}
        </div>
      )}
      <form
        aria-label={mode === 'change' ? 'Ask for a change' : 'Ask about this report'}
        className="flex items-center gap-1 p-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {onRevise && onAsk && (
          <div role="tablist" aria-label="What to do" className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-bg p-0.5">
            {(
              [
                ['change', 'Change', Pencil],
                ['ask', 'Ask', MessageCircleQuestion]
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={cx('flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors', mode === id ? 'bg-surface text-text shadow-1' : 'text-text-muted hover:text-text')}
              >
                <Icon aria-hidden size={11} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>
        )}
        <input
          aria-label={mode === 'change' ? 'Change to make' : 'Question about the report'}
          placeholder={mode === 'change' ? 'Ask for a change, like “make it shorter”' : 'Ask about it, like “what does headway mean?”'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 min-w-0 flex-1 bg-transparent px-2 text-sm text-text outline-none select-text placeholder:text-text-faint"
        />
        <IconButton size="sm" label={mode === 'change' ? 'Ask for this change' : 'Ask this question'} type="submit" disabled={busy || asking || !text.trim()} className={text.trim() && !busy && !asking ? 'bg-text! text-surface! hover:opacity-85' : ''}>
          <ArrowUp size={14} strokeWidth={2} />
        </IconButton>
      </form>
    </div>
  )
}

/** Saves the report's layout as a new kind of report, under a name the person picks. */
function TemplateNamer({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial)
  const root = useDismiss(true, onClose)
  return (
    <div ref={root} className="absolute top-full right-0 z-10 mt-1 w-72 rounded-md border border-border bg-surface p-3 shadow-2">
      <form
        aria-label="Save as a template"
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onSave(name.trim())
        }}
      >
        <label className="text-xs font-medium" htmlFor="template-name">
          Template name
        </label>
        <input
          id="template-name"
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value.replace(/["\n]/g, ''))}
          className="h-8 rounded-md border border-border bg-field px-2 text-sm outline-none focus:border-border-strong"
        />
        <p className="text-2xs text-text-faint">Keeps the sections and kinds of block, not the words, so it works for any topic. It shows in Make a report.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            Save template
          </Button>
        </div>
      </form>
    </div>
  )
}

interface ReportPaneProps {
  report: Report
  /** Every draft of this report, oldest first. */
  versions: Report[]
  onSelect: (report: Report) => void
  /** Left out when AI isn't available. */
  onRevise?: (change: string) => void
  /** A question about the report, answered beside it. Left out when AI isn't available. */
  onAsk?: (question: string) => Promise<string>
  /** A reply is on its way. */
  busy: boolean
  save: SaveReport
  onClose: () => void
  /** When set, offers to continue on the full-page assistant. */
  onExpand?: () => void
  width: number
  onWidth: (width: number) => void
  onWidthCommit: (width: number) => void
  onDragging?: (dragging: boolean) => void
  /** The pages the reply that wrote it drew on, listed at the end and in downloads. */
  sources?: CitationSource[]
  onOpenSource?: OpenSource
  /** Offers editing in place; each change arrives as the whole edited report. */
  onEdit?: (next: Report) => void
  /** The design saved for this report, and where to save a new pick. */
  design?: ReportThemeId | null
  onDesign?: (theme: ReportThemeId) => void
  /** Remembers quiz answers across sessions. */
  quizMemory?: QuizMemory
  /** Highlights to add while editing. */
  loadHighlights?: () => Promise<PageHighlight[]>
  /** Saves the layout as a template, resolving to a note to show. */
  onSaveTemplate?: (name: string) => Promise<string>
  /** Speaker notes need AI. */
  speakerNotes?: boolean
  /** Writes what to say for each slide while presenting. Left out when AI isn't available. */
  loadNotes?: (report: Report) => Promise<string[]>
}

/** A report beside the conversation, with room to read it, ways to change it and ways to take it elsewhere. */
export function ReportPane(props: ReportPaneProps) {
  const { report, versions, onSelect, onRevise, onAsk, busy, save, onClose, onExpand, width, onWidth, onWidthCommit, onDragging, sources, onOpenSource, onEdit, design: savedDesign, onDesign, quizMemory, loadHighlights, onSaveTemplate, speakerNotes = false, loadNotes } = props
  // A design is a way of looking at the report, so it carries across drafts.
  const [picked, setPicked] = useState<ReportThemeId | null>(null)
  const design = picked ?? savedDesign ?? null
  const [editing, setEditing] = useState(false)
  const [quiz, setQuiz] = useState(false)
  const [picking, setPicking] = useState(false)
  const [naming, setNaming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [comparing, setComparing] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState<QuizProgress>({})
  const cards = quizCardsOf(report)
  const cardKeys = cards.map((card) => cardKey(card.question)).join(',')
  const shown = { ...report, theme: design ?? report.theme }
  const withSources = sources?.length ? { ...shown, sources: sources.map(({ n, title, url }) => ({ n, title, url })) } : shown
  const index = versions.findIndex((version) => JSON.stringify(version) === JSON.stringify(report))
  const headings = report.blocks.flatMap((block, at) => (block.type === 'heading' ? [{ text: block.text, level: block.level, index: at }] : []))
  const jump = (blockIndex: number) => {
    // Headings are the article's only h2 and h3 besides Sources, in the order of their blocks.
    const nth = headings.findIndex((heading) => heading.index === blockIndex)
    body.current?.querySelectorAll('article > h2, article > h3, article > .change > h2, article > .change > h3')[nth]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const earlier = index > 0 ? versions[index - 1]! : null
  const diff = useMemo(() => (comparing && earlier ? diffReports(earlier, report) : null), [comparing, earlier, report])
  const counts = diff ? changeCounts(diff.changes) : null
  // A draft arriving while editing ends the editing, as the text being typed into has gone.
  useEffect(() => setEditing(false), [busy])
  useEffect(() => {
    if (!earlier) setComparing(false)
  }, [earlier])
  // Another report keeps its own design.
  useEffect(() => setPicked(null), [report.title])
  useEffect(() => {
    if (!quizMemory || !cardKeys) return
    void quizMemory.load(cardKeys.split(',')).then(setProgress)
  }, [quizMemory, cardKeys, quiz])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(timer)
  }, [notice])
  const now = Date.now()
  const due = quizMemory ? cards.filter((card) => progress[cardKey(card.question)] && isDue(progress[cardKey(card.question)], now)).length : 0
  const more = [
    {
      label: copied ? 'Copied' : 'Copy as Markdown',
      icon: <Copy size={14} strokeWidth={1.75} />,
      onClick: () =>
        void navigator.clipboard.writeText(reportMarkdown(withSources)).then(() => {
          setCopied(true)
          setNotice('Copied as Markdown')
          setTimeout(() => setCopied(false), 1500)
        })
    },
    { label: 'Present as slides', icon: <Presentation size={14} strokeWidth={1.75} />, onClick: () => setPresenting(true) },
    ...(onSaveTemplate ? [{ label: 'Save as a template', icon: <BookmarkPlus size={14} strokeWidth={1.75} />, onClick: () => setNaming(true) }] : []),
    ...(onExpand ? [{ label: 'Open in a full page', icon: <Maximize2 size={14} strokeWidth={1.75} />, onClick: onExpand }] : [])
  ]
  return (
    <section aria-label="Report" className="relative flex min-w-0 shrink flex-col border-l border-border bg-bg" style={{ width, flexBasis: width }}>
      <ResizeHandle label="Report width" edge="left" width={width} min={MIN_WIDTH} max={Math.max(MIN_WIDTH, innerWidth - 320)} onWidth={onWidth} onCommit={onWidthCommit} onDragging={onDragging} />
      <header className="relative flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-surface pr-2 pl-4">
        {headings.length > 1 && !comparing ? <Outline headings={headings} onJump={jump} /> : <FileText aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" />}
        <div className="mr-2 min-w-0 flex-1 truncate font-medium" title={report.title}>
          {report.title}
        </div>
        {notice && (
          <span role="status" className="pointer-events-none absolute top-full right-3 z-10 mt-2 rounded-md bg-text px-2.5 py-1.5 text-xs whitespace-nowrap text-surface shadow-2">
            {notice}
          </span>
        )}
        {cards.length > 0 && (
          <Button className="shrink-0 px-2.5 text-xs whitespace-nowrap" onClick={() => setQuiz(true)}>
            <GraduationCap aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
            Quiz me
            {due > 0 && <span className="rounded-sm bg-accent-soft px-1 text-2xs text-accent tabular-nums">{due} due</span>}
          </Button>
        )}
        {onEdit && (
          <IconButton label={editing ? 'Done editing' : 'Edit text'} aria-pressed={editing} disabled={busy || comparing} onClick={() => setEditing(!editing)} className={editing ? 'bg-accent-soft! text-accent!' : ''}>
            {editing ? <Check size={15} strokeWidth={1.75} /> : <Pencil size={15} strokeWidth={1.75} />}
          </IconButton>
        )}
        <Select
          aria-label="Design"
          className="h-8 w-auto text-xs"
          value={shown.theme}
          onChange={(e) => {
            setPicked(e.target.value as ReportThemeId)
            onDesign?.(e.target.value as ReportThemeId)
          }}
        >
          {REPORT_THEMES.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <DownloadMenu report={withSources} save={save} speakerNotes={speakerNotes} />
        <MoreMenu items={more} />
        <IconButton label="Close report" onClick={onClose}>
          <X size={15} strokeWidth={1.75} />
        </IconButton>
        {naming && onSaveTemplate && (
          <TemplateNamer
            initial={report.kind ?? report.title.slice(0, 60)}
            onClose={() => setNaming(false)}
            onSave={(name) => {
              setNaming(false)
              void onSaveTemplate(name).then(setNotice, () => setNotice("Couldn't save the template"))
            }}
          />
        )}
      </header>
      {versions.length > 1 && index !== -1 && (
        <nav aria-label="Versions" className="flex h-8 shrink-0 items-center justify-center gap-1 border-b border-border bg-surface text-xs text-text-muted tabular-nums">
          <IconButton size="sm" label="Earlier version" disabled={index === 0} onClick={() => onSelect(versions[index - 1]!)}>
            <ChevronLeft size={13} strokeWidth={1.75} />
          </IconButton>
          <span role="status">
            Version {index + 1} of {versions.length}
          </span>
          <IconButton size="sm" label="Later version" disabled={index === versions.length - 1} onClick={() => onSelect(versions[index + 1]!)}>
            <ChevronRight size={13} strokeWidth={1.75} />
          </IconButton>
          {earlier && (
            <button
              type="button"
              aria-pressed={comparing}
              title={`Marks what changed since version ${index}`}
              onClick={() => {
                setComparing(!comparing)
                setEditing(false)
              }}
              className={cx('ml-1 flex h-6 items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-surface-hover', comparing ? 'bg-accent-soft text-accent' : 'hover:text-text')}
            >
              <GitCompareArrows aria-hidden size={12} strokeWidth={1.75} />
              {counts ? (counts.added + counts.removed === 0 ? 'No changes' : `${counts.added} added, ${counts.removed} removed`) : 'What changed'}
            </button>
          )}
        </nav>
      )}
      {editing && (
        <div role="status" className="relative flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-accent-soft pr-2 pl-4 text-xs text-accent">
          <Pencil aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">Click any text to change it. Empty a line to remove it. Esc undoes the one you're in.</span>
          {loadHighlights && onEdit && (
            <div className="relative shrink-0">
              <Button className="h-7 bg-surface! px-2 text-xs" aria-expanded={picking} onClick={() => setPicking(!picking)}>
                <Highlighter aria-hidden size={12} strokeWidth={1.75} />
                Add a highlight
              </Button>
              {picking && (
                <HighlightPicker
                  load={loadHighlights}
                  onClose={() => setPicking(false)}
                  onPick={(highlight) => {
                    setPicking(false)
                    const from = highlight.title || (URL.canParse(highlight.url) ? new URL(highlight.url).host : highlight.url)
                    onEdit({ ...report, blocks: [...report.blocks, { type: 'quote', text: `“${highlight.text.trim()}” (${from})` }] })
                    setNotice('Highlight added at the end')
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
      <div ref={body} className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto p-4">
        {busy && (
          <div className="mx-auto mb-3 max-w-180">
            <Thinking label="Working on it" />
          </div>
        )}
        <div className="mx-auto max-w-180 rounded-lg bg-surface px-8 py-9 shadow-1">
          {diff ? (
            <ReportView report={{ ...shown, blocks: diff.blocks }} changes={diff.changes} sources={sources} onOpenSource={onOpenSource} />
          ) : (
            <ReportView report={shown} sources={sources} onOpenSource={onOpenSource} onEdit={editing ? onEdit : undefined} />
          )}
        </div>
      </div>
      {(onRevise || onAsk) && <ChangeBox busy={busy} onRevise={onRevise} onAsk={onAsk} />}
      {presenting && <PresentMode report={withSources} loadNotes={loadNotes ? () => loadNotes(withSources) : undefined} onClose={() => setPresenting(false)} />}
      {quiz && cards.length > 0 && <QuizMode cards={cards} memory={quizMemory} progress={progress} onClose={() => setQuiz(false)} />}
    </section>
  )
}
