import { memo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronRight, Copy, FileText } from 'lucide-react'
import { cx, IconButton } from '@scbrowser/ui'
import { conversationReports, isHttpUrl, splitReply, type Report, type ReportBlock } from '@scbrowser/shared'

function ReplyMarkdown({ text, onOpenLink }: { text: string; onOpenLink: (href: string) => void }) {
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
  }
}

/** All text is set as React text, and the only styling is the theme chosen from our own set. */
export function ReportView({ report }: { report: Report }) {
  return (
    <article className="sc-report" data-theme={report.theme}>
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
        <span className="block truncate text-xs text-text-muted">{report.summary || 'Report'}</span>
      </span>
      <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
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
}

export const ReplyContent = memo(function ReplyContent({ text, onOpenLink, onOpenReport, openReport, streaming = false }: ReplyContentProps) {
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
      {after && <ReplyContent text={after} onOpenLink={onOpenLink} onOpenReport={onOpenReport} openReport={openReport} streaming={streaming} />}
    </div>
  )
})

/** The newest report in a conversation, if it has one. */
export const latestReport = (turns: { role: string; content: string }[]): Report | null => conversationReports(turns).at(-1) ?? null
