import { Activity, Bot, Brain, Compass, Cpu, FileMinus, FilePen, FilePlus, Folder, GitBranch, Layers, PanelRightClose, Shield, Square, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { CODER_EFFORTS, type CoderAgentRun, type CoderChange, type CoderEffort, type CoderMode, type CoderStatus, type CoderWorktree } from '@scbrowser/shared'
import { ChecklistItems, Spinner, useElapsed } from './CodeParts'
import { sessionStats, shortDuration, shortTokens, type CodeState } from './codeState'
import { MODES } from './Composer'

function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cx('flex flex-col gap-2 border-b border-border px-4 py-3.5 last:border-b-0', className)}>
      <div className="flex min-h-5 items-center gap-2">
        <h3 className="text-xs font-medium">{title}</h3>
        {aside && <span className="ml-auto flex items-center gap-1 text-2xs text-text-faint">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Row({ icon: Icon, label, value, title, onClick }: { icon: LucideIcon; label: ReactNode; value?: ReactNode; title?: string; onClick?: () => void }) {
  const body = (
    <>
      <Icon aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {value !== undefined && <span className="shrink-0 text-text-muted tabular-nums">{value}</span>}
    </>
  )
  const style = 'flex h-6.5 min-w-0 items-center gap-2 rounded-md px-1 -mx-1 text-xs'
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={cx(style, 'transition-colors hover:bg-surface-hover')}>
      {body}
    </button>
  ) : (
    <div title={title} className={style}>
      {body}
    </div>
  )
}

/** Two numbers side by side, as a small table cell. */
const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface-hover/60 px-2 py-1.5">
    <span className="text-2xs text-text-faint">{label}</span>
    <span className="truncate text-sm font-medium tabular-nums">{value}</span>
  </div>
)

const STATUS_ICONS: Record<CoderChange['status'], LucideIcon> = { created: FilePlus, modified: FilePen, deleted: FileMinus }

function AgentRow({ run }: { run: CoderAgentRun }) {
  const elapsed = useElapsed(run.startedAt, run.endedAt)
  const Icon = run.name === 'explore' ? Compass : Bot
  return (
    <li className="flex min-w-0 items-start gap-2 text-xs">
      <Icon aria-hidden size={13} strokeWidth={1.75} className={cx('mt-0.5 shrink-0', run.state === 'running' ? 'text-accent' : 'text-text-faint')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-medium capitalize">{run.name}</span>
          <span className="min-w-0 truncate text-text-muted">{run.task}</span>
        </span>
        <span className="truncate text-2xs text-text-faint tabular-nums">
          {run.state === 'running' ? (run.last ?? 'Starting') : run.state === 'done' ? 'Reported back' : 'Stopped'} · {run.steps} steps · {shortDuration(elapsed)}
        </span>
      </span>
      {run.state === 'running' && <Spinner className="mt-0.5" />}
    </li>
  )
}

export interface SessionPanelProps {
  status: CoderStatus
  worktree: CoderWorktree | null
  mode: CoderMode
  modelName: string
  providerName: string | null
  effort: CoderEffort | null
  showReasoning: boolean
  sandbox: string
  state: CodeState
  onClose: () => void
  onOpenFolder: () => void
  onReview: () => void
  onCommit: () => void
  onCompact: () => void
  onStopJob: (id: number) => void
  onSettings: () => void
}

/** Beside the conversation, as in Claude: where it's working, how full its memory is, and what it's doing. */
export function SessionPanel({ status, worktree, mode, modelName, providerName, effort, showReasoning, sandbox, state, onClose, onOpenFolder, onReview, onCommit, onCompact, onStopJob, onSettings }: SessionPanelProps) {
  const { context, todo, agents, jobs, changes, items, working, runStartedAt, lastRunMs } = state
  const [showAllAgents, setShowAllAgents] = useState(false)
  const runMs = useElapsed(runStartedAt)
  const stats = sessionStats(items)
  const share = context ? Math.min(1, context.used / Math.max(1, context.limit)) : 0
  const percent = Math.round(share * 100)
  const added = changes.reduce((sum, file) => sum + file.added, 0)
  const removed = changes.reduce((sum, file) => sum + file.removed, 0)
  const running = jobs.filter((job) => job.running)
  const effortLabel = effort ? (CODER_EFFORTS.find((option) => option.id === effort)?.label ?? effort) : 'Auto'
  const modeLabel = MODES.find((option) => option.id === mode)?.label ?? mode
  const folder = status.folder ? status.folder.split(/[\\/]/).filter(Boolean).at(-1) : null
  const shownAgents = showAllAgents ? agents : agents.slice(-5)
  return (
    <aside aria-label="Session" className="flex h-full w-full flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-4">
        <h2 className="text-xs font-medium">Session</h2>
        {working && (
          <span className="ml-1.5 flex items-center gap-1.5 text-2xs text-text-faint tabular-nums">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
            {shortDuration(runMs)}
          </span>
        )}
        <IconButton size="sm" label="Hide the session panel" className="ml-auto" onClick={onClose}>
          <PanelRightClose size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <Section title="Environment">
          <div className="flex flex-col">
            <Row icon={Folder} label={folder ?? 'No folder chosen'} title={status.folder ?? undefined} onClick={status.folder ? onOpenFolder : undefined} />
            {(worktree || status.branch) && <Row icon={GitBranch} label={<span className="font-mono text-2xs">{worktree?.branch ?? status.branch}</span>} value={worktree ? 'Separate copy' : undefined} />}
            <Row icon={Shield} label="Permissions" value={modeLabel} onClick={onSettings} />
            <Row icon={Layers} label="Sandbox" value={sandbox} onClick={onSettings} />
          </div>
        </Section>

        <Section title="Model">
          <div className="flex flex-col">
            <Row icon={Cpu} label={<span className="font-mono text-2xs">{modelName}</span>} value={providerName ?? undefined} />
            <Row icon={Brain} label="Thinking" value={showReasoning ? effortLabel : `${effortLabel}, hidden`} onClick={onSettings} />
          </div>
        </Section>

        <Section title="Context" aside={context ? `${shortTokens(context.used)} / ${shortTokens(context.limit)}` : undefined}>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium tabular-nums">{context ? `${percent}% used` : 'Nothing yet'}</span>
              {context && share >= 0.25 && (
                <button type="button" disabled={working} onClick={onCompact} className="text-2xs text-accent hover:text-accent-hover disabled:text-text-faint">
                  Compact now
                </button>
              )}
            </div>
            <div role="meter" aria-label="Memory used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
              <div className={cx('h-full rounded-full transition-[width]', share > 0.8 ? 'bg-danger' : 'bg-accent')} style={{ width: `${Math.max(share > 0 ? 2 : 0, percent)}%` }} />
            </div>
            <p className="text-2xs text-text-faint">{share > 0.8 ? 'Nearly full. Older steps get summarised soon.' : 'Older steps are summarised when it fills up.'}</p>
          </div>
          {context && (
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Tokens in" value={shortTokens(context.inputTokens)} />
              <Stat label="Tokens out" value={shortTokens(context.outputTokens)} />
            </div>
          )}
        </Section>

        {todo.length > 0 && (
          <Section title="Checklist" aside={`${todo.filter((item) => item.done).length} of ${todo.length}`}>
            <ChecklistItems items={todo} working={working} />
          </Section>
        )}

        {agents.length > 0 && (
          <Section
            title="Agents"
            aside={
              agents.length > 5 ? (
                <button type="button" onClick={() => setShowAllAgents(!showAllAgents)} className="hover:text-text">
                  {showAllAgents ? 'Latest' : `All ${agents.length}`}
                </button>
              ) : (
                `${agents.filter((run) => run.state === 'running').length} working`
              )
            }
          >
            <ul className="flex flex-col gap-2">
              {shownAgents.map((run) => (
                <AgentRow key={run.id} run={run} />
              ))}
            </ul>
          </Section>
        )}

        {running.length > 0 && (
          <Section title="Background" aside={`${running.length} running`}>
            <ul className="flex flex-col gap-1">
              {running.map((job) => (
                <li key={job.id} className="group flex h-6.5 min-w-0 items-center gap-2 text-xs">
                  <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-success" />
                  <code className="min-w-0 flex-1 truncate font-mono text-2xs">{job.command}</code>
                  <IconButton size="sm" label={`Stop ${job.command}`} onClick={() => onStopJob(job.id)}>
                    <Square size={10} strokeWidth={2} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section
          title="Changes"
          aside={
            changes.length > 0 && (
              <>
                <span className="text-success">+{added}</span>
                <span className="text-danger">−{removed}</span>
              </>
            )
          }
        >
          {changes.length === 0 ? (
            <p className="text-xs text-text-faint">No files changed yet.</p>
          ) : (
            <>
              <ul className="-mx-1 flex flex-col">
                {changes.slice(0, 12).map((file) => {
                  const Icon = STATUS_ICONS[file.status]
                  return (
                    <li key={file.path}>
                      <button type="button" onClick={onReview} title={file.path} className="flex h-6.5 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-xs transition-colors hover:bg-surface-hover">
                        <Icon aria-label={file.status} size={13} strokeWidth={1.75} className={cx('shrink-0', file.status === 'created' ? 'text-success' : file.status === 'deleted' ? 'text-danger' : 'text-text-faint')} />
                        <span dir="rtl" className="min-w-0 flex-1 truncate text-left font-mono text-2xs">
                          {file.path}
                        </span>
                        <span className="shrink-0 text-2xs tabular-nums">
                          <span className="text-success">+{file.added}</span> <span className="text-danger">−{file.removed}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {changes.length > 12 && <p className="text-2xs text-text-faint">And {changes.length - 12} more</p>}
              <div className="flex gap-1.5">
                <Button className="flex-1" onClick={onReview}>
                  Review
                </Button>
                {(status.git || worktree) && (
                  <Button className="flex-1" disabled={working} onClick={onCommit}>
                    Commit
                  </Button>
                )}
              </div>
            </>
          )}
        </Section>

        <Section title="Activity" aside={lastRunMs !== null && !working ? `Last run ${shortDuration(lastRunMs)}` : undefined}>
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="Messages" value={stats.messages} />
            <Stat label="Steps" value={stats.tools} />
            <Stat label="Commands" value={stats.commands} />
            <Stat label="Looked at" value={stats.reads} />
            <Stat label="Edits" value={stats.edits} />
            <Stat label="Failed" value={stats.failed} />
          </div>
          {stats.tools === 0 && (
            <p className="flex items-center gap-1.5 text-2xs text-text-faint">
              <Activity aria-hidden size={11} strokeWidth={1.75} />
              Counts fill in as Terra Code works.
            </p>
          )}
        </Section>
      </div>
    </aside>
  )
}
