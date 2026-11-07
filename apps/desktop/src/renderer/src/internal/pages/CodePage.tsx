import { ArrowUp, Check, ChevronRight, CircleAlert, FilePen, FileSearch, FolderOpen, FolderTree, KeyRound, Plus, Search, Settings, Square, SquareTerminal, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, cx, IconButton, Select } from '@scbrowser/ui'
import type { CoderAnswer, CoderEvent, CoderMode, CoderStatus, CoderToolName } from '@scbrowser/shared'
import { api } from '../api'
import { ReplyMarkdown, Thinking } from '../../shared/ReplyContent'

type Item =
  | { kind: 'task'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; tool: CoderToolName; summary: string; ok: boolean | null; output: string }
  | { kind: 'approval'; id: string; type: 'change' | 'command'; summary: string; detail: string; answer: CoderAnswer | null }
  | { kind: 'note'; text: string; error: boolean }

const TOOL_ICONS: Record<CoderToolName, LucideIcon> = { list: FolderTree, read: FileSearch, search: Search, write: FilePen, edit: FilePen, run: SquareTerminal }

const DONE_NOTES: Record<string, string | null> = { finished: null, stopped: 'Stopped.', 'step-limit': 'Stopped after 60 steps. Send a message to carry on.' }

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

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
        {item.ok === null ? <span role="status" aria-label="Running" className="size-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent" /> : item.ok ? <Check aria-label="Done" size={12} strokeWidth={2} className="shrink-0 text-success" /> : <X aria-label="Failed" size={12} strokeWidth={2} className="shrink-0 text-danger" />}
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

/** Agentic coding, in beta: a model works on files in one folder, and asks before changing anything. */
export function CodePage() {
  const [status, setStatus] = useState<CoderStatus | null>(null)
  const [mode, setMode] = useState<CoderMode>('ask')
  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState('')
  const [working, setWorking] = useState(false)
  const [thinking, setThinking] = useState(false)
  const session = useRef(crypto.randomUUID())
  const logRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => void api().invoke('coder:status').then(setStatus), [])
  useEffect(() => {
    document.title = 'Code'
    refresh()
    void api().invoke('settings:get').then((settings) => setMode(settings.coderMode))
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  useEffect(
    () =>
      window.scbInternal.onCoderEvent((event: CoderEvent) => {
        if (event.sessionId !== session.current) return
        setThinking(event.type === 'thinking')
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
              return [...current, { kind: 'note', text: event.message, error: true }]
            default:
              return current
          }
        })
      }),
    []
  )

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [items, thinking])

  const send = () => {
    const task = draft.trim()
    if (!task || working || !status?.folder || !status.ready) return
    setDraft('')
    setWorking(true)
    setThinking(true)
    setItems((current) => [...current, { kind: 'task', text: task }])
    void api()
      .invoke('coder:run', session.current, task)
      .catch((error: Error) => {
        setWorking(false)
        setThinking(false)
        setItems((current) => [...current, { kind: 'note', text: error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), error: true }])
      })
  }

  const answer = (id: string, choice: CoderAnswer) => {
    setItems((current) => current.map((item) => (item.kind === 'approval' && item.id === id ? { ...item, answer: choice } : item)))
    void api().invoke('coder:answer', id, choice)
  }

  const newSession = () => {
    void api().invoke('coder:reset', session.current)
    session.current = crypto.randomUUID()
    setItems([])
    setWorking(false)
    setThinking(false)
  }

  const pickFolder = () =>
    void api()
      .invoke('coder:pick-folder')
      .then((folder) => {
        if (!folder) return
        newSession()
        refresh()
      })

  if (!status) return null
  const waiting = items.some((item) => item.kind === 'approval' && item.answer === null)

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <SquareTerminal aria-hidden size={16} strokeWidth={1.75} className="text-accent" />
        <h1 className="font-semibold">Code</h1>
        <span className="rounded-sm border border-border px-1.5 text-2xs font-medium tracking-[0.04em] text-text-muted uppercase">Beta</span>
        <div className="ml-3 flex min-w-0 items-center gap-1">
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
          <Select
            aria-label="Changes"
            className="w-56"
            value={mode}
            onChange={(e) => {
              const coderMode = e.target.value as CoderMode
              setMode(coderMode)
              void api().invoke('settings:set', { coderMode })
            }}
          >
            <option value="ask">Ask before every change</option>
            <option value="edits">Change files without asking</option>
          </Select>
          <IconButton size="sm" label="New session" onClick={newSession}>
            <Plus size={14} strokeWidth={1.75} />
          </IconButton>
          <a href="sc://ai/" aria-label="AI settings" title="AI settings" className="grid size-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text">
            <Settings aria-hidden size={14} strokeWidth={1.75} />
          </a>
        </div>
      </header>

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto">
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
            <div className="flex flex-col gap-2 py-10 text-center">
              <div className="text-lg font-semibold tracking-[-0.02em]">What should we build?</div>
              <p className="mx-auto max-w-120 text-sm text-text-muted">
                {status.folder
                  ? `Describe a change and the AI works on ${folderName(status.folder)}: it reads your files, edits them and runs commands such as tests. ${mode === 'ask' ? 'It asks before every change and command.' : 'It changes files without asking, and asks before every command.'}`
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
                return (
                  <div key={i} className={cx('flex items-center gap-2 text-xs', item.error ? 'text-danger' : 'text-text-faint')}>
                    {item.error && <CircleAlert aria-hidden size={13} strokeWidth={1.75} />}
                    {item.text}
                  </div>
                )
            }
          })}
          {thinking && !waiting && <Thinking label="Working" />}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mx-auto flex max-w-200 items-end gap-2 rounded-lg border border-border bg-field p-1.5 focus-within:border-border-strong">
          <textarea
            aria-label="Describe a change"
            value={draft}
            disabled={!status.folder}
            placeholder={status.folder ? (working ? 'It is working. Stop it to change course.' : 'Describe a change, or ask about the code') : 'Choose a project folder first'}
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
            <IconButton size="sm" label="Send" disabled={!draft.trim() || !status.folder || !status.ready} className={draft.trim() ? 'bg-text! text-surface! hover:opacity-85' : ''} onClick={send}>
              <ArrowUp size={14} strokeWidth={2} />
            </IconButton>
          )}
        </div>
        <p className="mx-auto mt-1.5 max-w-200 text-center text-2xs text-text-faint">
          {status.model ? `${status.model} · ` : ''}Commands you allow run with your own permissions. Check changes before you rely on them.
        </p>
      </div>
    </div>
  )
}
