import { memo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronRight, Copy, FileCode2, FileText, TriangleAlert } from 'lucide-react'
import { cx, IconButton } from '@scbrowser/ui'
import { conversationReports, isHttpUrl, languageOf, splitFiles, splitReply, type FileChange, type Report, type ReportBlock } from '@scbrowser/shared'

export function ReplyMarkdown({ text, onOpenLink }: { text: string; onOpenLink: (href: string) => void }) {
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
            href && isHttpUrl(href) ? (
              <button type="button" title={href} className="sc-link" onClick={() => onOpenLink(href)}>
                {children}
              </button>
            ) : (
              <span>{children}</span>
            )
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

function Block({ block }: { block: ReportBlock }) {
  switch (block.type) {
    case 'heading':
      return block.level === 3 ? <h3>{block.text}</h3> : <h2>{block.text}</h2>
    case 'paragraph':
      return <p>{block.text}</p>
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}>{item}</li>)
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
    }
    case 'quote':
      return <blockquote>{block.text}</blockquote>
    case 'callout':
      return <div className="callout">{block.text}</div>
    case 'table':
      return (
        <div className="table">
          <table>
            <thead>
              <tr>
                {block.headers.map((header, index) => (
                  <th key={index}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index}>{cell}</td>
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
              <div className="stat-value">{item.value}</div>
              <div className="stat-label">{item.label}</div>
            </div>
          ))}
        </div>
      )
    case 'timeline':
      return (
        <ol className="timeline">
          {block.items.map((item, index) => (
            <li key={index}>
              <div className="when">{item.when}</div>
              <div>{item.text}</div>
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
                  <li key={index}>{item}</li>
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
              <div className="card-title">{item.title}</div>
              <div>{item.text}</div>
            </div>
          ))}
        </div>
      )
    case 'steps':
      return (
        <ol className="steps">
          {block.items.map((item, index) => (
            <li key={index}>
              <div className="step-title">{item.title}</div>
              <div>{item.text}</div>
            </li>
          ))}
        </ol>
      )
  }
}

/** All text is set as React text, and the only styling is the theme chosen from our own set. */
export function ReportView({ report }: { report: Report }) {
  return (
    <article className="sc-report" data-theme={report.theme}>
      {report.kind && <p className="kind">{report.kind}</p>}
      <h1>{report.title}</h1>
      {report.summary && <p className="summary">{report.summary}</p>}
      {report.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </article>
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

const ReplyText = memo(function ReplyText({ text, onOpenLink, onOpenReport, openReport, streaming = false }: ReplyContentProps) {
  const { before, after, report, writing } = splitReply(text, !streaming)
  return (
    <div className="flex flex-col gap-3">
      {before && <ReplyMarkdown text={before} onOpenLink={onOpenLink} />}
      {writing && (
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Thinking label="Writing a report" />
        </div>
      )}
      {report && (onOpenReport ? <ReportCard report={report} active={!!openReport && JSON.stringify(openReport) === JSON.stringify(report)} onOpen={() => onOpenReport(report)} /> : <ReportView report={report} />)}
      {after && <ReplyText text={after} onOpenLink={onOpenLink} onOpenReport={onOpenReport} openReport={openReport} streaming={streaming} />}
    </div>
  )
})

/** The newest report in a conversation, if it has one. */
export const latestReport = (turns: { role: string; content: string }[]): Report | null => conversationReports(turns).at(-1) ?? null
