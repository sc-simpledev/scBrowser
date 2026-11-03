import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileText, Maximize2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import contentCss from '@scbrowser/ui/content.css?raw'
import tokensCss from '@scbrowser/ui/tokens.css?raw'
import { Button, IconButton, Select } from '@scbrowser/ui'
import { REPORT_FORMATS, REPORT_THEMES, reportHtml, reportMarkdown, type Report, type ReportFormat, type ReportThemeId } from '@scbrowser/shared'
import { ReportView, Thinking } from './ReplyContent'
import { ResizeHandle } from './ResizeHandle'

// A saved report stands alone, so it takes the tokens but not the fonts they import.
const REPORT_CSS = `${tokensCss.replace(/^@import .*$/gm, '')}\n${contentCss}`

export type SaveReport = (title: string, format: ReportFormat, content: string) => Promise<boolean>

function DownloadMenu({ report, save }: { report: Report; save: SaveReport }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', dismiss)
    }
  }, [open])

  const download = (format: ReportFormat) => {
    setOpen(false)
    setNote(null)
    const content = format === 'md' ? reportMarkdown(report) : format === 'docx' ? JSON.stringify(report) : reportHtml(report, REPORT_CSS)
    void save(report.title, format, content)
      .then((saved) => setNote(saved ? 'Saved' : null))
      .catch(() => setNote("Couldn't save"))
  }

  return (
    <div ref={root} className="relative flex items-center gap-2">
      {note && <span role="status" className="text-xs text-text-muted">{note}</span>}
      <Button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        Download
        <ChevronDown aria-hidden size={14} strokeWidth={1.75} />
      </Button>
      {open && (
        <div role="menu" aria-label="Download as" className="absolute top-full right-0 z-10 mt-1 flex w-44 flex-col rounded-md bg-surface p-1 shadow-2">
          {(Object.keys(REPORT_FORMATS) as ReportFormat[]).map((format) => (
            <button key={format} type="button" role="menuitem" onClick={() => download(format)} className="flex h-8 items-center rounded-sm px-2 text-left hover:bg-surface-hover">
              {REPORT_FORMATS[format].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CopyReport({ report }: { report: Report }) {
  const [copied, setCopied] = useState(false)
  return (
    <IconButton
      label={copied ? 'Copied' : 'Copy as Markdown'}
      onClick={() =>
        void navigator.clipboard.writeText(reportMarkdown(report)).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? <Check size={15} strokeWidth={1.75} /> : <Copy size={15} strokeWidth={1.75} />}
    </IconButton>
  )
}

const MIN_WIDTH = 360

/** Asks for a new draft. The reply becomes the next version. */
function ChangeBox({ busy, onRevise }: { busy: boolean; onRevise: (change: string) => void }) {
  const [change, setChange] = useState('')
  return (
    <form
      aria-label="Ask for a change"
      className="flex shrink-0 items-center gap-1 border-t border-border bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!change.trim() || busy) return
        onRevise(change.trim())
        setChange('')
      }}
    >
      <input
        aria-label="Change to make"
        placeholder="Ask for a change, like “make it shorter”"
        value={change}
        onChange={(e) => setChange(e.target.value)}
        className="h-8 min-w-0 flex-1 bg-transparent px-2 text-sm text-text outline-none select-text placeholder:text-text-faint"
      />
      <IconButton size="sm" label="Ask for this change" type="submit" disabled={busy || !change.trim()} className={change.trim() && !busy ? 'bg-text! text-surface! hover:opacity-85' : ''}>
        <ArrowUp size={14} strokeWidth={2} />
      </IconButton>
    </form>
  )
}

interface ReportPaneProps {
  report: Report
  /** Every draft of this report, oldest first. */
  versions: Report[]
  onSelect: (report: Report) => void
  /** Left out when AI isn't available. */
  onRevise?: (change: string) => void
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
}

/** A report beside the conversation, with room to read it, ways to change it and ways to take it elsewhere. */
export function ReportPane({ report, versions, onSelect, onRevise, busy, save, onClose, onExpand, width, onWidth, onWidthCommit, onDragging }: ReportPaneProps) {
  // A design is a way of looking at the report, so it carries across drafts.
  const [design, setDesign] = useState<ReportThemeId | null>(null)
  const shown = { ...report, theme: design ?? report.theme }
  const index = versions.findIndex((version) => JSON.stringify(version) === JSON.stringify(report))
  return (
    <section aria-label="Report" className="relative flex min-w-0 shrink flex-col border-l border-border bg-bg" style={{ width, flexBasis: width }}>
      <ResizeHandle label="Report width" edge="left" width={width} min={MIN_WIDTH} max={Math.max(MIN_WIDTH, innerWidth - 320)} onWidth={onWidth} onCommit={onWidthCommit} onDragging={onDragging} />
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-surface pr-2 pl-4">
        <FileText aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" />
        <div className="mr-2 min-w-0 flex-1 truncate font-medium">{report.title}</div>
        <Select aria-label="Design" className="h-8 w-auto text-xs" value={shown.theme} onChange={(e) => setDesign(e.target.value as ReportThemeId)}>
          {REPORT_THEMES.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <CopyReport report={shown} />
        <DownloadMenu report={shown} save={save} />
        {onExpand && (
          <IconButton label="Open in a full page" onClick={onExpand}>
            <Maximize2 size={15} strokeWidth={1.75} />
          </IconButton>
        )}
        <IconButton label="Close report" onClick={onClose}>
          <X size={15} strokeWidth={1.75} />
        </IconButton>
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
        </nav>
      )}
      <div className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto p-4">
        {busy && (
          <div className="mx-auto mb-3 max-w-180">
            <Thinking label="Working on it" />
          </div>
        )}
        <div className="mx-auto max-w-180 rounded-lg bg-surface px-8 py-9 shadow-1">
          <ReportView report={shown} />
        </div>
      </div>
      {onRevise && <ChangeBox busy={busy} onRevise={onRevise} />}
    </section>
  )
}
