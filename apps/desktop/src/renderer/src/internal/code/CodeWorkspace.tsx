import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Braces,
  FlaskConical,
  PackageOpen,
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
  GitPullRequest,
  Globe,
  KeyRound,
  ListChecks,
  Monitor,
  MoreHorizontal,
  Move,
  PanelRight,
  Plug,
  MessageCircleQuestion,
  MessageSquare,
  Plus,
  Search,
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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, cx, IconButton, Input } from '@scbrowser/ui'
import {
  CODE_CHAT_PREFIX,
  CODER_BUILTIN_COMMANDS,
  CODER_EFFORTS,
  CODER_INIT_TASK,
  isCoderEffort,
  reviewTask,
  reviewPrTask,
  fixCiTask,
  type CoderAgentRun,
  type CoderAnswer,
  type CoderChange,
  type CoderCloudRun,
  type CoderDecision,
  type CoderEffort,
  type CoderEvent,
  type CoderExtension,
  type CoderHunk,
  type CoderJob,
  type CoderMode,
  type CoderQuestionAnswer,
  type CoderReview,
  type CoderRunMode,
  type CoderStatus,
  type CoderTodo,
  type Settings,
  type CoderToolName,
  type CoderWorktree
} from '@scbrowser/shared'
import { api } from '../api'
import { ReplyMarkdown, Thinking } from '../../shared/ReplyContent'
import { AiNetworkHelp } from '../../shared/AiNetworkHelp'
import { applyEvent, emptyState, savedItems, sessionMarkdown, shortDuration, type CodeState, type Item } from './codeState'
import { AgentCard, Checklist, CopyButton, ReasoningBlock, useElapsed } from './CodeParts'
import { Composer, effortLabel, type ModelPick, type SendPayload } from './Composer'
import { SessionPanel, type CodeWhere, type PanelTab } from './SessionPanel'
import { CloudCard } from './CloudCard'
import { CloneCard, CloneIcon, SetupCard } from './ProjectStart'
import { GithubStartLine } from './GithubSettings'
import { QuestionCard } from '../../shared/QuestionCard'

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
  hook: Webhook,
  ask: MessageCircleQuestion,
  github: GitPullRequest,
  lsp: Braces
}

/** Starting points, each a task with a brief good enough to do well without more said. */
const STARTERS: { label: string; task: string; icon: LucideIcon }[] = [
  { label: 'Explain this project', icon: Compass, task: 'Explain how this project is put together: what it does, the main parts and where they live, and how to run and test it.' },
  { label: 'Find and fix a bug', icon: Stethoscope, task: 'Run the project’s tests or checks, find what fails, and fix it.' },
  { label: 'Add tests', icon: FlaskConical, task: 'Find the most important code that has no tests, and add focused tests for it in the style the project already uses. Run them, and fix anything they show up, telling me if a fix changes behaviour.' },
  { label: 'Review my changes', icon: GitCommitHorizontal, task: '/review' },
  { label: 'Upgrade dependencies', icon: PackageOpen, task: 'Look at the project’s dependencies and upgrade the outdated ones that are safe to move (patch and minor versions first). Read the changelogs of any major ones and tell me before taking them. Run the build and tests after, and fix what breaks.' },
  { label: 'Write the docs', icon: BookOpen, task: 'Bring the README up to date with how the project really works now: what it is, how to install, run, test and build it, and how it’s laid out. Keep it short and accurate, and check every command you write.' }
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

/** Undoing one step at a time, reached from each step's row. */
const StepActions = createContext<{ undo: (id: string, redo: boolean) => void; busy: boolean } | null>(null)

/** Undo, or Redo once undone, shown on a step that changed files while nothing is working. */
function UndoStep({ item }: { item: ToolItem }) {
  const actions = useContext(StepActions)
  if (!actions || !item.undoable || item.ok !== true || actions.busy) return null
  return item.undone ? (
    <Button variant="ghost" className="h-6 px-1.5 text-2xs" onClick={() => actions.undo(item.id, true)}>
      Redo
    </Button>
  ) : (
    <IconButton size="sm" label="Undo this step" className="opacity-0 group-hover/tool:opacity-100 focus-visible:opacity-100" onClick={() => actions.undo(item.id, false)}>
      <Undo2 size={12} strokeWidth={1.75} />
    </IconButton>
  )
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
        <button type="button" aria-expanded={open} disabled={!item.output} onClick={() => setOpen(!open)} className="group flex h-6.5 max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-text-muted transition-colors enabled:hover:bg-surface-hover">
          <Icon aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
          <span className={cx('shrink-0 text-text', item.undone && 'text-text-faint line-through')}>{verb}</span>
          <span className={cx('min-w-0 truncate font-mono text-2xs', item.undone && 'line-through')}>{target}</span>
          {item.undone && <span className="shrink-0 text-2xs text-text-faint">Undone</span>}
          <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint opacity-0 transition group-hover:opacity-100', open && 'rotate-90 opacity-100')} />
          {!item.undone && <ToolState ok={item.ok} />}
        </button>
        <UndoStep item={item} />
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
  hook: ['Ran', 'hook'],
  ask: ['Asked you', 'time'],
  github: ['Looked at GitHub', 'time'],
  lsp: ['Asked the language server', 'time']
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

interface Helpers {
  runs: Map<string, CoderAgentRun>
  /** Each helper's own steps, by its run id. */
  steps: Map<string, ToolItem[]>
}

/** A step that sent a helper off shows as the helper's card, with its own steps inside. */
function StepRow({ item, onStop, helpers }: { item: ToolItem; onStop: (id: string) => void; helpers: Helpers }) {
  const run = helpers.runs.get(item.id)
  if (!run) return <ToolRow item={item} onStop={onStop} />
  const steps = helpers.steps.get(item.id) ?? []
  return (
    <AgentCard run={run}>
      {steps.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {steps.map((step) => (
            <ToolRow key={step.id} item={step} onStop={onStop} />
          ))}
        </div>
      )}
    </AgentCard>
  )
}

/** Several steps in a row fold into one line, so the conversation stays readable. Helpers stay in view. */
function ToolGroup({ tools, onStop, helpers }: { tools: ToolItem[]; onStop: (id: string) => void; helpers: Helpers }) {
  const running = tools.some((tool) => tool.ok === null)
  const failed = tools.filter((tool) => tool.ok === false).length
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? running
  const sent = tools.filter((tool) => helpers.runs.has(tool.id))
  // Helpers sent off together read best as their cards side by side in the flow, not folded away.
  if (sent.length > 0 && sent.length === tools.length)
    return (
      <div className="flex flex-col gap-1.5">
        {tools.map((tool) => (
          <StepRow key={tool.id} item={tool} onStop={onStop} helpers={helpers} />
        ))}
      </div>
    )
  if (tools.length === 1) return <StepRow item={tools[0]!} onStop={onStop} helpers={helpers} />
  return (
    <div className="flex flex-col gap-0.5">
      <button type="button" aria-expanded={open} onClick={() => setChosen(!open)} className="flex h-6.5 max-w-full min-w-0 items-center gap-2 self-start rounded-md px-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover">
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 truncate">{describeTools(tools)}</span>
        {failed > 0 && <span className="shrink-0 text-danger">{failed} failed</span>}
        {running && <ToolState ok={null} />}
      </button>
      {open && (
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
          {tools.map((tool) => (
            <StepRow key={tool.id} item={tool} onStop={onStop} helpers={helpers} />
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
  const submit = (force = false) => {
    setBusy(true)
    setError(null)
    void api()
      .invoke('coder:commit', session, message, onBranch ? branch : null, all, force)
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
        {error?.startsWith('Possible secret') && (
          <Button disabled={busy} onClick={() => submit(true)}>
            Commit anyway
          </Button>
        )}
        <Button variant="primary" disabled={busy || !message.trim() || (onBranch && !branch.trim())} onClick={() => submit()}>
          Commit
        </Button>
      </div>
    </section>
  )
}

/** A note on one line of a change, sent to Terra Code with the others in one go. */
export interface ReviewComment {
  id: string
  path: string
  line: number
  /** Said about a line the change took out, rather than one it has now. */
  removed: boolean
  code: string
  text: string
}

/** The comments as one message for Terra Code. */
export function commentsTask(comments: ReviewComment[]): string {
  const lines = comments.map((comment) => `- ${comment.path}, ${comment.removed ? 'removed line near' : 'line'} ${comment.line}: ${comment.text.trim()}\n  > ${comment.code.trim().slice(0, 200)}`)
  return `I reviewed your changes and left ${comments.length === 1 ? 'a comment' : `${comments.length} comments`}. Deal with ${comments.length === 1 ? 'it' : 'each'}, then tell me what you changed:\n\n${lines.join('\n')}`
}

/**
 * A change's lines, numbered as in the file now, each with a way to comment on it: a + beside the
 * line on hover, opening a box underneath. Comments made show under their line.
 */
function DiffRows({ rows, startLine, path, comments, onComment, onRemove }: { rows: string[]; startLine: number; path: string; comments: ReviewComment[]; onComment: (comment: ReviewComment) => void; onRemove: (id: string) => void }) {
  const [writing, setWriting] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  let line = startLine
  const numbered = rows.map((row) => {
    const removed = row.startsWith('- ')
    const at = line
    if (!removed && !row.startsWith('@@')) line++
    return { row, line: at, removed }
  })
  return (
    <div className="sc-scroll-quiet overflow-x-auto bg-bg py-1 font-mono text-2xs leading-normal select-text">
      {numbered.map(({ row, line: at, removed }, i) => {
        const here = comments.filter((comment) => comment.path === path && comment.line === at && comment.removed === removed && comment.code === row.slice(2))
        return (
          <div key={i}>
            <div className={cx('group/line relative flex w-max min-w-full', row.startsWith('+ ') && 'bg-success/10 text-success', removed && 'bg-danger/10 text-danger', row.startsWith('  ') && 'text-text-muted')}>
              <span aria-hidden className="w-10 shrink-0 pr-2 text-right text-text-faint select-none">{removed ? '' : at}</span>
              <span className="pr-2.5 whitespace-pre">{row || ' '}</span>
              <button
                type="button"
                aria-label={`Comment on line ${at}`}
                onClick={() => {
                  setWriting(i)
                  setDraft('')
                }}
                className="absolute top-0 left-0.5 grid size-4 place-items-center rounded-sm bg-accent text-surface opacity-0 transition-opacity group-hover/line:opacity-100 focus-visible:opacity-100"
              >
                <Plus size={10} strokeWidth={2.5} />
              </button>
            </div>
            {here.map((comment) => (
              <div key={comment.id} className="mx-2 my-1 flex max-w-160 items-start gap-2 rounded-md border border-border bg-surface px-2 py-1.5 font-sans text-xs text-text">
                <MessageSquare aria-hidden size={12} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{comment.text}</span>
                <IconButton size="sm" label="Remove comment" className="size-5!" onClick={() => onRemove(comment.id)}>
                  <X size={11} strokeWidth={1.75} />
                </IconButton>
              </div>
            ))}
            {writing === i && (
              <form
                className="mx-2 my-1 flex max-w-160 flex-col gap-1.5 rounded-md border border-border-strong bg-surface p-2 font-sans"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!draft.trim()) return
                  onComment({ id: crypto.randomUUID(), path, line: at, removed, code: row.slice(2), text: draft.trim() })
                  setWriting(null)
                }}
              >
                <textarea
                  aria-label={`Comment on line ${at}`}
                  autoFocus
                  value={draft}
                  rows={2}
                  placeholder="What should change here?"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setWriting(null)
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
                  }}
                  className="resize-none rounded-md border border-border bg-field px-2 py-1.5 text-xs outline-none placeholder:text-text-faint focus:border-border-strong"
                />
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => setWriting(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={!draft.trim()}>
                    Add comment
                  </Button>
                </div>
              </form>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HunkView({ hunk, busy, onDecide, children }: { hunk: CoderHunk; busy: boolean; onDecide: (decision: CoderDecision) => void; children: ReactNode }) {
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
      {children}
    </div>
  )
}

/** Every file the session changed, one at a time, with each change to keep or put back. */
function ReviewScreen({ session, files, busy, focus, onChange, onClose, onSendComments }: { session: string; files: CoderChange[]; busy: boolean; focus: string | null; onChange: (files: CoderChange[], note?: string) => void; onClose: () => void; onSendComments: (text: string) => void }) {
  const [chosen, setChosen] = useState<string | null>(focus)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const addComment = (comment: ReviewComment) => setComments((current) => [...current, comment])
  const removeComment = (id: string) => setComments((current) => current.filter((comment) => comment.id !== id))
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
                  {comments.some((comment) => comment.path === file.path) && (
                    <span className="flex shrink-0 items-center gap-0.5 text-2xs text-accent tabular-nums">
                      <MessageSquare aria-hidden size={10} strokeWidth={2} />
                      {comments.filter((comment) => comment.path === file.path).length}
                    </span>
                  )}
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
          {review?.hunks.map((hunk) => {
            const rows = <DiffRows rows={hunk.rows} startLine={hunk.line} path={review.path} comments={comments} onComment={addComment} onRemove={removeComment} />
            return review.whole ? (
              <div key={hunk.id} className="overflow-hidden rounded-md border border-border">
                {rows}
              </div>
            ) : (
              <HunkView key={hunk.id} hunk={hunk} busy={busy} onDecide={(decision) => decide(hunk.id, decision)}>
                {rows}
              </HunkView>
            )
          })}
          {!busy && review && !review.binary && comments.length === 0 && <p className="text-2xs text-text-faint">Hover a line and press + to leave Terra Code a comment on it.</p>}
        </div>
        {comments.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2">
            <MessageSquare aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 text-xs">
              {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
              {new Set(comments.map((comment) => comment.path)).size > 1 && <span className="text-text-muted"> in {new Set(comments.map((comment) => comment.path)).size} files</span>}
            </span>
            <Button variant="ghost" onClick={() => setComments([])}>
              Clear
            </Button>
            <Button variant="primary" onClick={() => onSendComments(commentsTask(comments))}>
              Send to Terra Code
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** A finished plan, to start as it is or after changing it, asking first or not. */
function PlanCard({ plan, onStart }: { plan: string; onStart: (mode: 'ask' | 'edits', text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(plan)
  useEffect(() => setText(plan), [plan])
  return (
    <section aria-label="Plan ready" className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface p-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-1">
        <ListChecks aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
        <span className="text-sm font-medium">Plan ready</span>
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{editing ? 'Change it, then start' : 'Start it, or change it first'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {!editing && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit plan
            </Button>
          )}
          <Button disabled={!text.trim()} onClick={() => onStart('ask', text)} title="Ask before each change and command">
            Start, asking first
          </Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => onStart('edits', text)} title="Make changes without asking; commands still ask">
            Start
          </Button>
        </div>
      </div>
      {editing && (
        <textarea
          aria-label="Plan"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.min(16, Math.max(5, text.split('\n').length + 1))}
          className="resize-y rounded-md border border-border bg-field px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-border-strong"
        />
      )}
    </section>
  )
}

/** What the person sent, with a way back to just before it. */
function TaskBubble({ item, canRewind, onRewind }: { item: Extract<Item, { kind: 'task' }>; canRewind: boolean; onRewind: (what: 'both' | 'code' | 'conversation') => void }) {
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
        <div role="group" aria-label="Rewind" className="flex flex-col items-end gap-1.5 rounded-lg border border-border bg-surface p-2 text-xs">
          <span className="text-text-muted">Go back to before this message:</span>
          <div className="flex flex-wrap justify-end gap-1">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            {(['conversation', 'code'] as const).map((what) => (
              <Button
                key={what}
                title={what === 'code' ? 'Put the files back, and keep the conversation' : 'Go back in the conversation, and keep the files as they are'}
                onClick={() => {
                  setConfirming(false)
                  onRewind(what)
                }}
              >
                {what === 'code' ? 'Code only' : 'Conversation only'}
              </Button>
            ))}
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false)
                onRewind('both')
              }}
            >
              Both
            </Button>
          </div>
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
  where?: CodeWhere
  cloudPr?: boolean
  agents?: CoderAgentRun[]
  model?: ModelPick | null
  effort?: CoderEffort | null
}

const HELP = `Terra Code works on files in your project folder. It asks before changing anything or running commands, unless you let edits through (Auto-edit) or allow a command for this project.

- **/** shows commands: ${CODER_BUILTIN_COMMANDS.map((command) => `/${command.name}`).join(', ')}, and any in the project’s .terra/commands.
- **@** attaches a file from the project, or one of your open tabs.
- Paste or drop pictures into the box for models that can see them.
- **Shift+Tab** switches between Plan, Ask and Auto-edit. **Esc** stops it. **↑** brings back what you sent before.
- The brain button sets how hard the model thinks (**/effort high**). Its reasoning shows folded above each step, if you turn that on in settings.
- It can hand work to helpers: **explore** reads around, **general** takes on a piece of the change. Several run side by side, and the session panel lists them.
- The checklist is yours too: tick steps off, rename or remove them, or add your own (**/todo** adds one). Terra Code hears about it at its next step.
- It may ask you a question with choices when a decision is yours. Pick one, write your own, or let it decide.
- **Runs on** in the session panel sends tasks to the **cloud** (GitHub Actions) instead, so they carry on with this computer off and push to a branch of their own (**/cloud <task>** for one task).
- Connect **GitHub** in settings to let it read issues, pull requests and Actions runs, and with your yes, open them.
- Hover a message you sent to rewind the files and conversation to before it.
- Settings (the gear) has command permissions, MCP servers, agents, skills, hooks and the sandbox.`

/** Below this width the session panel floats over the conversation instead of sitting beside it. */
const PANEL_BESIDE_WIDTH = 980

/** Terra Code (beta): a model works on files in one folder, and asks before changing anything. */
export function CodeWorkspace({ chat = null, onChat, initialTask = null, onInitialTaskTaken, leading }: CodeWorkspaceProps) {
  const [status, setStatus] = useState<CoderStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [mode, setMode] = useState<CoderMode>('ask')
  const [state, setState] = useState<CodeState>(emptyState)
  const modeRef = useRef<CoderMode>('ask')
  const [screen, setScreen] = useState<'log' | 'review'>('log')
  /** Which side of the panel shows, and a setting to open in it, such as MCP servers for /mcp. */
  const [panelTab, setPanelTab] = useState<PanelTab>('session')
  /** The file the review opens on, such as one picked in the panel. */
  const [reviewFocus, setReviewFocus] = useState<string | null>(null)
  const openReview = (path: string | null) => {
    setReviewFocus(path)
    setScreen('review')
  }
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [hostedNoteClosed, setHostedNoteClosed] = useState(noteClosed)
  const [model, setModel] = useState<ModelPick | null>(null)
  const [effort, setEffort] = useState<CoderEffort | null>(null)
  /** Where this session's tasks run, and whether a cloud run opens a pull request. */
  const [where, setWhere] = useState<CodeWhere>('local')
  const [cloudPr, setCloudPr] = useState(true)
  const [commands, setCommands] = useState<CoderExtension[]>([])
  const [worktree, setWorktree] = useState<CoderWorktree | null>(null)
  const [seed, setSeed] = useState<{ text: string; at: number } | null>(null)
  const [modelMenu, setModelMenu] = useState(0)
  const [prefs, setPrefs] = useState<Settings | null>(null)
  /** Beside the conversation, remembered; floating over it on narrow screens, only when asked for. */
  const [panelOpen, setPanelOpen] = useState(false)
  const [floatOpen, setFloatOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [awayFromEnd, setAwayFromEnd] = useState(false)
  const sizeWatch = useRef<ResizeObserver | null>(null)
  // A callback, as the screen only draws once its status has loaded.
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    sizeWatch.current?.disconnect()
    sizeWatch.current = null
    if (!node) return
    sizeWatch.current = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? 0) < PANEL_BESIDE_WIDTH))
    sizeWatch.current.observe(node)
  }, [])
  const session = useRef(chat ?? `${CODE_CHAT_PREFIX}${crypto.randomUUID()}`)
  const onChatRef = useRef(onChat)
  onChatRef.current = onChat
  /** What to send again when Retry is pressed after a network failure. */
  const lastTask = useRef<{ text: string; options: { images: string[]; mentions: SendPayload['mentions']; runMode?: CoderRunMode } } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const { items, todo, changes, jobs, context, streaming, reasoning, step, working, retrySeconds, runStartedAt } = state
  const showReasoning = prefs?.coderShowReasoning ?? true
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
    void api()
      .invoke('settings:get')
      .then((settings) => {
        setPrefs(settings)
        setMode(settings.coderMode)
        setPanelOpen(settings.coderPanel)
        // A new session starts at the chosen level; a saved one brings its own.
        if (!chat) setEffort(settings.coderEffort)
      })
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      refresh()
      void api().invoke('settings:get').then(setPrefs)
    }
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
        next = { ...next, items: data.items, todo: data.todo, agents: data.agents ?? [] }
        setModel(data.model ?? null)
        setEffort(data.effort ?? null)
        setWhere(data.where ?? 'local')
        setCloudPr(data.cloudPr ?? true)
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
      const data: SavedData = { items: savedItems(items), todo, agents: state.agents, model, effort, where, cloudPr }
      void api().invoke('coder:save', id, first.shown ?? first.text, JSON.stringify(data)).then(() => onChatRef.current?.(id))
    }
    unsaved.current = save
    const timer = setTimeout(save, 400)
    return () => clearTimeout(timer)
  }, [items, todo, state.agents, model, effort, where, cloudPr])
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
  }, [items, step, streaming, reasoning, todo])

  // The panel sits beside the conversation when there's room, and floats over it when there isn't.
  const shown = narrow ? floatOpen : panelOpen
  const togglePanel = (open = !shown) => {
    // Floating, it's a quick look that covers the conversation, so it's never remembered.
    if (narrow) return setFloatOpen(open)
    setPanelOpen(open)
    void api().invoke('settings:set', { coderPanel: open })
  }

  const scrollToEnd = () => {
    const log = logRef.current
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
  }

  const start = useCallback(
    (task: string, { show = true, shown, images = [], mentions = [], runMode }: { show?: boolean; shown?: string; images?: string[]; mentions?: SendPayload['mentions']; runMode?: CoderRunMode } = {}) => {
      const turnId = crypto.randomUUID()
      lastTask.current = { text: task, options: { images, mentions, runMode } }
      setState((current) => ({
        ...current,
        working: true,
        step: 1,
        runStartedAt: Date.now(),
        items: show ? [...current.items, { kind: 'task', text: task, turnId, mode: runMode ?? modeRef.current, ...(shown ? { shown } : {}), ...(images.length ? { pictures: images.length } : {}) }] : current.items
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
    setWhere('local')
  }, [])

  /** The person's own change to the checklist: shown at once, and told to Terra Code. */
  const changeTodo = (next: CoderTodo[]) => {
    setState((current) => ({ ...current, todo: next }))
    void api()
      .invoke('coder:todo', session.current, next)
      .catch((error: Error) => note(cleanError(error.message), true))
  }

  /** The unfinished steps, handed to helpers that work at the same time where they can. */
  const parallel = () => {
    const open = todo.filter((item) => !item.done).map((item) => `- ${item.text}`)
    if (open.length < 2 || working) return
    start(
      `Work on these unfinished checklist steps side by side. Hand each step that doesn't depend on another to the general agent, all in one reply so they run at the same time. Give each a complete brief: what to change, which files are its own (no two helpers may edit the same file), and how to check it. Steps that depend on others wait until those are done. When they report back, check their changes fit together, run the project's checks, and update the checklist.\n\n${open.join('\n')}`,
      { shown: 'Work on the open steps side by side' }
    )
  }

  const answerQuestion = (id: string, answers: CoderQuestionAnswer[] | null) => {
    setState((current) => ({ ...current, items: current.items.map((item) => (item.kind === 'question' && item.id === id ? { ...item, answers } : item)) }))
    void api().invoke('coder:answer-question', id, answers)
  }

  const setCloud = (run: CoderCloudRun, events?: CoderEvent[] | null) =>
    setState((current) => ({ ...current, items: current.items.map((item) => (item.kind === 'cloud' && item.run.id === run.id ? { kind: 'cloud', run, ...(events !== undefined ? { events } : item.events !== undefined ? { events: item.events } : {}) } : item)) }))

  /** A task for GitHub Actions: it shows as a card that follows the run, rather than steps here. */
  const startCloud = (task: string, shown?: string) => {
    const placeholder: CoderCloudRun = { id: `pending-${crypto.randomUUID()}`, repo: '', base: status?.branch ?? '', trigger: '', branch: 'Setting up…', task, pr: cloudPr, state: 'starting', runId: null, runUrl: null, prUrl: null, summary: null, startedAt: Date.now(), endedAt: null, error: null, warning: null }
    setState((current) => ({ ...current, items: [...current.items, { kind: 'task', text: task, ...(shown ? { shown } : {}) }, { kind: 'cloud', run: placeholder }] }))
    void api()
      .invoke('coder:cloud-start', session.current, task, { pr: cloudPr, model: model && { providerId: model.providerId, model: model.model }, effort })
      .then(
        (run) => setState((current) => ({ ...current, items: current.items.map((item) => (item.kind === 'cloud' && item.run.id === placeholder.id ? { kind: 'cloud', run } : item)) })),
        (error: Error) => setState((current) => ({ ...current, items: current.items.map((item) => (item.kind === 'cloud' && item.run.id === placeholder.id ? { kind: 'cloud', run: { ...placeholder, state: 'failed', endedAt: Date.now(), branch: 'Not started', error: cleanError(error.message) } } : item)) }))
      )
  }

  const cloudAction = (run: CoderCloudRun, action: 'cancel' | 'pr' | 'fetch' | 'steps' | 'continue') => {
    const id = session.current
    if (action === 'continue') {
      void (async () => {
        try {
          const events = await api().invoke('coder:cloud-events', id, run.id).catch(() => [] as CoderEvent[])
          const fetched = await api().invoke('coder:cloud-fetch', id, run.id).then(() => true, () => false)
          const steps = events.flatMap((event) => (event.type === 'tool' ? [event.summary] : [])).slice(-60)
          await api().invoke(
            'coder:note',
            id,
            `Earlier, this task went to Terra Code in the cloud: “${run.task.slice(0, 500)}”. It worked from GitHub's copy of ${run.base} and pushed to the branch ${run.branch}${fetched ? `, which is now fetched here as origin/${run.branch} (switch with git switch ${run.branch} if the person wants to carry on there)` : ''}. What it said when it finished:\n${run.summary ?? '(nothing)'}${steps.length ? `\nIts steps: ${steps.join('; ')}.` : ''}`
          )
          setCloud(run, events)
          setWhere('local')
          note(`Carrying on here. Terra Code will know what the cloud run did${fetched ? `, and its branch is fetched as origin/${run.branch}` : ''}.`)
        } catch (error) {
          note(cleanError(error instanceof Error ? error.message : 'That didn’t work.'), true)
        }
      })()
      return
    }
    if (action === 'cancel') void api().invoke('coder:cloud-cancel', id, run.id).then((runs) => runs.forEach((one) => setCloud(one)), (error: Error) => note(cleanError(error.message), true))
    if (action === 'pr')
      void api()
        .invoke('coder:cloud-pr', id, run.id)
        .then(
          (url) => setCloud({ ...run, prUrl: url }),
          (error: Error) => note(cleanError(error.message), true)
        )
    if (action === 'fetch') void api().invoke('coder:cloud-fetch', id, run.id).then((said) => note(said), (error: Error) => note(cleanError(error.message), true))
    if (action === 'steps') void api().invoke('coder:cloud-events', id, run.id).then((events) => setCloud(run, events), () => setCloud(run, null))
  }

  // Unfinished cloud runs are looked at every 20 seconds while this is on screen, and on coming back to it.
  const unfinished = items.some((item) => item.kind === 'cloud' && !item.run.id.startsWith('pending-') && ['starting', 'queued', 'working'].includes(item.run.state))
  useEffect(() => {
    if (!unfinished) return
    const id = session.current
    const check = () => {
      if (document.visibilityState !== 'visible') return
      void api()
        .invoke('coder:cloud-runs', id, true)
        .then((runs) => {
          if (session.current === id) runs.forEach((run) => setCloud(run))
        })
        .catch(() => undefined)
    }
    check()
    const timer = setInterval(check, 20_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [unfinished, chat])

  const rewind = (turnId: string, what: 'both' | 'code' | 'conversation' = 'both') => {
    void api()
      .invoke('coder:rewind', session.current, turnId, what)
      .then(
        async ({ task, files }) => {
          const changed = await api().invoke('coder:changes', session.current)
          const filesBack = `${files} ${files === 1 ? 'file is' : 'files are'} back as ${files === 1 ? 'it was' : 'they were'}`
          setState((current) => {
            // Only the files went back: the conversation stays as it is, with a note.
            if (what === 'code') return { ...current, changes: changed, items: [...current.items.map((item) => (item.kind === 'tool' && item.undoable ? { ...item, undoable: false } : item)), { kind: 'note', text: files ? `Put the code back to before “${task.slice(0, 60)}”: ${filesBack}.` : 'The code was already as it was then.', error: false }] }
            const at = current.items.findIndex((item) => item.kind === 'task' && item.turnId === turnId)
            const kept = at === -1 ? current.items : current.items.slice(0, at)
            const said = what === 'conversation' ? 'Went back in the conversation. The files stay as they are.' : files ? `Rewound: ${filesBack}.` : 'Rewound the conversation.'
            return { ...current, items: [...kept, { kind: 'note', text: said, error: false }], changes: changed, todo: [] }
          })
          if (what !== 'code') setSeed({ text: task, at: Date.now() })
        },
        (error: Error) => note(cleanError(error.message), true)
      )
  }

  const undoStep = (toolId: string, redo: boolean) =>
    void api()
      .invoke('coder:undo-step', session.current, toolId, redo)
      .then(
        async ({ undone }) => {
          const changed = await api().invoke('coder:changes', session.current)
          setState((current) => ({ ...current, changes: changed, items: current.items.map((item) => (item.kind === 'tool' && item.id === toolId ? { ...item, undone } : item)) }))
        },
        (error: Error) => note(cleanError(error.message), true)
      )

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
    const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text)
    if (!match) return false
    const [, name, rest = ''] = match
    const args = rest.trim()
    switch (name) {
      case 'init':
        start(CODER_INIT_TASK, { shown: text })
        return true
      case 'review': {
        // A pull request by number is read on GitHub, and its findings can be posted back there.
        const pull = /^#?(\d+)$/.exec(args)
        if (pull) start(reviewPrTask(Number(pull[1])), { shown: text })
        else start(reviewTask(args || null), { shown: text, runMode: 'review' })
        return true
      }
      case 'fix-ci':
        start(fixCiTask(status?.branch ?? null), { shown: text })
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
      case 'effort': {
        const wanted = args.toLowerCase().replace(/[\s-]/g, '')
        const level = wanted === 'auto' ? null : CODER_EFFORTS.find((option) => option.id === wanted || option.label.toLowerCase().replace(/\s/g, '') === wanted)?.id
        if (!args) note(`Thinking: ${effortLabel(effort)}. Choose with /effort low, medium, high, xhigh, max or auto.`)
        else if (level === undefined) note(`There’s no ${args} level. Try low, medium, high, xhigh, max or auto.`, true)
        else {
          chooseEffort(level)
          note(`Thinking set to ${effortLabel(level)}.`)
        }
        return true
      }
      case 'agents':
      case 'stats':
        setPanelTab('session')
        togglePanel(true)
        return true
      case 'settings':
      case 'permissions':
      case 'mcp':
        openSettings(name === 'mcp' ? 'mcp' : name === 'permissions' ? 'mode' : null)
        return true
      case 'todo':
        if (!args) note('Write the step after /todo, such as /todo add tests for the parser.', true)
        else changeTodo([...todo, { text: args.slice(0, 300), done: false }])
        return true
      case 'cloud':
        if (!args) {
          setWhere('cloud')
          openSettings(null)
          setPanelTab('session')
          note('New tasks in this session run in the cloud. Switch back under Runs on, in the session panel.')
        } else if (working) note('Wait for Terra Code to finish here first.', true)
        else startCloud(args, text)
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
    if (where === 'cloud' && !working) {
      if (images.length) return note('Pictures can’t go to the cloud yet. Send this one on this computer.', true)
      return startCloud(task)
    }
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

  /** Settings live in the session panel, opened on their own tab. */
  function openSettings(focus: string | null = null) {
    setScreen('log')
    setPanelTab('settings')
    setSettingsFocus(focus)
    togglePanel(true)
  }

  const updatePrefs = (patch: Partial<Settings>) => {
    setPrefs((current) => current && { ...current, ...patch })
    void api().invoke('settings:set', patch)
  }

  modeRef.current = mode
  const chooseMode = (coderMode: CoderMode) => {
    setMode(coderMode)
    void api().invoke('settings:set', { coderMode })
  }

  /** For this session, and as where new ones start. */
  function chooseEffort(coderEffort: CoderEffort | null) {
    if (coderEffort !== null && !isCoderEffort(coderEffort)) return
    setEffort(coderEffort)
    setPrefs((current) => current && { ...current, coderEffort })
    void api().invoke('settings:set', { coderEffort })
  }

  const helpers = useMemo<Helpers>(() => {
    const runs = new Map(state.agents.map((run) => [run.id, run]))
    const steps = new Map<string, ToolItem[]>()
    for (const item of items) if (item.kind === 'tool' && item.agent) steps.set(item.agent, [...(steps.get(item.agent) ?? []), item])
    return { runs, steps }
  }, [items, state.agents])

  const history = useMemo(() => items.flatMap((item) => (item.kind === 'task' ? [item.shown ?? item.text] : [])).slice(-50), [items])

  // A plan made in plan mode, once it's finished: the last reply after the last message, if that was a plan.
  const plan = useMemo(() => {
    if (working) return null
    const at = items.findLastIndex((item) => item.kind === 'task')
    const task = items[at]
    if (!task || task.kind !== 'task' || task.mode !== 'plan') return null
    const reply = items.slice(at + 1).findLast((item) => item.kind === 'text')
    return reply && reply.kind === 'text' ? reply.text : null
  }, [items, working])
  const blocks = useMemo(() => {
    const out: (Exclude<Item, ToolItem> | { kind: 'tools'; tools: ToolItem[] })[] = []
    for (const item of items) {
      const last = out.at(-1)
      // The checklist has its own place, so its updates needn't fill the conversation too. Questions have their card.
      if (item.kind === 'tool' && (item.tool === 'todo' || item.tool === 'ask')) continue
      // A helper's own steps show inside its card.
      if (item.kind === 'tool' && item.agent) continue
      if (item.kind === 'reasoning' && !showReasoning) continue
      // The card says what's being asked, and an allowed step carries on as its own row.
      if (item.kind === 'approval' && (item.answer === 'allow' || item.answer === 'always')) continue
      // Waiting, the card stands for the step; declined, its "Declined" line does.
      const step = last?.kind === 'tools' ? last.tools.at(-1) : undefined
      // A helper waiting on its own step's approval keeps its card.
      const isHelper = !!step && (step.tool === 'agent' || step.tool === 'explore')
      if (item.kind === 'approval' && last?.kind === 'tools' && !isHelper && ((item.answer === null && step?.ok === null) || (item.answer === 'deny' && step?.ok !== true))) {
        last.tools.pop()
        if (last.tools.length === 0) out.pop()
      }
      // Helpers keep a block of their own, so their cards never fold away with other steps.
      const helperStep = (tool: ToolItem) => tool.tool === 'agent' || tool.tool === 'explore'
      if (item.kind !== 'tool') out.push(item)
      else if (last?.kind === 'tools' && helperStep(last.tools[0]!) === helperStep(item)) last.tools.push(item)
      else out.push({ kind: 'tools', tools: [item] })
    }
    return out
  }, [items, showReasoning])

  if (statusError) return <p className="p-6 text-sm text-danger">{statusError}</p>
  if (!status) return null
  const waiting = items.some((item) => (item.kind === 'approval' && item.answer === null) || (item.kind === 'question' && item.answers === undefined))
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

  const stepActions = { undo: undoStep, busy: working }
  const firstTask = items.find((item): item is Extract<Item, { kind: 'task' }> => item.kind === 'task')
  const title = firstTask ? (firstTask.shown ?? firstTask.text).split('\n')[0]! : null
  const compactNow = () => command('/compact')
  const panelBeside = panelOpen && !narrow && screen === 'log'
  const panelFloating = floatOpen && narrow && screen === 'log'
  const modelName = model?.model ?? status.model ?? 'No model'
  // The panel shows the checklist itself, so above the box it only shows while the panel is closed.
  const strip = !panelBeside && !panelFloating

  const controls = (
    <>
      <Button variant="ghost" onClick={pickFolder} title={status.folder ? `${status.folder}\nChoose another folder` : undefined} className="min-w-0 shrink! px-2">
        <FolderOpen aria-hidden size={13} strokeWidth={1.75} className="shrink-0" />
        <span className="max-w-48 truncate @max-[400px]:hidden">{status.folder ? folderName(status.folder) : 'Choose a project folder'}</span>
      </Button>
      {(worktree || status.branch) && !worktree && (
        <span title={`On branch ${status.branch}`} className="flex h-6 min-w-0 shrink items-center gap-1 rounded-md px-1.5 font-mono text-2xs text-text-faint @max-[640px]:hidden">
          <GitBranch aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{status.branch}</span>
        </span>
      )}
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
      {title && (
        <>
          <span aria-hidden className="h-4 w-px shrink-0 bg-border @max-[560px]:hidden" />
          <span title={title} className="min-w-0 flex-1 truncate px-1 text-xs text-text-muted @max-[560px]:hidden">
            {title}
          </span>
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton size="sm" label="New session" onClick={newSession}>
          <Plus size={14} strokeWidth={1.75} />
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
        <span aria-hidden className="mx-1 h-4 w-px bg-border @max-[400px]:hidden" />
        <IconButton size="sm" label={shown ? 'Hide the session panel' : 'Show the session panel'} aria-pressed={shown && screen === 'log'} disabled={screen !== 'log'} onClick={() => togglePanel()}>
          <PanelRight size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
    </>
  )

  const panel = (
    <SessionPanel
      status={status}
      worktree={worktree}
      mode={mode}
      onMode={chooseMode}
      model={model}
      onModel={setModel}
      modelName={modelName}
      providerName={model?.providerName ?? status.providerName}
      effort={effort}
      onEffort={chooseEffort}
      prefs={prefs}
      onPrefs={updatePrefs}
      state={state}
      tab={panelTab}
      onTab={(next) => {
        setPanelTab(next)
        setSettingsFocus(null)
      }}
      settingsFocus={settingsFocus}
      onSetupChanged={loadCommands}
      onClose={() => togglePanel(false)}
      onOpenFolder={() => void api().invoke('coder:open-folder')}
      onReview={(path) => openReview(path ?? null)}
      onCommit={() => setCommitting(true)}
      onCompact={compactNow}
      onStopJob={(id) => void api().invoke('coder:job-stop', session.current, id)}
      onTodo={changeTodo}
      onParallel={parallel}
      where={where}
      onWhere={setWhere}
      cloudPr={cloudPr}
      onCloudPr={setCloudPr}
      onOpenSettings={openSettings}
    />
  )

  return (
    <div ref={rootRef} className="flex h-full min-w-0 flex-col">
      <div className="@container flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-3">
        {leading}
        {controls}
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {screen === 'review' && (
            <ReviewScreen
              session={session.current}
              files={changes}
              busy={working}
              focus={reviewFocus}
              onClose={closeScreen}
              onSendComments={(text) => {
                setScreen('log')
                send({ text, images: [], mentions: [] })
              }}
              onChange={(files, said) => setState((current) => ({ ...current, changes: files, items: said ? [...current.items, { kind: 'note', text: said, error: false }] : current.items }))}
            />
          )}

          <div className="relative flex min-h-0 flex-1 flex-col" hidden={screen !== 'log'}>
            <div
              ref={logRef}
              role="log"
              aria-label="Terra Code"
              onScroll={(e) => {
                const log = e.currentTarget
                setAwayFromEnd(log.scrollHeight - log.scrollTop - log.clientHeight > 400)
              }}
              className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto"
            >
              <div className="mx-auto flex max-w-200 flex-col gap-3 px-6 py-6 max-[760px]:px-3">
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
                  <div className="flex flex-col gap-6 pt-[10vh]">
                    <div className="flex flex-col gap-1.5">
                      <h2 className="text-xl font-semibold tracking-[-0.02em]">{status.folder ? `What should we do in ${folderName(status.folder)}?` : 'Pick a project to work on'}</h2>
                      <p className="max-w-130 text-sm text-text-muted">
                        {status.folder ? 'Terra Code reads your files, edits them and runs commands such as tests. Type / for commands and @ to attach a file or tab.' : 'Terra Code can only reach files inside the folder you choose, and asks before running anything.'}
                      </p>
                    </div>
                    {!status.folder && (
                      <div className="flex flex-wrap gap-1.5">
                        <Button variant="primary" onClick={pickFolder}>
                          <FolderOpen aria-hidden size={13} strokeWidth={1.75} />
                          Choose a project folder
                        </Button>
                        <Button aria-expanded={cloning} onClick={() => setCloning(!cloning)}>
                          <CloneIcon aria-hidden size={13} strokeWidth={1.75} />
                          Clone from GitHub
                        </Button>
                      </div>
                    )}
                    {!status.folder && !cloning && (
                      <ul aria-label="Where’s your project?" className="flex max-w-130 flex-col gap-1.5 text-xs text-text-muted">
                        <li>
                          <span className="font-medium text-text">Already on this computer?</span> Choose its folder. If it came from GitHub, Terra Code finds the repository by itself, so there’s nothing to clone.
                        </li>
                        <li>
                          <span className="font-medium text-text">Only on GitHub?</span> Clone it: pick the repository and where the copy should go.
                        </li>
                        <li>
                          <span className="font-medium text-text">Not on GitHub yet?</span> Choose its folder, then Settings → GitHub can make a repository for it.
                        </li>
                      </ul>
                    )}
                    {!status.folder && cloning && (
                      <CloneCard
                        onClose={() => setCloning(false)}
                        onConnect={() => openSettings('github')}
                        onCloned={() => {
                          setCloning(false)
                          newSession()
                          refresh()
                          loadCommands()
                        }}
                      />
                    )}
                    {status.folder && <GithubStartLine folder={status.folder} onSetUp={() => openSettings('github')} />}
                    {status.folder && status.ready && <SetupCard folder={status.folder} onStart={(task, shown) => start(task, { shown })} />}
                    {status.folder && status.ready && (
                      <div className="grid grid-cols-2 gap-2 max-[640px]:grid-cols-1">
                        {STARTERS.map((starter) => (
                          <button key={starter.label} type="button" onClick={() => send({ text: starter.task, images: [], mentions: [] })} className="group flex h-11 min-w-0 items-center gap-2.5 rounded-lg border border-border px-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover">
                            <starter.icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint transition-colors group-hover:text-accent" />
                            <span className="min-w-0 flex-1 truncate text-sm">{starter.label}</span>
                            <ArrowUp aria-hidden size={13} strokeWidth={1.75} className="shrink-0 rotate-45 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
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
                <StepActions.Provider value={stepActions}>
                {blocks.map((item, i) => {
                  switch (item.kind) {
                    case 'task':
                      return <TaskBubble key={i} item={item} canRewind={!!item.turnId && !working} onRewind={(what) => rewind(item.turnId!, what)} />
                    case 'text':
                      return (
                        <div key={i} className="group/text relative text-sm select-text">
                          <ReplyMarkdown text={item.text} onOpenLink={(href) => void api().invoke('browser:open', href)} />
                          <div className="absolute -bottom-1 left-0 flex translate-y-full opacity-0 transition-opacity group-hover/text:opacity-100 focus-within:opacity-100">
                            <CopyButton text={item.text} label="Copy reply" />
                          </div>
                        </div>
                      )
                    case 'reasoning':
                      return <ReasoningBlock key={i} text={item.text} />
                    case 'tools':
                      return <ToolGroup key={item.tools[0]!.id} tools={item.tools} onStop={stopTool} helpers={helpers} />
                    case 'approval':
                      return <ApprovalCard key={item.id} item={item} onAnswer={(choice) => answer(item.id, choice)} />
                    case 'question':
                      return <QuestionCard key={item.id} questions={item.questions} answers={item.answers} asker="Terra Code is asking" skipLabel="Let it decide" onAnswer={(answers) => answerQuestion(item.id, answers)} />
                    case 'cloud':
                      return (
                        <CloudCard
                          key={item.run.id}
                          run={item.run}
                          events={item.events}
                          onOpen={(url) => void api().invoke('browser:open', url)}
                          onCancel={() => cloudAction(item.run, 'cancel')}
                          onPr={() => cloudAction(item.run, 'pr')}
                          onFetch={() => cloudAction(item.run, 'fetch')}
                          onSteps={() => cloudAction(item.run, 'steps')}
                          onContinue={() => cloudAction(item.run, 'continue')}
                        />
                      )
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
                </StepActions.Provider>
                {plan && (
                  <PlanCard
                    plan={plan}
                    onStart={(target, text) => {
                      chooseMode(target)
                      start(`Carry out this plan. Work through it step by step, and tell me if part of it turns out to be wrong.\n\n${text}`, { shown: target === 'edits' ? 'Carry out the plan' : 'Carry out the plan, asking before changes', runMode: target })
                    }}
                  />
                )}
                {showReasoning && reasoning && <ReasoningBlock text={reasoning} live={!streaming} />}
                {streaming && (
                  <div className="text-sm select-text">
                    <ReplyMarkdown text={streaming} onOpenLink={(href) => void api().invoke('browser:open', href)} />
                  </div>
                )}
                {working && step !== null && !waiting && !streaming && !(showReasoning && reasoning) && <WorkingLine since={runStartedAt} step={step} retrySeconds={retrySeconds} />}
              </div>
            </div>
            {awayFromEnd && (
              <button type="button" onClick={scrollToEnd} className="absolute bottom-3 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-2xs text-text-muted shadow-2 transition-colors hover:text-text">
                <ArrowDown aria-hidden size={12} strokeWidth={1.75} />
                Latest
              </button>
            )}
          </div>

          <div className={cx('mx-auto w-full max-w-200 shrink-0 flex-col gap-1.5 px-6 pt-1 pb-3 max-[760px]:px-3', screen === 'log' ? 'flex' : 'hidden')}>
            {committing ? (
              <div className="sc-scroll-quiet max-h-[60vh] overflow-y-auto">
                <CommitCard
                  session={session.current}
                  onCancel={() => setCommitting(false)}
                  onDone={(said) => {
                    setCommitting(false)
                    setState((current) => ({ ...current, changes: [], items: [...current.items, { kind: 'note', text: said, error: false }] }))
                  }}
                />
              </div>
            ) : (
              // The panel shows these itself; with it closed, they share one quiet card above the box.
              strip &&
              (todo.length > 0 || jobs.some((job) => job.running) || changes.length > 0) && (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                  {todo.length > 0 && <Checklist items={todo} working={working} bare onChange={changeTodo} onParallel={parallel} />}
                  {jobs.some((job) => job.running) && (
                    <div className="px-1">
                      <JobsBar jobs={jobs} onStop={(id) => void api().invoke('coder:job-stop', session.current, id)} />
                    </div>
                  )}
                  {changes.length > 0 && (
                    <div className="px-1">
                      <ChangesBar files={changes} git={status.git || !!worktree} busy={working} onReview={() => openReview(null)} onCommit={() => setCommitting(true)} />
                    </div>
                  )}
                </div>
              )
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
              onModel={setModel}
              onEffort={chooseEffort}
              history={history}
              modelMenuRequest={modelMenu}
              context={context}
              seed={seed}
              onSend={send}
              onStop={() => void api().invoke('coder:stop', session.current)}
            />
          </div>
        </div>

        {panelBeside && <div className="w-76 shrink-0 border-l border-border">{panel}</div>}
        {panelFloating && (
          <>
            <button type="button" aria-label="Hide the session panel" tabIndex={-1} onClick={() => togglePanel(false)} className="absolute inset-0 z-20 bg-bg/50" />
            <div className="absolute inset-y-0 right-0 z-30 w-80 max-w-[90%] border-l border-border shadow-3">{panel}</div>
          </>
        )}
      </div>
    </div>
  )
}


/** What it's doing while there's nothing else to show: the step it's on and for how long. */
function WorkingLine({ since, step, retrySeconds }: { since: number | null; step: number; retrySeconds: number | null }) {
  const elapsed = useElapsed(since)
  if (retrySeconds !== null) return <Thinking label={`Couldn’t reach the model. Trying again in ${retrySeconds} s`} />
  const parts = ['Working', ...(since !== null && elapsed >= 2000 ? [shortDuration(elapsed)] : []), ...(step > 1 ? [`step ${step}`] : [])]
  return <Thinking label={parts.join(' · ')} />
}

const loadHasVpn = () => api().invoke('vpn:state').then((state) => (state.installed ? state.connections.length > 0 : ('removed' as const)))
