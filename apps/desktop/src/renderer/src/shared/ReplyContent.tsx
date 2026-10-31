import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@scbrowser/ui'
import { isHttpUrl, splitReply, type Report, type ReportBlock } from '@scbrowser/shared'

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

interface ReplyContentProps {
  text: string
  onOpenLink: (href: string) => void
  /** When set, shows a card that opens the report rather than the report itself. */
  onOpenReport?: () => void
}

export const ReplyContent = memo(function ReplyContent({ text, onOpenLink, onOpenReport }: ReplyContentProps) {
  const { before, after, report, writing } = splitReply(text)
  return (
    <div className="flex flex-col gap-3">
      {before && <ReplyMarkdown text={before} onOpenLink={onOpenLink} />}
      {writing && <p className="text-text-faint">Writing a report…</p>}
      {report &&
        (onOpenReport ? (
          <div className="flex flex-col gap-2 rounded-md bg-surface-hover p-3">
            <div className="font-medium">{report.title}</div>
            {report.summary && <div className="text-xs text-text-muted">{report.summary}</div>}
            <div>
              <Button onClick={onOpenReport}>Open report</Button>
            </div>
          </div>
        ) : (
          <ReportView report={report} />
        ))}
      {after && <ReplyMarkdown text={after} onOpenLink={onOpenLink} />}
    </div>
  )
})
