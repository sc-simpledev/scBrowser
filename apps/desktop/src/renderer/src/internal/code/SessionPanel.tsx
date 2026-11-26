import { Bot, Brain, Cloud, Compass, Cpu, FileMinus, FilePen, FilePlus, Folder, GitBranch, Layers, Monitor, PanelRightClose, Server, Shield, Square, SquareArrowOutUpRight, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { CODER_EFFORTS, type CoderAgentRun, type CoderChange, type CoderEffort, type CoderMode, type CoderServerCheck, type CoderStatus, type CoderTodo, type CoderWorktree, type Settings } from '@scbrowser/shared'
import { Choices, EffortChoices, sandboxLabel, ModeChoices, ModelChoices, SandboxChoices, SettingRow, SettingsTab, SwitchRow } from './PanelSettings'
import { api } from '../api'
import { useGithubStatus } from './GithubSettings'
import type { ModelPick } from './Composer'
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

export type PanelTab = 'session' | 'settings'

/** Where a session's tasks run: here, on GitHub Actions, or on the person's own server over SSH. */
export type CodeWhere = 'local' | 'cloud' | 'server'

const WHERE_LABEL: Record<CodeWhere, string> = { local: 'This computer', cloud: 'GitHub Actions', server: 'Your server' }

/** The person's own server: its address, a check that scTerra can get in, and whether it pushes what it makes. */
function ServerSetup({ prefs, onPrefs, cloudPr, onCloudPr, hosted }: { prefs: Settings | null; onPrefs: (patch: Partial<Settings>) => void; cloudPr: boolean; onCloudPr: (pr: boolean) => void; hosted: boolean }) {
  const saved = prefs?.coderServer ?? ''
  const [host, setHost] = useState(saved)
  const [check, setCheck] = useState<CoderServerCheck | 'checking' | null>(null)
  useEffect(() => setHost(saved), [saved])
  const save = () => {
    const next = host.trim()
    if (next !== saved) {
      onPrefs({ coderServer: next })
      setCheck(null)
    }
  }
  const test = () => {
    save()
    setCheck('checking')
    void api()
      .invoke('coder:server-check', host.trim())
      .then(setCheck, (error: Error) => setCheck({ ok: false, message: error.message, node: null, git: null, system: null }))
  }
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <label className="flex flex-col gap-1 text-2xs text-text-muted">
        Server
        <span className="flex gap-1.5">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && test()}
            placeholder="user@host or a name from ~/.ssh/config"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 font-mono text-2xs text-text outline-none placeholder:font-sans placeholder:text-text-faint focus:border-accent"
          />
          <Button variant="ghost" className="h-7 px-2 text-xs" disabled={!host.trim() || check === 'checking'} onClick={test}>
            {check === 'checking' ? 'Checking…' : 'Check'}
          </Button>
        </span>
      </label>
      {check && check !== 'checking' && <p role="status" className={cx('text-2xs', check.ok ? 'text-success' : 'text-danger')}>{check.message}</p>}
      <SwitchRow label="Push its branch" hint="To this project’s remote, with the server’s own git sign-in" checked={prefs?.coderServerPush ?? false} onChange={(coderServerPush) => onPrefs({ coderServerPush })} />
      {prefs?.coderServerPush && <SwitchRow label="Open a pull request" hint="On GitHub, when it’s done, if anything changed" checked={cloudPr} onChange={onCloudPr} />}
      <p className="text-2xs text-text-faint">
        Needs SSH with a key, plus git and Node 20 or newer there. Your folder goes as it is, uncommitted changes too; the work comes back as a branch you fetch. Every step is allowed there, so use an account set aside for it. It uses this session’s model{hosted ? ' (scTerra AI, with its shared limits)' : ''}.
      </p>
    </div>
  )
}

/** Why the cloud can't be used yet, or null when it can. */
export function cloudBlocker(status: CoderStatus, github: ReturnType<typeof useGithubStatus>['status'], access: Settings['coderGithub'] | undefined): string | null {
  if (!status.git) return 'The project needs to be a git repository on GitHub.'
  if (!github) return 'Checking GitHub…'
  if (!github.source) return 'Connect GitHub first, in Settings, under Connections.'
  if (!github.repo) return 'This project’s git remote isn’t on GitHub. Push it there first.'
  if (access !== 'write') return 'Let Terra Code look and act on GitHub, in Settings, under Connections.'
  return null
}

export interface SessionPanelProps {
  status: CoderStatus
  worktree: CoderWorktree | null
  mode: CoderMode
  onMode: (mode: CoderMode) => void
  model: ModelPick | null
  onModel: (model: ModelPick | null) => void
  modelName: string
  providerName: string | null
  effort: CoderEffort | null
  onEffort: (effort: CoderEffort | null) => void
  prefs: Settings | null
  onPrefs: (patch: Partial<Settings>) => void
  state: CodeState
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  /** A setting to open when the Settings tab is asked for by name, such as /mcp. */
  settingsFocus: string | null
  onSetupChanged: () => void
  onClose: () => void
  onOpenFolder: () => void
  /** Opens the review, on one file if it's given. */
  onReview: (path?: string) => void
  onCommit: () => void
  onCompact: () => void
  onStopJob: (id: number) => void
  /** The person changed the checklist. */
  onTodo: (items: CoderTodo[]) => void
  /** Hands the open steps to helpers working side by side. */
  onParallel: () => void
  where: CodeWhere
  onWhere: (where: CodeWhere) => void
  /** Open a pull request when a cloud run is done. */
  cloudPr: boolean
  onCloudPr: (pr: boolean) => void
  /** The Settings tab, open at one setting. */
  onOpenSettings: (focus: string) => void
  /** Opens a changed file in the person's editor. */
  onOpenFile: (path: string) => void
}

/** Beside the conversation, as in Claude: where it's working, how full its memory is, and what it's doing. */
export function SessionPanel(props: SessionPanelProps) {
  const { status, worktree, mode, onMode, model, onModel, modelName, providerName, effort, onEffort, prefs, onPrefs, state, tab, onTab, settingsFocus, onSetupChanged, onClose, onOpenFolder, onReview, onCommit, onCompact, onStopJob, onTodo, onParallel, where, onWhere, cloudPr, onCloudPr, onOpenSettings, onOpenFile } = props
  const github = useGithubStatus()
  const blocker = cloudBlocker(status, github.status, prefs?.coderGithub)
  const { context, todo, agents, jobs, changes, items, working, runStartedAt, lastRunMs } = state
  const [showAllAgents, setShowAllAgents] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (name: string) => setOpen((current) => (current === name ? null : name))
  const showReasoning = prefs?.coderShowReasoning ?? true
  const sandboxValue = prefs?.coderSandbox ?? 'off'
  const sandbox = sandboxLabel(sandboxValue, status.sandboxAvailable, !!status.devContainer)
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
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3">
        <div role="tablist" aria-label="Session panel" className="flex items-center gap-0.5">
          {(['session', 'settings'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => onTab(name)}
              className={cx('h-6.5 rounded-md px-2 text-xs transition-colors', tab === name ? 'bg-surface-hover font-medium text-text' : 'text-text-muted hover:text-text')}
            >
              {name === 'session' ? 'Session' : 'Settings'}
            </button>
          ))}
        </div>
        {working && (
          <span title="Working" className="ml-1 flex items-center gap-1.5 text-2xs text-text-faint tabular-nums">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
            {shortDuration(runMs)}
          </span>
        )}
        <IconButton size="sm" label="Hide the session panel" className="ml-auto" onClick={onClose}>
          <PanelRightClose size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {tab === 'settings' ? (
          <SettingsTab prefs={prefs} onPrefs={onPrefs} mode={mode} onMode={onMode} effort={effort} onEffort={onEffort} sandboxAvailable={status.sandboxAvailable} devContainer={!!status.devContainer} focus={settingsFocus} onSetupChanged={onSetupChanged} github={github} />
        ) : (
          <>
          <Section title="Environment">
            <div className="flex flex-col">
              <Row icon={Folder} label={folder ?? 'No folder chosen'} title={status.folder ?? undefined} onClick={status.folder ? onOpenFolder : undefined} />
              <SettingRow icon={where === 'cloud' ? Cloud : where === 'server' ? Server : Monitor} label="Runs on" value={where === 'server' && prefs?.coderServer ? prefs.coderServer : WHERE_LABEL[where]} open={open === 'where'} onToggle={() => (toggle('where'), github.reload())}>
                <Choices<CodeWhere>
                  label="Runs on"
                  value={where}
                  onChange={onWhere}
                  options={[
                    { id: 'local', label: 'This computer', hint: 'Works in your folder, asking as it goes' },
                    { id: 'cloud', label: 'GitHub Actions', hint: 'From GitHub’s copy of the branch. Carries on with this computer off, and pushes to a branch of its own', disabled: blocker !== null && where !== 'cloud' },
                    { id: 'server', label: 'Your server', hint: 'A computer of yours, over SSH. Carries on with this one off' }
                  ]}
                />
                {where === 'server' && <ServerSetup prefs={prefs} onPrefs={onPrefs} cloudPr={cloudPr} onCloudPr={onCloudPr} hosted={status.hosted && !model} />}
                {blocker && where !== 'server' && (
                  <p className="text-2xs text-text-muted">
                    {blocker}{' '}
                    {!blocker.startsWith('Checking') && (
                      <button type="button" onClick={() => onOpenSettings('github')} className="text-accent hover:text-accent-hover">
                        Open settings
                      </button>
                    )}
                  </p>
                )}
                {where === 'cloud' && <SwitchRow label="Open a pull request" hint="When it’s done, if anything changed" checked={cloudPr} onChange={onCloudPr} />}
                {where === 'cloud' && <p className="text-2xs text-text-faint">Every step is allowed there, as GitHub’s machine is thrown away after. It uses this session’s model{status.hosted && !model ? ' (scTerra AI, with its shared limits)' : ''} and your Actions minutes.</p>}
              </SettingRow>
              {(worktree || status.branch) && <Row icon={GitBranch} label={<span className="font-mono text-2xs">{worktree?.branch ?? status.branch}</span>} value={worktree ? 'Separate copy' : undefined} />}
              <SettingRow icon={Shield} label="Permissions" value={modeLabel} open={open === 'mode'} onToggle={() => toggle('mode')}>
                <ModeChoices mode={mode} onMode={onMode} />
              </SettingRow>
              <SettingRow icon={Layers} label="Sandbox" value={sandbox} open={open === 'sandbox'} onToggle={() => toggle('sandbox')}>
                <SandboxChoices value={sandboxValue} available={status.sandboxAvailable} container={!!status.devContainer} onChange={(coderSandbox) => onPrefs({ coderSandbox })} />
              </SettingRow>
            </div>
          </Section>

          <Section title="Model">
            <div className="flex flex-col">
              <SettingRow icon={Cpu} label={modelName} value={model ? model.providerName : (providerName ?? undefined)} open={open === 'model'} onToggle={() => toggle('model')}>
                <ModelChoices model={model} onModel={onModel} />
              </SettingRow>
              <SettingRow icon={Brain} label="Thinking" value={effortLabel} open={open === 'effort'} onToggle={() => toggle('effort')}>
                <EffortChoices effort={effort} onEffort={onEffort} />
                {prefs && <SwitchRow label="Show reasoning" hint="Folded above each step" checked={showReasoning} onChange={(coderShowReasoning) => onPrefs({ coderShowReasoning })} />}
              </SettingRow>
            </div>
          </Section>

          {/* What follows fills in as it works; before that, one line says so instead of empty sections. */}
          {!context && changes.length === 0 && stats.tools === 0 && <p className="px-4 py-3.5 text-2xs text-text-faint">Memory, changes and activity show here as Terra Code works.</p>}

          {context && (
            <Section title="Context" aside={`${shortTokens(context.used)} / ${shortTokens(context.limit)}`}>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium tabular-nums">{percent}% used</span>
                  {share >= 0.25 && (
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
              <div className="grid grid-cols-2 gap-1.5">
                <Stat label="Tokens in" value={shortTokens(context.inputTokens)} />
                <Stat label="Tokens out" value={shortTokens(context.outputTokens)} />
              </div>
              {(prefs?.coderBudget ?? 0) > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-2xs text-text-faint">
                    <span>Budget</span>
                    <span className="tabular-nums">
                      {shortTokens(context.inputTokens + context.outputTokens)} of {shortTokens(prefs!.coderBudget)}
                    </span>
                  </div>
                  <div role="meter" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, (context.inputTokens + context.outputTokens) / prefs!.coderBudget) * 100)} className="h-1 overflow-hidden rounded-full bg-surface-hover">
                    <div className="h-full rounded-full bg-text-muted transition-[width]" style={{ width: `${Math.min(100, ((context.inputTokens + context.outputTokens) / prefs!.coderBudget) * 100)}%` }} />
                  </div>
                </div>
              )}
            </Section>
          )}

          {todo.length > 0 && (
            <Section title="Checklist" aside={`${todo.filter((item) => item.done).length} of ${todo.length}`}>
              <ChecklistItems items={todo} working={working} onChange={onTodo} onParallel={onParallel} />
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

          {changes.length > 0 && (
            <Section
              title="Changes"
              aside={
                <>
                  <span className="text-success">+{added}</span>
                  <span className="text-danger">−{removed}</span>
                </>
              }
            >
              <ul className="-mx-1 flex flex-col">
                {changes.slice(0, 12).map((file) => {
                  const Icon = STATUS_ICONS[file.status]
                  return (
                    <li key={file.path} className="group flex min-w-0 items-center">
                      <button type="button" onClick={() => onReview(file.path)} title={file.path} className="flex h-6.5 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-xs transition-colors hover:bg-surface-hover">
                        <Icon aria-label={file.status} size={13} strokeWidth={1.75} className={cx('shrink-0', file.status === 'created' ? 'text-success' : file.status === 'deleted' ? 'text-danger' : 'text-text-faint')} />
                        <span dir="rtl" className="min-w-0 flex-1 truncate text-left font-mono text-2xs">
                          {file.path}
                        </span>
                        <span className="shrink-0 text-2xs tabular-nums">
                          <span className="text-success">+{file.added}</span> <span className="text-danger">−{file.removed}</span>
                        </span>
                      </button>
                      {file.status !== 'deleted' && (
                        <IconButton size="sm" label={`Open ${file.path.split('/').at(-1)} in your editor`} className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onOpenFile(file.path)}>
                          <SquareArrowOutUpRight size={12} strokeWidth={1.75} />
                        </IconButton>
                      )}
                    </li>
                  )
                })}
              </ul>
              {changes.length > 12 && <p className="text-2xs text-text-faint">And {changes.length - 12} more</p>}
              <div className="flex gap-1.5">
                <Button className="flex-1" onClick={() => onReview()}>
                  Review
                </Button>
                {(status.git || worktree) && (
                  <Button className="flex-1" disabled={working} onClick={onCommit}>
                    Commit
                  </Button>
                )}
              </div>
            </Section>
          )}

          {stats.tools > 0 && (
            <Section title="Activity" aside={lastRunMs !== null && !working ? `Last run ${lastRunMs < 1000 ? 'under 1 s' : shortDuration(lastRunMs)}` : undefined}>
              <div className="grid grid-cols-3 gap-1.5">
                <Stat label="Messages" value={stats.messages} />
                <Stat label="Steps" value={stats.tools} />
                <Stat label="Commands" value={stats.commands} />
                <Stat label="Looked at" value={stats.reads} />
                <Stat label="Edits" value={stats.edits} />
                <Stat label="Failed" value={stats.failed} />
              </div>
            </Section>
          )}
          </>
        )}
      </div>
    </aside>
  )
}
