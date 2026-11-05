import { ArrowUp, Check, ChevronLeft, ChevronRight, Code2, Copy, Download, Eye, FileCode2, RotateCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cx, IconButton, Select } from '@scbrowser/ui'
import { languageOf, previewKind, type FileVersion } from '@scbrowser/shared'
import { highlight } from './highlight'
import { ReplyMarkdown, Thinking } from './ReplyContent'
import { ResizeHandle } from './ResizeHandle'

/** Hands a file to the main process, which serves it to the preview frame with no way out to the network. */
export type PreviewFile = (name: string, content: string) => Promise<string>
export type SaveFile = (name: string, content: string) => Promise<boolean>

const MIN_WIDTH = 360

function CodeView({ file }: { file: FileVersion }) {
  const tokens = useMemo(() => highlight(file.content, languageOf(file.name)), [file])
  const lines = file.content.split('\n').length
  return (
    <div className="sc-code flex min-h-full font-mono text-xs leading-5">
      <pre aria-hidden className="shrink-0 border-r border-border px-3 py-3 text-right text-text-faint select-none">
        {Array.from({ length: lines }, (_, index) => index + 1).join('\n')}
      </pre>
      <pre aria-label={`Code of ${file.name}`} className="min-w-0 flex-1 overflow-x-auto px-4 py-3 select-text">
        <code>
          {tokens.map((token, index) =>
            token.kind === 'plain' ? token.text : (
              <span key={index} className={`tok-${token.kind}`}>
                {token.text}
              </span>
            )
          )}
        </code>
      </pre>
    </div>
  )
}

/**
 * The preview is its own sandboxed frame on a separate scheme, with a policy that blocks every
 * request. The main process also stops it navigating anywhere else, so a file can't send out
 * anything it learnt from the conversation.
 */
function Preview({ file, preview, reload }: { file: FileVersion; preview: PreviewFile; reload: number }) {
  const kind = previewKind(file.name)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (kind === 'markdown' || !kind) return
    let current = true
    setUrl(null)
    setFailed(false)
    preview(file.name, file.content)
      .then((next) => current && setUrl(next))
      .catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [file, kind, preview, reload])
  if (kind === 'markdown') {
    return (
      <div className="mx-auto max-w-180 p-6">
        <ReplyMarkdown text={file.content} onOpenLink={() => undefined} />
      </div>
    )
  }
  if (failed) return <p className="p-6 text-text-muted">This file couldn’t be previewed.</p>
  if (!url) return <div className="p-6"><Thinking label="Getting the preview ready" /></div>
  return <iframe key={`${url}:${reload}`} title={`Preview of ${file.name}`} src={url} sandbox="allow-scripts allow-modals" className="size-full border-0 bg-white" />
}

/** Asks for a change to the open file. The reply becomes its next version. */
function ChangeBox({ name, busy, onRevise }: { name: string; busy: boolean; onRevise: (change: string) => void }) {
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
        placeholder={`Ask for a change to ${name}`}
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

function Segmented({ value, onChange }: { value: 'code' | 'preview'; onChange: (value: 'code' | 'preview') => void }) {
  return (
    <div role="tablist" aria-label="Show" className="flex h-8 items-center rounded-md border border-border p-0.5">
      {(
        [
          ['preview', 'Preview', Eye],
          ['code', 'Code', Code2]
        ] as const
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cx('flex h-full items-center gap-1.5 rounded-sm px-2 text-xs transition-colors', value === id ? 'bg-surface-active text-text' : 'text-text-muted hover:text-text')}
        >
          <Icon aria-hidden size={13} strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </div>
  )
}

interface CodePaneProps {
  files: Map<string, FileVersion[]>
  /** The version on show. */
  file: FileVersion
  onSelect: (file: FileVersion) => void
  /** Left out when AI isn't available. */
  onRevise?: (change: string) => void
  busy: boolean
  preview: PreviewFile
  save: SaveFile
  onClose: () => void
  width: number
  onWidth: (width: number) => void
  onWidthCommit: (width: number) => void
  onDragging?: (dragging: boolean) => void
}

/** A file the assistant wrote, beside the conversation: its code, a live preview, its versions and a way to ask for changes. */
export function CodePane({ files, file, onSelect, onRevise, busy, preview, save, onClose, width, onWidth, onWidthCommit, onDragging }: CodePaneProps) {
  const canPreview = previewKind(file.name) !== null
  const [view, setView] = useState<'code' | 'preview'>(canPreview ? 'preview' : 'code')
  const [reload, setReload] = useState(0)
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const shown = canPreview ? view : 'code'
  const versions = files.get(file.name) ?? [file]
  const index = versions.findIndex((version) => version.turn === file.turn && version.content === file.content)
  const names = [...files.keys()]

  return (
    <section aria-label="File" className="relative flex min-w-0 shrink flex-col border-l border-border bg-bg" style={{ width, flexBasis: width }}>
      <ResizeHandle label="File width" edge="left" width={width} min={MIN_WIDTH} max={Math.max(MIN_WIDTH, innerWidth - 320)} onWidth={onWidth} onCommit={onWidthCommit} onDragging={onDragging} />
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-surface pr-2 pl-4">
        <FileCode2 aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" />
        {names.length > 1 ? (
          <Select aria-label="File" className="h-8 w-auto max-w-48 min-w-0 font-mono text-xs" value={file.name} onChange={(e) => onSelect(files.get(e.target.value)!.at(-1)!)}>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        ) : (
          <div className="min-w-0 truncate font-mono text-xs font-medium">{file.name}</div>
        )}
        <div className="min-w-0 flex-1" />
        {canPreview && <Segmented value={shown} onChange={setView} />}
        {shown === 'preview' && previewKind(file.name) !== 'markdown' && (
          <IconButton label="Run again" onClick={() => setReload((n) => n + 1)}>
            <RotateCw size={14} strokeWidth={1.75} />
          </IconButton>
        )}
        <IconButton
          label={copied ? 'Copied' : 'Copy code'}
          onClick={() =>
            void navigator.clipboard.writeText(file.content).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
        >
          {copied ? <Check size={15} strokeWidth={1.75} /> : <Copy size={15} strokeWidth={1.75} />}
        </IconButton>
        <IconButton
          label="Download"
          onClick={() => {
            setNote(null)
            void save(file.name, file.content)
              .then((saved) => setNote(saved ? 'Saved' : null))
              .catch(() => setNote("Couldn't save"))
          }}
        >
          <Download size={15} strokeWidth={1.75} />
        </IconButton>
        {note && <span role="status" className="text-xs text-text-muted">{note}</span>}
        <IconButton label="Close file" onClick={onClose}>
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
            <span className="text-text-faint"> · {versions[index]!.how}</span>
          </span>
          <IconButton size="sm" label="Later version" disabled={index === versions.length - 1} onClick={() => onSelect(versions[index + 1]!)}>
            <ChevronRight size={13} strokeWidth={1.75} />
          </IconButton>
        </nav>
      )}
      {busy && (
        <div className="shrink-0 border-b border-border bg-surface px-4 py-2">
          <Thinking label="Working on it" />
        </div>
      )}
      <div className={cx('min-h-0 flex-1', shown === 'code' ? 'sc-scroll-quiet overflow-auto bg-surface' : 'overflow-hidden')}>
        {shown === 'code' ? <CodeView file={file} /> : <Preview file={file} preview={preview} reload={reload} />}
      </div>
      {onRevise && <ChangeBox name={file.name} busy={busy} onRevise={onRevise} />}
    </section>
  )
}
