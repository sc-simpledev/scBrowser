import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Compass,
  Copy,
  Download,
  FileMinus,
  FilePen,
  FilePlus,
  FileSearch,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  KeyRound,
  ListChecks,
  Monitor,
  MoreHorizontal,
  Move,
  Plug,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  SquareTerminal,
  Stethoscope,
  Trash2,
  Undo2,
  Webhook,
  X,
  type LucideIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, cx, IconButton, Input } from '@scbrowser/ui'
import {
  CODE_CHAT_PREFIX,
  CODER_BUILTIN_COMMANDS,
  CODER_INIT_TASK,
  reviewTask,
  type CoderAnswer,
  type CoderChange,
  type CoderDecision,
  type CoderEffort,
  type CoderEvent,
  type CoderExtension,
  type CoderHunk,
  type CoderJob,
  type CoderMode,
  type CoderReview,
  type CoderRunMode,
  type CoderStatus,
  type CoderTodo,
  type CoderToolName,
  type CoderWorktree
} from '@scbrowser/shared'
import { api } from '../api'
import { ReplyMarkdown, Thinking } from '../../shared/ReplyContent'
import { AiNetworkHelp } from '../../shared/AiNetworkHelp'
import { applyEvent, emptyState, savedItems, sessionMarkdown, type CodeState, type Item } from './codeState'
import { CodeSettings } from './CodeSettings'
import { Composer, type ModelPick, type SendPayload } from './Composer'

const TOOL_ICONS: Record<CoderToolName, LucideIcon> = {
  list: FolderTree,
  glob: FileSearch,
  read: FileSearch,
  search: Search,
  write: FilePen,
  edit: FilePen,
  patch: FilePen,
  delete: Trash2,
  move: Move,
  run: SquareTerminal,
  output: SquareTerminal,
  kill: Square,
  todo: ListChecks,
  web: Globe,
  fetch: Globe,
  explore: Compass,
  agent: Bot,
  skill: Sparkles,
  diagnostics: Stethoscope,
  preview: Monitor,
  tabs: Globe,
  mcp: Plug,
  hook: Webhook
}

const STARTERS = [
  { label: 'Explain this project', task: 'Explain how this project is put together: what it does, the main parts and where they live, and how to run and test it.' },
  { label: 'Find and fix a bug', task: 'Run the project’s tests or checks, find what fails, and fix it.' },
  { label: 'Review my changes', task: '/review' },
  { label: 'Write TERRA.md for this project', task: '/init' }
]

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const HOSTED_NOTE_KEY = 'terra-code-hosted-note-closed'
const noteClosed = () => {
  try {
    return localStorage.getItem(HOSTED_NOTE_KEY) === '1'
  } catch {
    return false
  }
}

/** Colours a diff's lines without parsing anything else out of it. */
function Detail({ text, diff, tail = false }: { text: string; diff: boolean; tail?: boolean }) {
  const ref = useRef<HTMLPreElement>(null)
  // Live output follows its end, as a terminal would.
  useEffect(() => {
    if (tail && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text, tail])
  return (
    <pre ref={ref} className={cx('overflow-auto rounded-md border border-border bg-bg py-2 font-mono text-2xs leading-normal whitespace-pre select-text', tail ? 'max-h-40' : 'max-h-80')}>
      {diff ? (
        text.split('\n').map((line, i) => (
          <div key={i} className={cx('w-max min-w-full px-2.5', line.startsWith('+ ') && 'bg-success/10 text-success', line.startsWith('- ') && 'bg-danger/10 text-danger', (line.startsWith('@@') || line.startsWith('=== ')) && 'text-text-faint')}>
            {line || ' '}
          </div>
        ))
      ) : (
        <div className="px-2.5">{text}</div>
      )}
    </pre>
  )
}

type ToolItem = Extract<Item, { kind: 'tool' }>

/** The first word of a summary is what it did, and the rest is what it did it to. */
function splitSummary(summary: string): [string, string] {
  const at = summary.indexOf(' ')
  return at === -1 ? [summary, ''] : [summary.slice(0, at), summary.slice(at + 1)]
}

function ToolState({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span role="status" aria-label="Running" className="size-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
  if (ok) return <Check aria-label="Done" size={12} strokeWidth={2} className="shrink-0 text-text-faint" />
  return <X aria-label="Failed" size={12} strokeWidth={2} className="shrink-0 text-danger" />
}

function ToolRow({ item, onStop }: { item: ToolItem; onStop?: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICONS[item.tool] ?? SquareTerminal
  const [verb, target] = splitSummary(item.summary)
  const running = item.ok === null
  const live = running && item.live
  return (
    <div className="group/tool flex flex-col gap-1">
      <div className="flex h-6.5 min-w-0 items-center gap-1">
        <button type="button" aria-expanded={open} disabled={!item.output} onClick={() => setOpen(!open)} className="group flex h-6.5 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-xs text-text-muted transition-colors enabled:hover:bg-surface-hover">
          <Icon aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
          <span className="shrink-0 text-text">{verb}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-2xs">{target}</span>
          <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint opacity-0 transition group-hover:opacity-100', open && 'rotate-90 opacity-100')} />
          <ToolState ok={item.ok} />
        </button>
        {running && (item.tool === 'run' || item.tool === 'diagnostics') && onStop && (
          <IconButton size="sm" label="Stop this command" className="opacity-0 group-hover/tool:opacity-100 focus-visible:opacity-100" onClick={() => onStop(item.id)}>
            <Square size={10} strokeWidth={2} />
          </IconButton>
        )}
      </div>
      {live && <Detail text={live} diff={false} tail />}
      {open && item.output && <Detail text={item.output} diff={false} />}
    </div>
  )
}

const TOOL_WORDS: Partial<Record<CoderToolName, [string, string]>> = {
  read: ['Read', 'file'],
  write: ['Wrote', 'file'],
  edit: ['Edited', 'file'],
  patch: ['Edited', 'set'],
  delete: ['Deleted', 'file'],
  move: ['Moved', 'file'],
  list: ['Listed', 'folder'],
  glob: ['Looked for', 'pattern'],
  search: ['Searched', 'time'],
  web: ['Searched the web', 'time'],
  fetch: ['Read', 'page'],
  run: ['Ran', 'command'],
  output: ['Checked a job', 'time'],
  kill: ['Stopped', 'job'],
  todo: ['Updated the plan', 'time'],
  explore: ['Explored', 'question'],
  agent: ['Asked', 'agent'],
  skill: ['Loaded', 'skill'],
  diagnostics: ['Checked the code', 'time'],
  preview: ['Used the preview', 'time'],
  tabs: ['Looked at tabs', 'time'],
  mcp: ['Used', 'tool'],
  hook: ['Ran', 'hook']
}

/** "Read 3 files, ran 1 command": a run of steps in a few words. */
function describeTools(tools: ToolItem[]): string {
  const counts = new Map<CoderToolName, number>()
  for (const tool of tools) counts.set(tool.tool, (counts.get(tool.tool) ?? 0) + 1)
  const parts = [...counts].map(([tool, count]) => {
    const [verb, noun] = TOOL_WORDS[tool] ?? [tool, 'time']
    return noun === 'time' && count === 1 ? verb : tool === 'todo' ? verb : `${verb} ${count} ${noun}${count === 1 ? '' : 's'}`
  })
  const text = parts.join(', ')
  return parts.length > 1 ? text.replace(/(?<=, )[A-Z]/g, (letter) => letter.toLowerCase()) : text
}

/** Several steps in a row fold into one line, so the conversation stays readable. */
function ToolGroup({ tools, onStop }: { tools: ToolItem[]; onStop: (id: string) => void }) {
  const running = tools.some((tool) => tool.ok === null)
  const failed = tools.filter((tool) => tool.ok === false).length
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? running
  if (tools.length === 1) return <ToolRow item={tools[0]!} onStop={onStop} />
  return (
    <div className="flex flex-col gap-0.5">
      <button type="button" aria-expanded={open} onClick={() => setChosen(!open)} className="flex h-6.5 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover">
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">{describeTools(tools)}</span>
        {failed > 0 && <span className="shrink-0 text-danger">{failed} failed</span>}
        {running && <ToolState ok={null} />}
      </button>
      {open && (
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
          {tools.map((tool) => (
            <ToolRow key={tool.id} item={tool} onStop={onStop} />
          ))}
        </div>
      )}
    </div>
  )
}

const APPROVAL_ICONS = { change: FilePen, command: SquareTerminal, tool: Plug }

function ApprovalCard({ item, onAnswer }: { item: Extract<Item, { kind: 'approval' }>; onAnswer: (answer: CoderAnswer) => void }) {
  const pending = item.answer === null
  if (!pending) {
    return (
      <div className="flex h-6.5 min-w-0 items-center gap-2 px-1.5 text-xs text-text-muted">
        <X aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
        <span className="shrink-0">Declined</span>
        <span className="min-w-0 truncate font-mono text-2xs">{item.type === 'command' ? item.detail : item.summary}</span>
      </div>
    )
  }
  const Icon = APPROVAL_ICONS[item.type] ?? Plug
  const yes = item.type === 'command' ? 'Run' : item.type === 'change' ? 'Apply change' : 'Allow'
  return (
    <div role="group" aria-label={item.summary} className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface p-2.5">
      <div className="flex items-center gap-2 px-0.5 text-sm font-medium">
        <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
        <span className="min-w-0 truncate">{item.summary}</span>
      </div>
      <Detail text={item.detail} diff={item.type === 'change'} />
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="ghost" onClick={() => onAnswer('deny')}>
          Decline
        </Button>
        {item.rule ? (
          <Button onClick={() => onAnswer('always')} title="Saved for this project. You can remove it in Terra Code settings.">
            Always allow <code className="max-w-48 truncate font-mono text-2xs">{item.rule}</code> here
          </Button>
        ) : (
          item.always && <Button onClick={() => onAnswer('always')}>{item.always}</Button>
        )}
        <Button variant="primary" onClick={() => onAnswer('allow')}>
          {yes}
        </Button>
      </div>
    </div>
  )
}

/** The plan as one line above the message box, which opens to show every step. */
function TodoList({ items }: { items: CoderTodo[] }) {
  const [open, setOpen] = useState(false)
  const done = items.filter((item) => item.done).length
  const current = items.find((item) => !item.done)
  return (
    <section aria-label="Plan" className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-surface-hover">
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
        <ListChecks aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-muted" />
        <span className="shrink-0 font-medium">Plan</span>
        <span className="min-w-0 flex-1 truncate text-text-muted">{current?.text ?? 'All steps done'}</span>
        <span className="shrink-0 text-text-faint tabular-nums">
          {done} of {items.length}
        </span>
      </button>
      {open && (
        <ul className="flex flex-col gap-1 px-1.5 pt-1 pb-1.5">
          {items.map((item, i) => (
            <li key={i} className={cx('flex items-start gap-2 text-xs', item.done ? 'text-text-faint line-through' : 'text-text')}>
              <span aria-hidden className={cx('mt-0.5 grid size-3 shrink-0 place-items-center rounded-sm border', item.done ? 'border-success bg-success text-surface' : 'border-border-strong')}>
                {item.done && <Check size={9} strokeWidth={3} />}
              </span>
              <span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>
              {item.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Commands left running, such as dev servers, with what they printed last. */
function JobsBar({ jobs, onStop }: { jobs: CoderJob[]; onStop: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const running = jobs.filter((job) => job.running)
  if (running.length === 0) return null
  return (
    <section aria-label="Background jobs" className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-surface-hover">
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
        <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-success" />
        <span className="shrink-0 font-medium">
          {running.length} running in the background
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-text-muted">{running.map((job) => job.command).join(' · ')}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-1.5 px-1.5 pt-1 pb-1.5">
          {running.map((job) => (
            <li key={job.id} className="flex flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-2xs text-text-faint tabular-nums">{job.id}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-2xs">{job.command}</code>
                <Button variant="ghost" onClick={() => onStop(job.id)}>
                  Stop
                </Button>
              </div>
              {job.tail && <Detail text={job.tail.trimEnd()} diff={false} tail />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const STATUS_ICONS: Record<CoderChange['status'], LucideIcon> = { created: FilePlus, modified: FilePen, deleted: FileMinus }

/** A line above the box saying what changed, which opens the review screen or a commit. */
function ChangesBar({ files, git, busy, onReview, onCommit }: { files: CoderChange[]; git: boolean; busy: boolean; onReview: () => void; onCommit: () => void }) {
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  return (
    <section aria-label="Changed files" className="flex h-8 items-center gap-2 px-1.5 text-xs">
      <FilePen aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-muted" />
      <span className="font-medium">
        {files.length} {files.length === 1 ? 'file' : 'files'} changed
      </span>
      <span className="text-success">+{added}</span>
      <span className="text-danger">−{removed}</span>
      <span className="ml-auto flex items-center gap-0.5">
        {git && (
          <Button variant="ghost" disabled={busy} onClick={onCommit}>
            Commit
          </Button>
        )}
        <Button variant="ghost" onClick={onReview}>
          Review
        </Button>
      </span>
    </section>
  )
}

/** Commits the session's changes with a message the quick model writes first, which the person can change. */
function CommitCard({ session, onDone, onCancel }: { session: string; onDone: (note: string) => void; onCancel: () => void }) {
  const [message, setMessage] = useState('')
  const [writing, setWriting] = useState(true)
  const [branch, setBranch] = useState('')
  const [onBranch, setOnBranch] = useState(false)
  const [all, setAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api()
      .invoke('coder:commit-message', session)
      .then(
        (written) => setMessage((current) => current || written),
        () => undefined
      )
      .finally(() => setWriting(false))
  }, [session])
  const submit = () => {
    setBusy(true)
    setError(null)
    void api()
      .invoke('coder:commit', session, message, onBranch ? branch : null, all)
      .then(
        (head) => onDone(`Committed ${head}.`),
        (failure: Error) => {
          setError(cleanError(failure.message))
          setBusy(false)
        }
      )
  }
  return (
    <section aria-label="Commit" className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface p-2.5">
      <div className="flex items-center gap-2 px-0.5 text-sm font-medium">
        <GitCommitHorizontal aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
        Commit
      </div>
      <textarea
        aria-label="Commit message"
        value={message}
        placeholder={writing ? 'Writing a message…' : 'What changed, and why'}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        className="resize-none rounded-md border border-border bg-field px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-text-faint focus:border-border-strong"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5 text-xs text-text-muted">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={onBranch} onChange={(e) => setOnBranch(e.target.checked)} className="accent-(--sc-accent)" />
          On a new branch
        </label>
        {onBranch && <Input aria-label="Branch name" value={branch} placeholder="feature/name" onChange={(e) => setBranch(e.target.value)} className="h-6.5 w-44 font-mono text-xs" />}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-(--sc-accent)" />
          Include changes made outside this session
        </label>
      </div>
      {error && <p className="px-0.5 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || !message.trim() || (onBranch && !branch.trim())} onClick={submit}>
          Commit
        </Button>
      </div>
    </section>
  )
}

function HunkView({ hunk, busy, onDecide }: { hunk: CoderHunk; busy: boolean; onDecide: (decision: CoderDecision) => void }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex h-8 items-center gap-1 border-b border-border bg-surface pr-1 pl-2.5 text-2xs text-text-faint">
        <span className="mr-auto tabular-nums">Line {hunk.line}</span>
        <Button variant="ghost" disabled={busy} onClick={() => onDecide('reject')}>
          Put back
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => onDecide('accept')}>
          Keep
        </Button>
      </div>
      <div className="sc-scroll-quiet overflow-x-auto bg-bg py-1 font-mono text-2xs leading-normal whitespace-pre select-text">
        {hunk.rows.map((row, i) => (
          <div key={i} className={cx('w-max min-w-full px-2.5', row.startsWith('+ ') && 'bg-success/10 text-success', row.startsWith('- ') && 'bg-danger/10 text-danger', row.startsWith('  ') && 'text-text-muted')}>
            {row || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Every file the session changed, one at a time, with each change to keep or put back. */
function ReviewScreen({ session, files, busy, onChange, onClose }: { session: string; files: CoderChange[]; busy: boolean; onChange: (files: CoderChange[], note?: string) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [review, setReview] = useState<CoderReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const path = files.some((file) => file.path === chosen) ? chosen : (files[0]?.path ?? null)
  useEffect(() => {
    if (!files.length) onClose()
  }, [files.length, onClose])
  useEffect(() => {
    if (!path) return setReview(null)
    let stale = false
    void api().invoke('coder:review', session, path).then((next) => {
      if (!stale) setReview(next)
    })
    return () => {
      stale = true
    }
  }, [path, session, files])
  const decide = (hunk: string | null, decision: CoderDecision) => {
    if (!path) return
    setError(null)
    void api().invoke('coder:decide', session, path, hunk, decision).then(onChange, (failure: Error) => setError(cleanError(failure.message)))
  }
  const keepAll = async () => {
    for (const file of files) await api().invoke('coder:decide', session, file.path, null, 'accept')
    onChange([], 'Kept every change.')
  }
  return (
    <div role="region" aria-label="Review changes" className="flex min-h-0 flex-1">
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex h-10 shrink-0 items-center gap-1 px-2">
          <IconButton size="sm" label="Back to the conversation" onClick={onClose}>
            <ArrowLeft size={14} strokeWidth={1.75} />
          </IconButton>
          <h2 className="text-sm font-medium">Review</h2>
          <span className="ml-auto pr-1 text-2xs text-text-faint tabular-nums">{files.length}</span>
        </div>
        <ul className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {files.map((file) => {
            const Icon = STATUS_ICONS[file.status]
            return (
              <li key={file.path}>
                <button type="button" aria-current={file.path === path} onClick={() => setChosen(file.path)} className={cx('flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors', file.path === path ? 'bg-surface-hover' : 'hover:bg-surface-hover')}>
                  <Icon aria-label={file.status} size={13} strokeWidth={1.75} className={cx('shrink-0', file.status === 'created' ? 'text-success' : file.status === 'deleted' ? 'text-danger' : 'text-text-muted')} />
                  <span dir="rtl" title={file.path} className="min-w-0 flex-1 truncate text-left font-mono text-2xs">
                    {file.path}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex shrink-0 items-center gap-1 border-t border-border p-1.5">
          {confirming ? (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="ml-auto"
                onClick={() => {
                  setConfirming(false)
                  void api().invoke('coder:undo', session).then((count) => onChange([], `Put ${count} ${count === 1 ? 'file' : 'files'} back as they were.`), (failure: Error) => setError(cleanError(failure.message)))
                }}
              >
                Put all back
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
                <Undo2 aria-hidden size={13} strokeWidth={1.75} />
                Undo all
              </Button>
              <Button variant="ghost" className="ml-auto" disabled={busy} onClick={() => void keepAll()}>
                Keep all
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-2 pl-4">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
          <Button variant="ghost" disabled={busy} onClick={() => decide(null, 'reject')}>
            Put back file
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => decide(null, 'accept')}>
            Keep file
          </Button>
        </div>
        <div className="sc-scroll-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {busy && <p className="text-xs text-text-muted">Terra Code is still working. Stop it to keep or put back changes.</p>}
          {error && <p className="text-xs text-danger">{error}</p>}
          {review?.binary && <p className="text-sm text-text-muted">This file isn’t text, so there’s nothing to show. You can still keep it or put it back.</p>}
          {review?.hunks.map((hunk) => (review.whole ? <Detail key={hunk.id} text={hunk.rows.join('\n')} diff /> : <HunkView key={hunk.id} hunk={hunk} busy={busy} onDecide={(decision) => decide(hunk.id, decision)} />))}
        </div>
      </div>
    </div>
  )
}

/** What the person sent, with a way back to just before it. */
function TaskBubble({ item, canRewind, onRewind }: { item: Extract<Item, { kind: 'task' }>; canRewind: boolean; onRewind: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="group/task ml-auto flex max-w-[85%] flex-col items-end gap-1">
      <div className="flex items-start gap-1">
        {canRewind && !confirming && (
          <IconButton size="sm" label="Rewind to before this" className="mt-1 opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100" onClick={() => setConfirming(true)}>
            <Undo2 size={12} strokeWidth={1.75} />
          </IconButton>
        )}
        <div className="rounded-lg bg-surface-hover px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] select-text">
          {item.shown ?? item.text}
          {item.pictures ? <span className="mt-1 block text-2xs text-text-faint">{item.pictures === 1 ? 'With a picture' : `With ${item.pictures} pictures`}</span> : null}
        </div>
      </div>
      {confirming && (
        <div role="group" aria-label="Rewind" className="flex items-center gap-1.5 text-xs text-text-muted">
          <span>Put files and the conversation back to before this?</span>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirming(false)
              onRewind()
            }}
          >
            Rewind
          </Button>
        </div>
      )}
    </div>
  )
}

/** A small menu of its own, as these are only a few rows. */
function Menu({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false)
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <IconButton size="sm" label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}
      </IconButton>
      {open && (
        <div role="menu" aria-label={label} className="sc-glass-strong absolute top-full right-0 z-30 mt-1 flex w-64 flex-col rounded-lg p-1 text-text shadow-3">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, hint, disabled, danger, onClick }: { icon: LucideIcon; label: string; hint?: string; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cx('flex min-h-8 items-center gap-2.5 rounded-md px-2 py-1 text-left text-xs transition-colors enabled:hover:bg-surface-hover disabled:opacity-50', danger && 'text-danger')}>
      <Icon aria-hidden size={13} strokeWidth={1.75} className={cx('shrink-0', danger ? 'text-danger' : 'text-text-muted')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        {hint && <span className="text-2xs text-text-faint">{hint}</span>}
      </span>
    </button>
  )
}

export interface CodeWorkspaceProps {
  /** A saved chat to open. */
  chat?: string | null
  /** Called as the chat on screen changes (null: a new one, not saved yet) and whenever it's saved. */
  onChat?: (id: string | null) => void
  /** A task to start with as soon as everything is ready, such as one typed as /code in the assistant. */
  initialTask?: string | null
  onInitialTaskTaken?: () => void
  /** Drawn at the start of the bar, such as the assistant's Chat and Code switch. */
  leading?: ReactNode
}

interface SavedData {
  items: Item[]
  todo: CoderTodo[]
  model?: ModelPick | null
  effort?: CoderEffort | null
}

const HELP = `Terra Code works on files in your project folder. It asks before changing anything or running commands, unless you let edits through (Auto-edit) or allow a command for this project.

- **/** shows commands: ${CODER_BUILTIN_COMMANDS.map((command) => `/${command.name}`).join(', ')}, and any in the project’s .terra/commands.
- **@** attaches a file from the project, or one of your open tabs.
- Paste or drop pictures into the box for models that can see them.
- Hover a message you sent to rewind the files and conversation to before it.
- Settings (the gear) has command permissions, MCP servers, agents, skills, hooks and the sandbox.`

/** Terra Code (beta): a model works on files in one folder, and asks before changing anything. */
export function CodeWorkspace({ chat = null, onChat, initialTask = null, onInitialTaskTaken, leading }: CodeWorkspaceProps) {
  const [status, setStatus] = useState<CoderStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [mode, setMode] = useState<CoderMode>('ask')
  const [state, setState] = useState<CodeState>(emptyState)
  const [screen, setScreen] = useState<'log' | 'review' | 'settings'>('log')
  const [committing, setCommitting] = useState(false)
  const [hostedNoteClosed, setHostedNoteClosed] = useState(noteClosed)
  const [model, setModel] = useState<ModelPick | null>(null)
  const [effort, setEffort] = useState<CoderEffort | null>(null)
  const [commands, setCommands] = useState<CoderExtension[]>([])
  const [worktree, setWorktree] = useState<CoderWorktree | null>(null)
  const [seed, setSeed] = useState<{ text: string; at: number } | null>(null)
  const [modelMenu, setModelMenu] = useState(0)
  const session = useRef(chat ?? `${CODE_CHAT_PREFIX}${crypto.randomUUID()}`)
  const onChatRef = useRef(onChat)
  onChatRef.current = onChat
  /** What to send again when Retry is pressed after a network failure. */
  const lastTask = useRef<{ text: string; options: { images: string[]; mentions: SendPayload['mentions']; runMode?: CoderRunMode } } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const { items, todo, changes, jobs, context, streaming, step, working, retrySeconds } = state
  const note = (text: string, error = false) => setState((current) => ({ ...current, items: [...current.items, { kind: 'note', text, error }] }))

  const refresh = useCallback(
    () =>
      void api()
        .invoke('coder:status')
        .then((next) => {
          setStatus(next)
          setStatusError(null)
        })
        .catch((error: Error) => setStatusError(cleanError(error.message))),
    []
  )
  const loadCommands = useCallback(() => void api().invoke('coder:setup').then((setup) => setCommands(setup.commands), () => setCommands([])), [])
  useEffect(() => {
    refresh()
    loadCommands()
    void api().invoke('settings:get').then((settings) => setMode(settings.coderMode))
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, loadCommands])

  // Going back to a saved chat brings its folder, what was on screen, and what it did while away.
  useEffect(() => {
    if (!chat) return
    let cancelled = false
    void (async () => {
      const saved = await api().invoke('coder:open', chat)
      if (cancelled) return
      let next = emptyState()
      if (saved) {
        const data = JSON.parse(saved.data) as SavedData
        next = { ...next, items: data.items, todo: data.todo }
        setModel(data.model ?? null)
        setEffort(data.effort ?? null)
      }
      const replay = await api().invoke('coder:replay', chat)
      if (cancelled) return
      if (replay) {
        // The last turn as it really went, which may have carried on after the screen was saved.
        const at = replay.turnId ? next.items.findIndex((item) => item.kind === 'task' && item.turnId === replay.turnId) : -1
        const before = at === -1 ? next.items : next.items.slice(0, at)
        const task = at === -1 ? { kind: 'task' as const, text: replay.task, ...(replay.turnId ? { turnId: replay.turnId } : {}) } : next.items[at]!
        next = replay.events.reduce(applyEvent, { ...next, items: [...before, task], working: replay.running, step: replay.running ? 1 : null })
      }
      setState(next)
      refresh()
      loadCommands()
      setWorktree(await api().invoke('coder:worktree-info', chat))
      // Checkpoints keep these across restarts, so review and undo keep working.
      const files = await api().invoke('coder:changes', chat)
      if (!cancelled) setState((current) => ({ ...current, changes: files }))
    })()
    return () => {
      cancelled = true
    }
  }, [chat, refresh, loadCommands])

  /** The latest of what's on screen, so leaving the page can still keep it. */
  const unsaved = useRef<(() => void) | null>(null)
  useEffect(() => {
    const first = items.find((item) => item.kind === 'task')
    if (!first || first.kind !== 'task') return
    const id = session.current
    const save = () => {
      unsaved.current = null
      const data: SavedData = { items: savedItems(items), todo, model, effort }
      void api().invoke('coder:save', id, first.shown ?? first.text, JSON.stringify(data)).then(() => onChatRef.current?.(id))
    }
    unsaved.current = save
    const timer = setTimeout(save, 400)
    return () => clearTimeout(timer)
  }, [items, todo, model, effort])
  useEffect(() => {
    const leave = () => unsaved.current?.()
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [])

  useEffect(
    () =>
      window.scbInternal.onCoderEvent((event: CoderEvent) => {
        if (event.sessionId !== session.current) return
        setState((current) => applyEvent(current, event))
      }),
    []
  )

  useEffect(() => {
    const log = logRef.current
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 200) log.scrollTop = log.scrollHeight
  }, [items, step, streaming, todo])

  const start = useCallback(
    (task: string, { show = true, shown, images = [], mentions = [], runMode }: { show?: boolean; shown?: string; images?: string[]; mentions?: SendPayload['mentions']; runMode?: CoderRunMode } = {}) => {
      const turnId = crypto.randomUUID()
      lastTask.current = { text: task, options: { images, mentions, runMode } }
      setState((current) => ({
        ...current,
        working: true,
        step: 1,
        items: show ? [...current.items, { kind: 'task', text: task, turnId, ...(shown ? { shown } : {}), ...(images.length ? { pictures: images.length } : {}) }] : current.items
      }))
      void api()
        .invoke('coder:run', session.current, task, { turnId, images, mentions, model: model && { providerId: model.providerId, model: model.model }, effort, ...(runMode ? { mode: runMode } : {}) })
        .catch((error: Error) => setState((current) => ({ ...current, working: false, step: null, items: [...current.items, { kind: 'note', text: cleanError(error.message), error: true }] })))
    },
    [model, effort]
  )

  const workingRef = useRef(false)
  workingRef.current = state.working
  const newSession = useCallback(() => {
    // One that's working carries on in the background, and its chat shows what it did.
    if (!workingRef.current) void api().invoke('coder:reset', session.current)
    session.current = `${CODE_CHAT_PREFIX}${crypto.randomUUID()}`
    onChatRef.current?.(null)
    lastTask.current = null
    setState(emptyState())
    setScreen('log')
    setCommitting(false)
    setWorktree(null)
  }, [])

  const rewind = (turnId: string) => {
    void api()
      .invoke('coder:rewind', session.current, turnId)
      .then(
        async ({ task, files }) => {
          const changed = await api().invoke('coder:changes', session.current)
          setState((current) => {
            const at = current.items.findIndex((item) => item.kind === 'task' && item.turnId === turnId)
            const kept = at === -1 ? current.items : current.items.slice(0, at)
            return { ...current, items: [...kept, { kind: 'note', text: files ? `Rewound: ${files} ${files === 1 ? 'file is' : 'files are'} back as they were.` : 'Rewound the conversation.', error: false }], changes: changed, todo: [] }
          })
          setSeed({ text: task, at: Date.now() })
        },
        (error: Error) => note(cleanError(error.message), true)
      )
  }

  const fork = () =>
    void api()
      .invoke('coder:fork', session.current)
      .then((id) => {
        if (!id) return note('There’s nothing to copy yet.', true)
        onChatRef.current?.(id)
      })

  const exportSession = () => {
    const first = items.find((item) => item.kind === 'task')
    const title = first && first.kind === 'task' ? (first.shown ?? first.text).slice(0, 80) : 'Terra Code'
    void api().invoke('coder:export', title, sessionMarkdown(title, items, todo))
  }

  const separateCopy = () => {
    if (items.length > 0) newSession()
    void api()
      .invoke('coder:worktree', session.current)
      .then(
        (made) => {
          setWorktree(made)
          note(`Working in a separate copy on branch ${made.branch}, made from the last commit of ${made.base}. Changes here don’t touch your project until you merge them.`)
        },
        (error: Error) => note(cleanError(error.message), true)
      )
  }

  /** Slash commands the page handles itself, or turns into a task. False when it's a task as typed. */
  const command = (text: string): boolean => {
    const match = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text)
    if (!match) return false
    const [, name, rest = ''] = match
    const args = rest.trim()
    switch (name) {
      case 'init':
        start(CODER_INIT_TASK, { shown: text })
        return true
      case 'review':
        start(reviewTask(args || null), { shown: text, runMode: 'review' })
        return true
      case 'compact':
        if (working) {
          note('Wait for Terra Code to finish, or stop it, before compacting.', true)
          return true
        }
        note('Summarising the conversation so far…')
        void api()
          .invoke('coder:compact', session.current)
          .then(
            (done) => !done && note('There’s too little so far to summarise.'),
            (error: Error) => note(cleanError(error.message), true)
          )
        return true
      case 'undo': {
        const last = [...items].reverse().find((item) => item.kind === 'task' && item.turnId)
        if (last && last.kind === 'task' && last.turnId) rewind(last.turnId)
        else note('There’s nothing to undo yet.', true)
        return true
      }
      case 'remember':
        if (!args) {
          note('Write the note after /remember, such as /remember tests need the database running.', true)
          return true
        }
        void api()
          .invoke('coder:remember', args)
          .then(
            () => note(`Added to TERRA.md: ${args}`),
            (error: Error) => note(cleanError(error.message), true)
          )
        return true
      case 'model':
        setModelMenu((count) => count + 1)
        return true
      case 'clear':
        newSession()
        return true
      case 'fork':
        fork()
        return true
      case 'export':
        exportSession()
        return true
      case 'settings':
      case 'permissions':
      case 'mcp':
        setScreen('settings')
        return true
      case 'help':
        setState((current) => ({ ...current, items: [...current.items, { kind: 'text', text: HELP }] }))
        return true
      default:
        return false
    }
  }

  const send = ({ text, images, mentions }: SendPayload) => {
    if (!status?.folder || !status.ready) return
    if (text.startsWith('/') && !images.length && command(text)) return
    const task = text || 'What’s in this picture?'
    if (!working) return start(task, { images, mentions })
    // It reads this at its next step. If it has only just finished, this starts it again instead.
    setState((current) => ({ ...current, items: [...current.items, { kind: 'task', text: task }] }))
    void api()
      .invoke('coder:steer', session.current, task)
      .then((taken) => {
        if (!taken) start(task, { show: false, images, mentions })
      })
  }

  // A task handed over from the chat (/code …) or the command line starts once the folder and model are ready.
  const [cliTask, setCliTask] = useState<string | null>(null)
  useEffect(() => {
    void api().invoke('coder:pending').then((pending) => pending && setCliTask(pending.task))
  }, [])
  const handed = initialTask ?? cliTask
  useEffect(() => {
    if (!handed || !status) return
    const taken = () => {
      if (initialTask) onInitialTaskTaken?.()
      setCliTask(null)
    }
    if (status.folder && status.ready && !working) {
      taken()
      start(handed)
    } else if (!status.folder || !status.ready) {
      taken()
      setSeed({ text: handed, at: Date.now() })
    }
  }, [handed, initialTask, status, working, start, onInitialTaskTaken])

  const retry = () => {
    if (!lastTask.current || working) return
    setState((current) => ({ ...current, items: current.items.filter((item, index) => !(index === current.items.length - 1 && item.kind === 'note')) }))
    const { text, options } = lastTask.current
    start(text, { show: false, ...options })
  }

  const answer = (id: string, choice: CoderAnswer) => {
    setState((current) => ({ ...current, items: current.items.map((item) => (item.kind === 'approval' && item.id === id ? { ...item, answer: choice } : item)) }))
    void api().invoke('coder:answer', id, choice)
  }

  const closeScreen = useCallback(() => setScreen('log'), [])

  const pickFolder = () =>
    void api()
      .invoke('coder:pick-folder')
      .then((folder) => {
        if (!folder) return
        newSession()
        refresh()
        loadCommands()
      })

  const chooseMode = (coderMode: CoderMode) => {
    setMode(coderMode)
    void api().invoke('settings:set', { coderMode })
  }

  const blocks = useMemo(() => {
    const out: (Exclude<Item, ToolItem> | { kind: 'tools'; tools: ToolItem[] })[] = []
    for (const item of items) {
      const last = out.at(-1)
      // The plan has its own line above the box, so its updates needn't fill the conversation too.
      if (item.kind === 'tool' && item.tool === 'todo') continue
      // The card says what's being asked, and an allowed step carries on as its own row.
      if (item.kind === 'approval' && (item.answer === 'allow' || item.answer === 'always')) continue
      // Waiting, the card stands for the step; declined, its "Declined" line does.
      const step = last?.kind === 'tools' ? last.tools.at(-1) : undefined
      if (item.kind === 'approval' && last?.kind === 'tools' && ((item.answer === null && step?.ok === null) || (item.answer === 'deny' && step?.ok !== true))) {
        last.tools.pop()
        if (last.tools.length === 0) out.pop()
      }
      if (item.kind !== 'tool') out.push(item)
      else if (last?.kind === 'tools') last.tools.push(item)
      else out.push({ kind: 'tools', tools: [item] })
    }
    return out
  }, [items])

  if (statusError) return <p className="p-6 text-sm text-danger">{statusError}</p>
  if (!status) return null
  const waiting = items.some((item) => item.kind === 'approval' && item.answer === null)
  const stopTool = (id: string) => void api().invoke('coder:stop-tool', session.current, id)

  const closeHostedNote = () => {
    setHostedNoteClosed(true)
    try {
      localStorage.setItem(HOSTED_NOTE_KEY, '1')
    } catch {
      // It just comes back next time.
    }
  }

  const worktreeAction = (action: 'coder:worktree-merge' | 'coder:worktree-remove') =>
    void api()
      .invoke(action, session.current)
      .then(
        (said) => {
          if (action === 'coder:worktree-remove') {
            setWorktree(null)
            newSession()
            note('Removed the separate copy.')
          } else note(said ? `Merged into ${worktree?.base}: ${String(said).split('\n')[0]}` : `Merged into ${worktree?.base}.`)
        },
        (error: Error) => note(cleanError(error.message), true)
      )

  const controls = (
    <>
      <Button variant="ghost" onClick={pickFolder} title={status.folder ?? undefined} className="min-w-0">
        <FolderOpen aria-hidden size={13} strokeWidth={1.75} />
        <span className="max-w-60 truncate">{status.folder ? folderName(status.folder) : 'Choose a project folder'}</span>
      </Button>
      {worktree && (
        <Menu label={`Separate copy on ${worktree.branch}`} icon={<span className="flex items-center gap-1 px-1 font-mono text-2xs text-text-muted"><GitBranch aria-hidden size={12} strokeWidth={1.75} />{worktree.branch}</span>}>
          {(close) => (
            <>
              <p className="px-2 pt-1 pb-1.5 text-2xs text-text-faint">This session works in its own copy, made from {worktree.base}.</p>
              <MenuItem icon={GitBranch} label={`Merge into ${worktree.base}`} hint="Commit here first" disabled={working} onClick={() => (close(), worktreeAction('coder:worktree-merge'))} />
              <MenuItem icon={FolderTree} label="Show the copy’s folder" onClick={() => (close(), void api().invoke('browser:open', `file://${worktree.path}`))} />
              <MenuItem icon={Trash2} label="Remove the copy" hint="Its branch stays if it isn’t merged" danger disabled={working} onClick={() => (close(), worktreeAction('coder:worktree-remove'))} />
            </>
          )}
        </Menu>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <IconButton size="sm" label="Terra Code settings" aria-pressed={screen === 'settings'} onClick={() => setScreen(screen === 'settings' ? 'log' : 'settings')}>
          <Settings2 size={14} strokeWidth={1.75} />
        </IconButton>
        <Menu label="More" icon={<MoreHorizontal size={14} strokeWidth={1.75} />}>
          {(close) => (
            <>
              <MenuItem icon={GitBranch} label="New session in a separate copy" hint="Its own git worktree, so sessions can run side by side" disabled={!status.git || !!worktree} onClick={() => (close(), separateCopy())} />
              <MenuItem icon={Copy} label="Carry on in a copy" hint="This conversation, as a new chat" disabled={items.length === 0 || working} onClick={() => (close(), fork())} />
              <MenuItem icon={Download} label="Save as Markdown" disabled={items.length === 0} onClick={() => (close(), exportSession())} />
              {status.folder && <MenuItem icon={FolderTree} label="Show the folder" onClick={() => (close(), void api().invoke('coder:open-folder'))} />}
            </>
          )}
        </Menu>
        <IconButton size="sm" label="New session" onClick={newSession}>
          <Plus size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
    </>
  )

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        {leading}
        {controls}
      </div>

      {screen === 'review' && (
        <ReviewScreen
          session={session.current}
          files={changes}
          busy={working}
          onClose={closeScreen}
          onChange={(files, said) => setState((current) => ({ ...current, changes: files, items: said ? [...current.items, { kind: 'note', text: said, error: false }] : current.items }))}
        />
      )}
      {screen === 'settings' && <CodeSettings sandboxAvailable={status.sandboxAvailable} onClose={() => (closeScreen(), loadCommands())} />}

      <div ref={logRef} hidden={screen !== 'log'} role="log" aria-label="Terra Code" className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-200 flex-col gap-3 px-6 py-6">
          {status.hosted && !hostedNoteClosed && (
            <div role="note" className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted">
              <KeyRound aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
              <span className="min-w-0 flex-1">Coding uses many requests. Your own API key avoids the free {status.providerName ?? 'scTerra AI'} daily limit.</span>
              <a href="sc://ai/" className="shrink-0 font-medium text-accent hover:text-accent-hover">
                Add a key
              </a>
              <IconButton size="sm" label="Close this note" className="size-5!" onClick={closeHostedNote}>
                <X size={12} strokeWidth={1.75} />
              </IconButton>
            </div>
          )}
          {items.length === 0 && (
            <div className="flex flex-col gap-5 pt-[12vh]">
              <div className="flex flex-col gap-1.5">
                <h2 className="text-xl font-semibold tracking-[-0.02em]">{status.folder ? `What should we do in ${folderName(status.folder)}?` : 'Pick a project to work on'}</h2>
                <p className="max-w-130 text-sm text-text-muted">
                  {status.folder ? 'Terra Code reads your files, edits them and runs commands such as tests. Type / for commands and @ to attach a file or tab.' : 'Terra Code can only reach files inside the folder you choose, and asks before running anything.'}
                </p>
              </div>
              {!status.folder && (
                <div>
                  <Button variant="primary" onClick={pickFolder}>
                    <FolderOpen aria-hidden size={13} strokeWidth={1.75} />
                    Choose a project folder
                  </Button>
                </div>
              )}
              {status.folder && status.ready && (
                <div className="flex flex-col border-t border-border">
                  {STARTERS.map((starter) => (
                    <button key={starter.label} type="button" onClick={() => send({ text: starter.task, images: [], mentions: [] })} className="group flex h-10 items-center justify-between border-b border-border px-1 text-left text-sm text-text-muted transition-colors hover:text-text">
                      {starter.label}
                      <ArrowUp aria-hidden size={13} strokeWidth={1.75} className="rotate-45 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}
              {!status.ready && (
                <p className="text-sm text-text-muted">
                  It needs a model first.{' '}
                  <a href="sc://ai/" className="text-accent hover:text-accent-hover">
                    Open AI settings
                  </a>
                </p>
              )}
            </div>
          )}
          {blocks.map((item, i) => {
            switch (item.kind) {
              case 'task':
                return <TaskBubble key={i} item={item} canRewind={!!item.turnId && !working} onRewind={() => rewind(item.turnId!)} />
              case 'text':
                return (
                  <div key={i} className="text-sm select-text">
                    <ReplyMarkdown text={item.text} onOpenLink={(href) => void api().invoke('browser:open', href)} />
                  </div>
                )
              case 'tools':
                return <ToolGroup key={item.tools[0]!.id} tools={item.tools} onStop={stopTool} />
              case 'approval':
                return <ApprovalCard key={item.id} item={item} onAnswer={(choice) => answer(item.id, choice)} />
              case 'note':
                return item.network ? (
                  <AiNetworkHelp
                    key={i}
                    message={item.text}
                    loadHasVpn={loadHasVpn}
                    useVpn={() => api().invoke('vpn:use-default')}
                    onRetry={retry}
                    onOpenVpn={() => void api().invoke('browser:open', 'sc://vpn/')}
                  />
                ) : (
                  <div key={i} className={cx('flex items-center gap-2 text-xs', item.error ? 'text-danger' : 'text-text-faint')}>
                    {item.error && <CircleAlert aria-hidden size={13} strokeWidth={1.75} />}
                    {item.text}
                  </div>
                )
            }
          })}
          {streaming && (
            <div className="text-sm select-text">
              <ReplyMarkdown text={streaming} onOpenLink={(href) => void api().invoke('browser:open', href)} />
            </div>
          )}
          {working && step !== null && !waiting && !streaming && <Thinking label={retrySeconds !== null ? `Couldn’t reach the model. Trying again in ${retrySeconds} s` : step > 1 ? `Working · step ${step}` : 'Working'} />}
        </div>
      </div>

      <div className={cx('mx-auto w-full max-w-200 shrink-0 flex-col gap-1 px-6 pt-1 pb-3', screen === 'log' ? 'flex' : 'hidden')}>
        {(todo.length > 0 || changes.length > 0 || jobs.some((job) => job.running) || committing) && (
          <div className={cx('sc-scroll-quiet flex flex-col overflow-y-auto', committing ? 'max-h-[60vh]' : 'max-h-[40vh]')}>
            {/* While committing, the commit has the room to itself. */}
            {!committing && todo.length > 0 && <TodoList items={todo} />}
            {!committing && <JobsBar jobs={jobs} onStop={(id) => void api().invoke('coder:job-stop', session.current, id)} />}
            {committing ? (
              <CommitCard
                session={session.current}
                onCancel={() => setCommitting(false)}
                onDone={(said) => {
                  setCommitting(false)
                  setState((current) => ({ ...current, changes: [], items: [...current.items, { kind: 'note', text: said, error: false }] }))
                }}
              />
            ) : (
              changes.length > 0 && <ChangesBar files={changes} git={status.git || !!worktree} busy={working} onReview={() => setScreen('review')} onCommit={() => setCommitting(true)} />
            )}
          </div>
        )}
        <Composer
          enabled={!!status.folder}
          ready={status.ready}
          working={working}
          placeholder={status.folder ? (working ? 'Add something while it works' : mode === 'plan' ? 'What should it plan?' : 'Describe a change, or ask about the code') : 'Choose a project folder first'}
          mode={mode}
          onMode={chooseMode}
          commands={commands}
          defaultModel={status.model}
          model={model}
          effort={effort}
          onModel={(next, nextEffort) => {
            setModel(next)
            setEffort(nextEffort)
          }}
          modelMenuRequest={modelMenu}
          context={context}
          seed={seed}
          onSend={send}
          onStop={() => void api().invoke('coder:stop', session.current)}
        />
      </div>
    </div>
  )
}

const loadHasVpn = () => api().invoke('vpn:state').then((state) => state.connections.length > 0)
