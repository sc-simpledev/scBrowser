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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, cx, IconButton, Select } from '@scbrowser/ui'
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
  { id: 'plan', label: 'Plan only', hint: 'It looks around and writes a plan. Nothing changes.' },
  { id: 'ask', label: 'Ask before every change', hint: 'It asks before every change and command.' },
  { id: 'edits', label: 'Change files without asking', hint: 'It changes files without asking, and asks before every command.' }
]

const STARTERS = [
  { label: 'Explain this project', task: 'Explain how this project is put together: what it does, the main parts and where they live, and how to run and test it.' },
  { label: 'Find and fix a bug', task: 'Run the project’s tests or checks, find what fails, and fix it.' },
  { label: 'Review my changes', task: 'Review my uncommitted changes (git diff) for bugs and anything I missed. Don’t change anything yet.' },
  { label: 'Add tests', task: 'Find an important part of this project with no tests, and add good tests for it in the project’s existing style.' }
]

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Colours a diff's lines without parsing anything else out of it. */
function Detail({ text, diff }: { text: string; diff: boolean }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md border border-border bg-bg p-2.5 font-mono text-2xs leading-normal whitespace-pre select-text">
      {diff
        ? text.split('\n').map((line, i) => (
            <div key={i} className={cx(line.startsWith('+ ') && 'text-success', line.startsWith('- ') && 'text-danger', line.startsWith('@@') && 'text-text-faint')}>
              {line || ' '}
            </div>
          ))
        : text}
    </pre>
  )
}

function ToolRow({ item }: { item: Extract<Item, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICONS[item.tool]
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover">
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        <Icon aria-hidden size={13} strokeWidth={1.75} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono">{item.summary}</span>
        {item.ok === null ? (
          <span role="status" aria-label="Running" className="size-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
        ) : item.ok ? (
          <Check aria-label="Done" size={12} strokeWidth={2} className="shrink-0 text-success" />
        ) : (
          <X aria-label="Failed" size={12} strokeWidth={2} className="shrink-0 text-danger" />
        )}
      </button>
      {open && item.output && <Detail text={item.output} diff={false} />}
    </div>
  )
}

function ApprovalCard({ item, onAnswer }: { item: Extract<Item, { kind: 'approval' }>; onAnswer: (answer: CoderAnswer) => void }) {
  return (
    <div role="group" aria-label={item.summary} className="flex flex-col gap-2.5 rounded-lg border border-border-strong bg-surface p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {item.type === 'command' ? <SquareTerminal aria-hidden size={14} strokeWidth={1.75} className="text-accent" /> : <FilePen aria-hidden size={14} strokeWidth={1.75} className="text-accent" />}
        <span className="min-w-0 truncate">{item.summary}</span>
      </div>
      <Detail text={item.detail} diff={item.type === 'change'} />
      {item.answer === null ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button variant="ghost" onClick={() => onAnswer('deny')}>
            Decline
          </Button>
          {item.type === 'command' && <Button onClick={() => onAnswer('always')}>Always allow this command</Button>}
          <Button variant="primary" onClick={() => onAnswer('allow')}>
            {item.type === 'command' ? 'Run' : 'Apply change'}
          </Button>
        </div>
      ) : (
        <div className="text-right text-xs text-text-faint">{item.answer === 'deny' ? 'Declined' : 'Allowed'}</div>
      )}
    </div>
  )
}

function TodoList({ items }: { items: CoderTodo[] }) {
  const done = items.filter((item) => item.done).length
  return (
    <section aria-label="Plan" className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
        <ListChecks aria-hidden size={13} strokeWidth={1.75} className="text-accent" />
        Plan
        <span className="ml-auto font-normal text-text-faint">
          {done} of {items.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
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
    </section>
  )
}

const STATUS_ICONS: Record<CoderChange['status'], LucideIcon> = { created: FilePlus, modified: FilePen, deleted: FileMinus }

/** Every file the session changed, each with its diff, and a way to put them all back. */
function ChangesPanel({ session, files, busy, onUndone }: { session: string; files: CoderChange[]; busy: boolean; onUndone: (count: number) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!open) return
    void api().invoke('coder:diff', session, open).then(setDiff)
  }, [open, session, files])
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  return (
    <section aria-label="Changed files" className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-2">
      <div className="flex h-7 items-center gap-2 px-1 text-xs">
        <span className="font-medium">
          {files.length} {files.length === 1 ? 'file' : 'files'} changed
        </span>
        <span className="text-success">+{added}</span>
        <span className="text-danger">−{removed}</span>
        <span className="flex-1" />
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
      <ul className="flex flex-col">
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
      </ul>
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

  if (statusError) return <p className="p-6 text-sm text-danger">{statusError}</p>
  if (!status) return null
  const waiting = items.some((item) => item.kind === 'approval' && item.answer === null)
  const modeInfo = MODES.find((candidate) => candidate.id === mode) ?? MODES[1]!

  const controls = (
    <>
      <div className="flex min-w-0 items-center gap-1">
        <Button variant="ghost" onClick={pickFolder} title={status.folder ?? undefined}>
          <FolderOpen aria-hidden size={13} strokeWidth={1.75} />
          <span className="max-w-60 truncate">{status.folder ? folderName(status.folder) : 'Choose a project folder'}</span>
        </Button>
        {status.folder && (
          <IconButton size="sm" label="Show the folder" onClick={() => void api().invoke('coder:open-folder')}>
            <FolderTree size={13} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Select aria-label="Changes" className="w-56" value={mode} title={modeInfo.hint} onChange={(e) => chooseMode(e.target.value as CoderMode)}>
          {MODES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SquareTerminal aria-hidden size={16} strokeWidth={1.75} className="text-accent" />
          <h1 className="font-semibold">Terra Code</h1>
          <span className="rounded-sm border border-border px-1.5 text-2xs font-medium tracking-[0.04em] text-text-muted uppercase">Beta</span>
          <div className="ml-3 flex min-w-0 flex-1 items-center gap-2">{controls}</div>
        </header>
      )}

      <div ref={logRef} role="log" aria-label="Terra Code" className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-200 flex-col gap-3 px-6 py-6">
          {status.hosted && (
            <div role="note" className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-xs text-text-muted">
              <KeyRound aria-hidden size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-text">Best with your own API key</div>
                Coding takes many requests per task, which quickly reaches the free {status.providerName ?? 'scTerra AI'} limit. Add a Claude or OpenAI key in AI settings and choose a strong coding model.
              </div>
              <a href="sc://ai/" className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-surface-hover">
                AI settings
              </a>
            </div>
          )}
          {items.length === 0 && (
            <div className="flex flex-col gap-3 py-10 text-center">
              <div className="text-lg font-semibold tracking-[-0.02em]">What should we build?</div>
              <p className="mx-auto max-w-120 text-sm text-text-muted">
                {status.folder
                  ? `Describe a change and Terra Code works on ${folderName(status.folder)}: it reads your files, edits them and runs commands such as tests. ${modeInfo.hint}`
                  : 'Choose the project folder it may work in. It can only reach files inside that folder, and asks before running anything.'}
              </p>
              {!status.folder && (
                <div>
                  <Button variant="primary" onClick={pickFolder}>
                    <FolderOpen aria-hidden size={13} strokeWidth={1.75} />
                    Choose a project folder
                  </Button>
                </div>
              )}
              {status.folder && status.ready && (
                <div className="mx-auto flex max-w-140 flex-wrap justify-center gap-2 [&>button]:whitespace-nowrap">
                  {STARTERS.map((starter) => (
                    <Button key={starter.label} onClick={() => send(starter.task)}>
                      {starter.label}
                    </Button>
                  ))}
                </div>
              )}
              {!status.ready && <p className="text-sm text-danger">Choose a model in AI settings first.</p>}
            </div>
          )}
          {items.map((item, i) => {
            switch (item.kind) {
              case 'task':
                return (
                  <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-surface-hover px-3.5 py-2.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] select-text">
                    {item.text}
                  </div>
                )
              case 'text':
                return (
                  <div key={i} className="text-sm select-text">
                    <ReplyMarkdown text={item.text} onOpenLink={(href) => void api().invoke('browser:open', href)} />
                  </div>
                )
              case 'tool':
                return <ToolRow key={item.id} item={item} />
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

      <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
        {(todo.length > 0 || changes.length > 0) && (
          <div className="sc-scroll-quiet mx-auto flex max-h-[30vh] w-full max-w-200 flex-col gap-2 overflow-y-auto">
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
        <div className="mx-auto flex w-full max-w-200 items-end gap-2 rounded-lg border border-border bg-field p-1.5 focus-within:border-border-strong">
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
            className="max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text outline-none [field-sizing:content] placeholder:text-text-faint"
          />
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
        <p className="mx-auto max-w-200 text-center text-2xs text-text-faint">
          {status.model ? `${status.model} · ` : ''}Commands you allow run with your own permissions. Check changes before you rely on them.
        </p>
      </div>
    </div>
  )
}

const loadHasVpn = () => api().invoke('vpn:state').then((state) => state.connections.length > 0)
