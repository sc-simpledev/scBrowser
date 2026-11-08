import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  FileMinus,
  FilePen,
  FilePlus,
  FileSearch,
  FolderOpen,
  FolderTree,
  Globe,
  KeyRound,
  ListChecks,
  Move,
  Plus,
  Search,
  Settings,
  Square,
  SquareTerminal,
  Trash2,
  Undo2,
  X,
  type LucideIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { CODER_MAX_STEPS, type CoderAnswer, type CoderChange, type CoderEvent, type CoderMode, type CoderStatus, type CoderTodo, type CoderToolName } from '@scbrowser/shared'
import { api } from '../api'
import { ReplyMarkdown, Thinking } from '../../shared/ReplyContent'
import { AiNetworkHelp } from '../../shared/AiNetworkHelp'

type Item =
  | { kind: 'task'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; tool: CoderToolName; summary: string; ok: boolean | null; output: string }
  | { kind: 'approval'; id: string; type: 'change' | 'command'; summary: string; detail: string; answer: CoderAnswer | null }
  | { kind: 'note'; text: string; error: boolean; network?: boolean }

const TOOL_ICONS: Record<CoderToolName, LucideIcon> = {
  list: FolderTree,
  glob: FileSearch,
  read: FileSearch,
  search: Search,
  write: FilePen,
  edit: FilePen,
  delete: Trash2,
  move: Move,
  run: SquareTerminal,
  todo: ListChecks,
  web: Globe
}

const DONE_NOTES: Record<string, string | null> = { finished: null, stopped: 'Stopped.', 'step-limit': `Stopped after ${CODER_MAX_STEPS} steps. Send a message to carry on.` }

const MODES: { id: CoderMode; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan', hint: 'It looks around and writes a plan. Nothing changes.' },
  { id: 'ask', label: 'Ask', hint: 'It asks before every change and command.' },
  { id: 'edits', label: 'Auto-edit', hint: 'It changes files without asking, and asks before every command.' }
]

const STARTERS = [
  { label: 'Explain this project', task: 'Explain how this project is put together: what it does, the main parts and where they live, and how to run and test it.' },
  { label: 'Find and fix a bug', task: 'Run the project’s tests or checks, find what fails, and fix it.' },
  { label: 'Review my changes', task: 'Review my uncommitted changes (git diff) for bugs and anything I missed. Don’t change anything yet.' },
  { label: 'Add tests', task: 'Find an important part of this project with no tests, and add good tests for it in the project’s existing style.' }
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
function Detail({ text, diff }: { text: string; diff: boolean }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md border border-border bg-bg py-2 font-mono text-2xs leading-normal whitespace-pre select-text">
      {diff ? (
        text.split('\n').map((line, i) => (
          <div key={i} className={cx('w-max min-w-full px-2.5', line.startsWith('+ ') && 'bg-success/10 text-success', line.startsWith('- ') && 'bg-danger/10 text-danger', line.startsWith('@@') && 'text-text-faint')}>
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

function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICONS[item.tool]
  const [verb, target] = splitSummary(item.summary)
  return (
    <div className="flex flex-col gap-1">
      <button type="button" aria-expanded={open} disabled={!item.output} onClick={() => setOpen(!open)} className="group flex h-6.5 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-text-muted transition-colors enabled:hover:bg-surface-hover">
        <Icon aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
        <span className="shrink-0 text-text">{verb}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs">{target}</span>
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint opacity-0 transition group-hover:opacity-100', open && 'rotate-90 opacity-100')} />
        <ToolState ok={item.ok} />
      </button>
      {open && item.output && <Detail text={item.output} diff={false} />}
    </div>
  )
}

const TOOL_WORDS: Partial<Record<CoderToolName, [string, string]>> = {
  read: ['Read', 'file'],
  write: ['Wrote', 'file'],
  edit: ['Edited', 'file'],
  delete: ['Deleted', 'file'],
  move: ['Moved', 'file'],
  list: ['Listed', 'folder'],
  glob: ['Looked for', 'pattern'],
  search: ['Searched', 'time'],
  web: ['Searched the web', 'time'],
  run: ['Ran', 'command'],
  todo: ['Updated the plan', 'time']
}

/** "Read 3 files, ran 1 command": a run of steps in a few words. */
function describeTools(tools: ToolItem[]): string {
  const counts = new Map<CoderToolName, number>()
  for (const tool of tools) counts.set(tool.tool, (counts.get(tool.tool) ?? 0) + 1)
  const parts = [...counts].map(([tool, count]) => {
    const [verb, noun] = TOOL_WORDS[tool] ?? [tool, 'time']
    return tool === 'todo' ? verb : `${verb} ${count} ${noun}${count === 1 ? '' : 's'}`
  })
  const text = parts.join(', ')
  return parts.length > 1 ? text.replace(/(?<=, )[A-Z]/g, (letter) => letter.toLowerCase()) : text
}

/** Several steps in a row fold into one line, so the conversation stays readable. */
function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const running = tools.some((tool) => tool.ok === null)
  const failed = tools.filter((tool) => tool.ok === false).length
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? running
  if (tools.length === 1) return <ToolRow item={tools[0]!} />
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
            <ToolRow key={tool.id} item={tool} />
          ))}
        </div>
      )}
    </div>
  )
}

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
  return (
    <div role="group" aria-label={item.summary} className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface p-2.5">
      <div className="flex items-center gap-2 px-0.5 text-sm font-medium">
        {item.type === 'command' ? <SquareTerminal aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-accent" /> : <FilePen aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-accent" />}
        <span className="min-w-0 truncate">{item.summary}</span>
      </div>
      <Detail text={item.detail} diff={item.type === 'change'} />
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button variant="ghost" onClick={() => onAnswer('deny')}>
          Decline
        </Button>
        {item.type === 'command' && <Button onClick={() => onAnswer('always')}>Always allow this command</Button>}
        <Button variant="primary" onClick={() => onAnswer('allow')}>
          {item.type === 'command' ? 'Run' : 'Apply change'}
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

const STATUS_ICONS: Record<CoderChange['status'], LucideIcon> = { created: FilePlus, modified: FilePen, deleted: FileMinus }

/** Every file the session changed, each with its diff, and a way to put them all back. */
function ChangesPanel({ session, files, busy, onUndone }: { session: string; files: CoderChange[]; busy: boolean; onUndone: (count: number) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!open) return
    void api().invoke('coder:diff', session, open).then(setDiff)
  }, [open, session, files])
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  return (
    <section aria-label="Changed files" className="flex flex-col">
      <div className="flex h-7 items-center gap-2 text-xs">
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-surface-hover">
          <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform', expanded && 'rotate-90')} />
          <FilePen aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-muted" />
          <span className="font-medium">
            {files.length} {files.length === 1 ? 'file' : 'files'} changed
          </span>
          <span className="text-success">+{added}</span>
          <span className="text-danger">−{removed}</span>
        </button>
        {confirming ? (
          <>
            <span className="text-text-muted">Put every file back?</span>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false)
                void api().invoke('coder:undo', session).then(onUndone)
              }}
            >
              Undo all
            </Button>
          </>
        ) : (
          <Button variant="ghost" disabled={busy} title={busy ? 'Stop it first' : 'Puts every file Terra Code changed back as it was'} onClick={() => setConfirming(true)}>
            <Undo2 aria-hidden size={13} strokeWidth={1.75} />
            Undo changes
          </Button>
        )}
      </div>
      {expanded && <ul className="flex flex-col pb-1">
        {files.map((file) => {
          const Icon = STATUS_ICONS[file.status]
          return (
            <li key={file.path} className="flex flex-col gap-1">
              <button type="button" aria-expanded={open === file.path} onClick={() => setOpen(open === file.path ? null : file.path)} className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-surface-hover">
                <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform', open === file.path && 'rotate-90')} />
                <Icon aria-label={file.status} size={13} strokeWidth={1.75} className={cx('shrink-0', file.status === 'created' ? 'text-success' : file.status === 'deleted' ? 'text-danger' : 'text-text-muted')} />
                <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                <span className="shrink-0 text-success">+{file.added}</span>
                <span className="shrink-0 text-danger">−{file.removed}</span>
              </button>
              {open === file.path && diff && (
                <div className="[&>pre]:max-h-48">
                  <Detail text={diff} diff />
                </div>
              )}
            </li>
          )
        })}
      </ul>}
    </section>
  )
}

export interface CodeWorkspaceProps {
  /** Inside sc://assistant, which has its own heading and layout. */
  embedded?: boolean
  /** A task to start with as soon as everything is ready, such as one typed as /code in the assistant. */
  initialTask?: string | null
  onInitialTaskTaken?: () => void
  /** Drawn at the start of the embedded bar, such as the assistant's Chat and Code switch. */
  leading?: ReactNode
}

/** Terra Code (beta): a model works on files in one folder, and asks before changing anything. */
export function CodeWorkspace({ embedded = false, initialTask = null, onInitialTaskTaken, leading }: CodeWorkspaceProps) {
  const [status, setStatus] = useState<CoderStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [mode, setMode] = useState<CoderMode>('ask')
  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState('')
  const [working, setWorking] = useState(false)
  const [step, setStep] = useState<number | null>(null)
  const [streaming, setStreaming] = useState('')
  const [todo, setTodo] = useState<CoderTodo[]>([])
  const [changes, setChanges] = useState<CoderChange[]>([])
  const [hostedNoteClosed, setHostedNoteClosed] = useState(noteClosed)
  const session = useRef(crypto.randomUUID())
  const lastTask = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

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
  useEffect(() => {
    if (!embedded) document.title = 'Terra Code'
    refresh()
    void api().invoke('settings:get').then((settings) => setMode(settings.coderMode))
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, embedded])

  useEffect(
    () =>
      window.scbInternal.onCoderEvent((event: CoderEvent) => {
        if (event.sessionId !== session.current) return
        if (event.type === 'thinking') setStep(event.step)
        else if (event.type !== 'stream') setStep(null)
        if (event.type === 'stream') return setStreaming(event.text)
        if (event.type === 'text' || event.type === 'done' || event.type === 'error') setStreaming('')
        if (event.type === 'todo') return setTodo(event.items)
        if (event.type === 'changes') return setChanges(event.files)
        setItems((current) => {
          switch (event.type) {
            case 'text':
              return [...current, { kind: 'text', text: event.text }]
            case 'tool':
              return [...current, { kind: 'tool', id: event.id, tool: event.tool, summary: event.summary, ok: null, output: '' }]
            case 'tool-result':
              return current.map((item) => (item.kind === 'tool' && item.id === event.id ? { ...item, ok: event.ok, output: event.output } : item))
            case 'approval':
              return [...current, { kind: 'approval', id: event.id, type: event.kind, summary: event.summary, detail: event.detail, answer: null }]
            case 'done': {
              setWorking(false)
              const note = DONE_NOTES[event.reason]
              return note ? [...current, { kind: 'note', text: note, error: false }] : current
            }
            case 'error':
              setWorking(false)
              return [...current, { kind: 'note', text: event.message, error: true, network: event.network }]
            default:
              return current
          }
        })
      }),
    []
  )

  useEffect(() => {
    const log = logRef.current
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 200) log.scrollTop = log.scrollHeight
  }, [items, step, streaming, todo])

  const start = useCallback(
    (task: string, { show = true }: { show?: boolean } = {}) => {
      setWorking(true)
      setStep(1)
      lastTask.current = task
      if (show) setItems((current) => [...current, { kind: 'task', text: task }])
      void api()
        .invoke('coder:run', session.current, task)
        .catch((error: Error) => {
          setWorking(false)
          setStep(null)
          setItems((current) => [...current, { kind: 'note', text: cleanError(error.message), error: true }])
        })
    },
    []
  )

  const send = (text = draft) => {
    const task = text.trim()
    if (!task || working || !status?.folder || !status.ready) return
    setDraft('')
    start(task)
  }

  // A task handed over from the chat (/code …) starts once the folder and model are known to be ready.
  useEffect(() => {
    if (!initialTask || !status) return
    if (status.folder && status.ready && !working) {
      onInitialTaskTaken?.()
      start(initialTask)
    } else if (!status.folder || !status.ready) {
      onInitialTaskTaken?.()
      setDraft(initialTask)
    }
  }, [initialTask, status, working, start, onInitialTaskTaken])

  const retry = () => {
    if (!lastTask.current || working) return
    setItems((current) => current.filter((item, index) => !(index === current.length - 1 && item.kind === 'note')))
    start(lastTask.current, { show: false })
  }

  const answer = (id: string, choice: CoderAnswer) => {
    setItems((current) => current.map((item) => (item.kind === 'approval' && item.id === id ? { ...item, answer: choice } : item)))
    void api().invoke('coder:answer', id, choice)
  }

  const newSession = () => {
    void api().invoke('coder:reset', session.current)
    session.current = crypto.randomUUID()
    lastTask.current = null
    setItems([])
    setTodo([])
    setChanges([])
    setStreaming('')
    setWorking(false)
    setStep(null)
  }

  const pickFolder = () =>
    void api()
      .invoke('coder:pick-folder')
      .then((folder) => {
        if (!folder) return
        newSession()
        refresh()
      })

  const chooseMode = (coderMode: CoderMode) => {
    setMode(coderMode)
    void api().invoke('settings:set', { coderMode })
  }

  const blocks = useMemo(() => {
    const out: (Exclude<Item, ToolItem> | { kind: 'tools'; tools: ToolItem[] })[] = []
    for (const item of items) {
      const last = out.at(-1)
      // The card says what's being asked, and an allowed step carries on as its own row.
      if (item.kind === 'approval' && item.answer === 'allow') continue
      if (item.kind === 'approval' && item.answer === null && last?.kind === 'tools' && last.tools.at(-1)?.ok === null) {
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
  const modeInfo = MODES.find((candidate) => candidate.id === mode) ?? MODES[1]!

  const closeHostedNote = () => {
    setHostedNoteClosed(true)
    try {
      localStorage.setItem(HOSTED_NOTE_KEY, '1')
    } catch {
      // It just comes back next time.
    }
  }

  const controls = (
    <>
      <Button variant="ghost" onClick={pickFolder} title={status.folder ?? undefined} className="min-w-0">
        <FolderOpen aria-hidden size={13} strokeWidth={1.75} />
        <span className="max-w-60 truncate">{status.folder ? folderName(status.folder) : 'Choose a project folder'}</span>
      </Button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {status.folder && (
          <IconButton size="sm" label="Show the folder" onClick={() => void api().invoke('coder:open-folder')}>
            <FolderTree size={13} strokeWidth={1.75} />
          </IconButton>
        )}
        <IconButton size="sm" label="New session" onClick={newSession}>
          <Plus size={14} strokeWidth={1.75} />
        </IconButton>
        {!embedded && (
          <a href="sc://ai/" aria-label="AI settings" title="AI settings" className="grid size-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text">
            <Settings aria-hidden size={14} strokeWidth={1.75} />
          </a>
        )}
      </div>
    </>
  )

  return (
    <div className="flex h-full min-w-0 flex-col">
      {embedded ? (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          {leading}
          {controls}
        </div>
      ) : (
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <SquareTerminal aria-hidden size={15} strokeWidth={1.75} className="text-accent" />
          <h1 className="text-sm font-semibold">Terra Code</h1>
          <span className="rounded-sm border border-border px-1.5 text-2xs font-medium tracking-[0.04em] text-text-muted uppercase">Beta</span>
          <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">{controls}</div>
        </header>
      )}

      <div ref={logRef} role="log" aria-label="Terra Code" className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto">
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
                  {status.folder ? 'Terra Code reads your files, edits them and runs commands such as tests.' : 'Terra Code can only reach files inside the folder you choose, and asks before running anything.'}
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
                    <button key={starter.label} type="button" onClick={() => send(starter.task)} className="group flex h-10 items-center justify-between border-b border-border px-1 text-left text-sm text-text-muted transition-colors hover:text-text">
                      {starter.label}
                      <ArrowUp aria-hidden size={13} strokeWidth={1.75} className="rotate-45 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}
              {!status.ready && <p className="text-sm text-danger">Choose a model in AI settings first.</p>}
            </div>
          )}
          {blocks.map((item, i) => {
            switch (item.kind) {
              case 'task':
                return (
                  <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-surface-hover px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] select-text">
                    {item.text}
                  </div>
                )
              case 'text':
                return (
                  <div key={i} className="text-sm select-text">
                    <ReplyMarkdown text={item.text} onOpenLink={(href) => void api().invoke('browser:open', href)} />
                  </div>
                )
              case 'tools':
                return <ToolGroup key={item.tools[0]!.id} tools={item.tools} />
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
          {working && step !== null && !waiting && !streaming && <Thinking label={step > 1 ? `Working · step ${step}` : 'Working'} />}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-200 shrink-0 flex-col gap-1 px-6 pt-1 pb-3">
        {(todo.length > 0 || changes.length > 0) && (
          <div className="sc-scroll-quiet flex max-h-[34vh] flex-col overflow-y-auto">
            {todo.length > 0 && <TodoList items={todo} />}
            {changes.length > 0 && (
              <ChangesPanel
                session={session.current}
                files={changes}
                busy={working}
                onUndone={(count) => {
                  setChanges([])
                  setItems((current) => [...current, { kind: 'note', text: `Put ${count} ${count === 1 ? 'file' : 'files'} back as they were.`, error: false }])
                }}
              />
            )}
          </div>
        )}
        <div className="flex flex-col rounded-lg border border-border bg-field focus-within:border-border-strong">
          <textarea
            aria-label="Describe a change"
            value={draft}
            disabled={!status.folder}
            placeholder={status.folder ? (working ? 'It is working. Stop it to change course.' : mode === 'plan' ? 'What should it plan?' : 'Describe a change, or ask about the code') : 'Choose a project folder first'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            className="max-h-48 min-h-11 resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-text outline-none [field-sizing:content] placeholder:text-text-faint"
          />
          <div className="flex items-center gap-2 p-1.5">
            <div role="radiogroup" aria-label="Changes" className="flex shrink-0 items-center rounded-md bg-surface-hover p-0.5">
              {MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.id}
                  title={option.hint}
                  onClick={() => chooseMode(option.id)}
                  className={cx('h-5.5 rounded-sm px-2 text-2xs font-medium transition-colors', mode === option.id ? 'bg-surface text-text shadow-(--sc-shadow-1)' : 'text-text-muted hover:text-text')}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span title={`${modeInfo.hint} Commands you allow run with your own permissions.`} className="min-w-0 flex-1 truncate text-right text-2xs text-text-faint">
              {status.model ?? ''}
            </span>
            {working ? (
              <IconButton size="sm" label="Stop" onClick={() => void api().invoke('coder:stop', session.current)}>
                <Square size={12} strokeWidth={2} />
              </IconButton>
            ) : (
              <IconButton size="sm" label="Send" disabled={!draft.trim() || !status.folder || !status.ready} className={draft.trim() ? 'bg-text! text-surface! hover:opacity-85' : ''} onClick={() => send()}>
                <ArrowUp size={14} strokeWidth={2} />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const loadHasVpn = () => api().invoke('vpn:state').then((state) => state.connections.length > 0)
