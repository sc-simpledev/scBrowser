import { createContext, memo, useContext, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronRight, Copy, FileCode2, FileText, TriangleAlert } from 'lucide-react'
import { cx, IconButton } from '@scbrowser/ui'
import { conversationReports, formatTimestamp, isHttpUrl, languageOf, linkCitations, parseCitationHref, splitFiles, splitReply, type CitationSource, type CitationTarget, type FileChange, type Report, type ReportBlock } from '@scbrowser/shared'

/** Follows a citation to its page, or a time to its moment in the video. */
export type OpenSource = (source: CitationSource, target: CitationTarget) => void

interface Citations {
  sources?: CitationSource[]
  onOpenSource?: OpenSource
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : url)

/** A small numbered chip after a claim, or a time in a video, that goes to where it came from. */
function CitationChip({ href, label, sources, onOpenSource }: { href: string; label: string } & Required<Citations>) {
  const parsed = parseCitationHref(href)
  if (!parsed) return <span>{label}</span>
  const source = parsed.target.seconds !== null ? sources.find((candidate) => candidate.kind === 'transcript') : sources.find((candidate) => candidate.n === parsed.n)
  if (!source) return <span>{label}</span>
  const isTime = parsed.target.seconds !== null
  const title = isTime
    ? `Play from ${formatTimestamp(parsed.target.seconds!)} in ${source.title || hostOf(source.url)}`
    : `${source.title || hostOf(source.url)}${parsed.target.quote ? `: “${parsed.target.quote}”` : ''}`
  return (
    <button type="button" title={title} aria-label={title} className={isTime ? 'sc-cite sc-cite-time' : 'sc-cite'} onClick={() => onOpenSource(source, parsed.target)}>
      {label}
    </button>
  )
}

export function ReplyMarkdown({ text, onOpenLink, sources = [], onOpenSource }: { text: string; onOpenLink: (href: string) => void } & Citations) {
  const linked = onOpenSource ? linkCitations(text, { sources: sources.length, timestamps: sources.some((source) => source.kind === 'transcript') }) : text
  return (
    <div className="sc-prose">
      {/*
        Replies can repeat text from web pages, so they're treated as untrusted. Raw HTML is
        never rendered, and images are dropped because loading one could leak data to its URL.
      */}
      <Markdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['img']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) =>
            href?.startsWith('#sc-') && onOpenSource ? (
              <CitationChip href={href} label={String(children)} sources={sources} onOpenSource={onOpenSource} />
            ) : href && isHttpUrl(href) ? (
              <button type="button" title={href} className="sc-link" onClick={() => onOpenLink(href)}>
                {children}
              </button>
            ) : (
              <span>{children}</span>
            )
        }}
      >
        {linked}
      </Markdown>
    </div>
  )
}

type Path = (string | number)[]

/** Set while a report is being edited: every piece of text can then be typed into. */
const EditContext = createContext<((path: Path, text: string) => void) | null>(null)

/** A video's transcript, when the report came from one, so its times can be jumped to. */
const TimeContext = createContext<{ source: CitationSource; open: OpenSource } | null>(null)

const TIME = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g

/** Text with `[1:23]` times turned into buttons that play the video from there. */
function Timed({ text }: { text: string }) {
  const video = useContext(TimeContext)
  if (!video || !TIME.test(text)) return <>{text}</>
  TIME.lastIndex = 0
  const parts: (string | { label: string; seconds: number })[] = []
  let last = 0
  for (const match of text.matchAll(TIME)) {
    parts.push(text.slice(last, match.index))
    const seconds = match[1]!.split(':').reduce((total, part) => total * 60 + Number(part), 0)
    parts.push({ label: match[1]!, seconds })
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return (
    <>
      {parts.map((part, index) =>
        typeof part === 'string' ? (
          part
        ) : (
          <button key={index} type="button" className="sc-cite sc-cite-time" title={`Play from ${part.label}`} onClick={() => video.open(video.source, { quote: null, seconds: part.seconds })}>
            {part.label}
          </button>
        )
      )}
    </>
  )
}

/** One piece of a report's text, typed into in place while editing. */
function T({ as: Tag = 'span', path, text, className }: { as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'li' | 'th' | 'td' | 'blockquote'; path: Path; text: string; className?: string }) {
  const edit = useContext(EditContext)
  if (!edit)
    return (
      <Tag className={className}>
        <Timed text={text} />
      </Tag>
    )
  return (
    <Tag
      className={className}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      onBlur={(event) => {
        const next = (event.currentTarget.textContent ?? '').trim()
        if (next !== text) edit(path, next)
      }}
      onKeyDown={(event) => {
        // Short pieces of text are one line; Escape puts back what was there.
        if (event.key === 'Escape') {
          event.currentTarget.textContent = text
          event.currentTarget.blur()
        }
        if (event.key === 'Enter' && !event.shiftKey && Tag !== 'p' && Tag !== 'div' && Tag !== 'blockquote') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    >
      {text}
    </Tag>
  )
}

/** A practice question whose answer shows when it's pressed. */
function QuizItem({ path, question, answer }: { path: Path; question: string; answer: string }) {
  const editing = !!useContext(EditContext)
  const [open, setOpen] = useState(false)
  const shown = open || editing
  return (
    <li>
      {editing ? (
        <div className="question">
          <T path={[...path, 'question']} text={question} />
        </div>
      ) : (
        <button type="button" className="question" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{question}</span>
          <span className="reveal">{open ? 'Hide answer' : 'Show answer'}</span>
        </button>
      )}
      {shown && <T as="div" className="answer" path={[...path, 'answer']} text={answer} />}
    </li>
  )
}

function Block({ block, path }: { block: ReportBlock; path: Path }) {
  switch (block.type) {
    case 'heading':
      return <T as={block.level === 3 ? 'h3' : 'h2'} path={[...path, 'text']} text={block.text} />
    case 'paragraph':
      return <T as="p" path={[...path, 'text']} text={block.text} />
    case 'list': {
      const items = block.items.map((item, index) => <T key={index} as="li" path={[...path, 'items', index]} text={item} />)
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
    }
    case 'quote':
      return <T as="blockquote" path={[...path, 'text']} text={block.text} />
    case 'callout':
      return <T as="div" className="callout" path={[...path, 'text']} text={block.text} />
    case 'table':
      return (
        <div className="table">
          <table>
            <thead>
              <tr>
                {block.headers.map((header, index) => (
                  <T key={index} as="th" path={[...path, 'headers', index]} text={header} />
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <T key={index} as="td" path={[...path, 'rows', rowIndex, index]} text={cell} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'spacer':
      return <div className="spacer" />
    case 'divider':
      return <hr />
    case 'stats':
      return (
        <div className="stats">
          {block.items.map((item, index) => (
            <div key={index} className="stat">
              <T as="div" className="stat-value" path={[...path, 'items', index, 'value']} text={item.value} />
              <T as="div" className="stat-label" path={[...path, 'items', index, 'label']} text={item.label} />
            </div>
          ))}
        </div>
      )
    case 'timeline':
      return (
        <ol className="timeline">
          {block.items.map((item, index) => (
            <li key={index}>
              <T as="div" className="when" path={[...path, 'items', index, 'when']} text={item.when} />
              <T as="div" path={[...path, 'items', index, 'text']} text={item.text} />
            </li>
          ))}
        </ol>
      )
    case 'proscons':
      return (
        <div className="proscons">
          {(['pros', 'cons'] as const).map((side) => (
            <div key={side} className={side}>
              <div className="side">{side === 'pros' ? 'Pros' : 'Cons'}</div>
              <ul>
                {block[side].map((item, index) => (
                  <T key={index} as="li" path={[...path, side, index]} text={item} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )
    case 'cards':
      return (
        <div className="cards">
          {block.items.map((item, index) => (
            <div key={index} className="card">
              <T as="div" className="card-title" path={[...path, 'items', index, 'title']} text={item.title} />
              <T as="div" path={[...path, 'items', index, 'text']} text={item.text} />
            </div>
          ))}
        </div>
      )
    case 'steps':
      return (
        <ol className="steps">
          {block.items.map((item, index) => (
            <li key={index}>
              <T as="div" className="step-title" path={[...path, 'items', index, 'title']} text={item.title} />
              <T as="div" path={[...path, 'items', index, 'text']} text={item.text} />
            </li>
          ))}
        </ol>
      )
    case 'quiz':
      return (
        <ol className="quiz">
          {block.items.map((item, index) => (
            <QuizItem key={index} path={[...path, 'items', index]} question={item.question} answer={item.answer} />
          ))}
        </ol>
      )
  }
}

/** A copy of the report with the text at `path` replaced. Removing all of a block's text removes the block. */
export function editReport(report: Report, path: Path, text: string): Report {
  const next = structuredClone(report) as unknown as Record<string | number, unknown>
  let target = next
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>
  target[path.at(-1)!] = text
  const edited = next as unknown as Report
  if (!text && path[0] === 'blocks' && path.length === 3) edited.blocks = edited.blocks.filter((_, index) => index !== path[1])
  if (!text && path[0] === 'blocks' && path.length >= 4 && Array.isArray(target) && typeof path.at(-1) === 'number' && (path[2] === 'items' || path[2] === 'pros' || path[2] === 'cons'))
    (target as unknown[]).splice(path.at(-1) as number, 1)
  return edited
}

interface ReportViewProps {
  report: Report
  /** Pages the report drew on, listed at its end. */
  sources?: CitationSource[]
  onOpenSource?: OpenSource
  /** Makes every piece of text editable, reporting each change as a whole new report. */
  onEdit?: (next: Report) => void
}

/** All text is set as React text, and the only styling is the theme chosen from our own set. */
export function ReportView({ report, sources, onOpenSource, onEdit }: ReportViewProps) {
  const edit = useMemo(() => (onEdit ? (path: Path, text: string) => onEdit(editReport(report, path, text)) : null), [onEdit, report])
  const transcript = sources?.find((source) => source.kind === 'transcript')
  const video = useMemo(() => (transcript && onOpenSource ? { source: transcript, open: onOpenSource } : null), [transcript, onOpenSource])
  return (
    <TimeContext.Provider value={video}>
    <EditContext.Provider value={edit}>
      <article className="sc-report" data-theme={report.theme} data-editing={onEdit ? '' : undefined}>
        {report.kind && <T as="p" className="kind" path={['kind']} text={report.kind} />}
        <T as="h1" path={['title']} text={report.title} />
        {(report.summary || onEdit) && <T as="p" className="summary" path={['summary']} text={report.summary} />}
        {report.blocks.map((block, index) => (
          <Block key={`${index}-${block.type}`} block={block} path={['blocks', index]} />
        ))}
        {sources && sources.length > 0 && (
          <section className="sources" aria-label="Sources">
            <h2>Sources</h2>
            <ol>
              {sources.map((source) => (
                <li key={source.n} value={source.n}>
                  {onOpenSource ? (
                    <button type="button" title={source.url} onClick={() => onOpenSource(source, { quote: null, seconds: null })}>
                      {source.title || hostOf(source.url)} <span className="source-url">{hostOf(source.url)}</span>
                    </button>
                  ) : (
                    <span>
                      {source.title || hostOf(source.url)} <span className="source-url">{source.url}</span>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>
    </EditContext.Provider>
    </TimeContext.Provider>
  )
}

/** Three dots that pulse while a reply is on its way. */
export function Thinking({ label = 'Thinking' }: { label?: string }) {
  return (
    <span role="status" className="flex h-5 items-center gap-2 text-text-faint">
      <span aria-hidden className="sc-thinking">
        <i />
        <i />
        <i />
      </span>
      {label}…
    </span>
  )
}

export function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <IconButton
      size="sm"
      label={copied ? 'Copied' : 'Copy reply'}
      side="bottom"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.75} />}
    </IconButton>
  )
}

function ReportCard({ report, active, onOpen }: { report: Report; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Open report"
      aria-pressed={active}
      onClick={onOpen}
      className={cx(
        'group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring',
        active ? 'border-border-strong bg-surface-hover' : 'border-border bg-surface hover:bg-surface-hover'
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
        <FileText aria-hidden size={16} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{report.title}</span>
        <span className="block truncate text-xs text-text-muted">{report.kind ? `${report.kind} · ${report.summary || 'Report'}` : report.summary || 'Report'}</span>
      </span>
      <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

const HOW_WORDS = { created: 'Created', rewritten: 'Rewritten', edited: 'Edited', failed: 'Couldn’t edit' } as const

const lineCount = (text: string) => (text ? text.split('\n').length : 0)

/** Opens a file the assistant wrote, at the version this reply made. */
function FileCard({ change, active, writing, lines, onOpen }: { change: FileChange; active: boolean; writing: boolean; lines: number; onOpen?: () => void }) {
  const failed = change.how === 'failed'
  const detail = writing ? `Writing… ${lines} ${lines === 1 ? 'line' : 'lines'}` : failed ? change.error : `${HOW_WORDS[change.how]} · ${languageOf(change.name)} · ${lines} ${lines === 1 ? 'line' : 'lines'}`
  return (
    <button
      type="button"
      aria-label={`Open ${change.name}`}
      aria-pressed={active}
      disabled={!onOpen || writing || failed}
      onClick={onOpen}
      className={cx(
        'group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-default',
        active ? 'border-border-strong bg-surface-hover' : 'border-border bg-surface enabled:hover:bg-surface-hover'
      )}
    >
      <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-md', failed ? 'bg-surface-hover text-danger' : 'bg-accent-soft text-accent')}>
        {failed ? <TriangleAlert aria-hidden size={16} strokeWidth={1.75} /> : <FileCode2 aria-hidden size={16} strokeWidth={1.75} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium font-mono text-xs">{change.name}</span>
        <span className={cx('block truncate text-xs', failed ? 'text-danger' : 'text-text-muted')}>{writing ? <Thinking label={detail ?? ''} /> : detail}</span>
      </span>
      {!writing && !failed && onOpen && <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />}
    </button>
  )
}

interface ReplyContentProps {
  text: string
  onOpenLink: (href: string) => void
  /** When set, shows a card that opens the report rather than the report itself. */
  onOpenReport?: (report: Report) => void
  /** The report open beside the conversation, so its card can show that. */
  openReport?: Report | null
  /** The reply is still arriving, so an unfinished report is shown as in progress. */
  streaming?: boolean
  /** What this reply's file blocks did, in order, once it has been worked out for the whole conversation. */
  fileChanges?: FileChange[]
  onOpenFile?: (change: FileChange) => void
  /** The file version open beside the conversation. */
  openFile?: { name: string; turn: number } | null
  /** The pages this reply was given, so its citations can link back to them. */
  sources?: CitationSource[]
  onOpenSource?: OpenSource
}

/** A reply's text, reports and files, in the order they were written. */
export const ReplyContent = memo(function ReplyContent({ text, fileChanges = [], onOpenFile, openFile, ...rest }: ReplyContentProps) {
  const segments = splitFiles(text, !rest.streaming)
  let fileIndex = 0
  return (
    <div className="flex flex-col gap-3">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <ReplyText key={index} text={segment.text} {...rest} />
        const change = segment.done ? fileChanges[fileIndex++] : undefined
        const shown = change ?? { name: segment.name, how: segment.kind === 'file' ? 'created' : 'edited' }
        const lines = segment.kind === 'file' ? lineCount(segment.content) : segment.edits.length
        const version = change?.version
        return (
          <FileCard
            key={index}
            change={shown as FileChange}
            writing={!segment.done}
            lines={version ? lineCount(version.content) : lines}
            active={!!version && !!openFile && openFile.name === version.name && openFile.turn === version.turn}
            onOpen={change && onOpenFile ? () => onOpenFile(change) : undefined}
          />
        )
      })}
    </div>
  )
})

const ReplyText = memo(function ReplyText({ text, onOpenLink, onOpenReport, openReport, streaming = false, sources, onOpenSource }: ReplyContentProps) {
  const { before, after, report, writing, unread } = splitReply(text, !streaming)
  return (
    <div className="flex flex-col gap-3">
      {before && <ReplyMarkdown text={before} onOpenLink={onOpenLink} sources={sources} onOpenSource={onOpenSource} />}
      {writing && (
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Thinking label="Writing a report" />
        </div>
      )}
      {unread && (
        <details className="rounded-lg border border-border text-text-muted">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-hover text-danger">
              <TriangleAlert aria-hidden size={16} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-text">This report couldn’t be read</span>
              <span className="block text-xs">It came back in a form the browser doesn’t understand. Ask for it again, or select this to see what was written.</span>
            </span>
          </summary>
          <pre className="sc-scroll-quiet max-h-60 overflow-auto border-t border-border p-3 font-mono text-2xs whitespace-pre-wrap [overflow-wrap:anywhere]">{unread}</pre>
        </details>
      )}
      {report && (onOpenReport ? <ReportCard report={report} active={!!openReport && JSON.stringify(openReport) === JSON.stringify(report)} onOpen={() => onOpenReport(report)} /> : <ReportView report={report} />)}
      {after && <ReplyText text={after} onOpenLink={onOpenLink} onOpenReport={onOpenReport} openReport={openReport} streaming={streaming} sources={sources} onOpenSource={onOpenSource} />}
      {sources && sources.length > 0 && onOpenSource && !streaming && !after && <SourceList sources={sources} onOpenSource={onOpenSource} />}
    </div>
  )
})

/** The pages a reply drew on, numbered as its citations are. */
function SourceList({ sources, onOpenSource }: Required<Citations>) {
  return (
    <ol aria-label="Sources" className="flex flex-wrap gap-1.5">
      {sources.map((source) => (
        <li key={source.n}>
          <button
            type="button"
            title={source.url}
            onClick={() => onOpenSource(source, { quote: null, seconds: null })}
            className="flex h-6 max-w-64 items-center gap-1.5 rounded-sm border border-border px-1.5 text-2xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <span className="font-medium text-text tabular-nums">{source.n}</span>
            <span className="truncate">{source.title || hostOf(source.url)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/** The newest report in a conversation, if it has one. */
export const latestReport = (turns: { role: string; content: string }[]): Report | null => conversationReports(turns).at(-1) ?? null
