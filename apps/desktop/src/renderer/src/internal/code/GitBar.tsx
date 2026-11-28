import { ArrowDown, ArrowUp, ArrowUpDown, Check, CircleAlert, CircleDot, ExternalLink, GitBranch, GitBranchPlus, GitMerge, GitPullRequest, GitPullRequestArrow, Loader2, RefreshCw, Sparkles, Undo2, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, cx, Input } from '@scbrowser/ui'
import type { CoderGitState, CoderMergeMethod, CoderPullRequest } from '@scbrowser/shared'
import { api } from '../api'

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** What the git menu and its cards can do. */
export type GitAction = 'push' | 'pull' | 'sync' | 'pr' | 'merge-pr' | 'new-branch' | 'merge-branch' | 'resolve' | 'abort' | 'refresh' | `switch:${string}`

/**
 * Where the session's git stands, kept fresh: read when it opens, when `tick` changes (a run ended,
 * something was committed), and every minute while a pull request's checks are still running.
 */
export function useGitState(session: string, enabled: boolean, tick: unknown): { git: CoderGitState | null; refresh: (withPr?: boolean) => Promise<CoderGitState | null> } {
  const [git, setGit] = useState<CoderGitState | null>(null)
  const latest = useRef(0)
  const refresh = useCallback(
    async (withPr = true) => {
      if (!enabled) {
        setGit(null)
        return null
      }
      const asked = ++latest.current
      const next = await api()
        .invoke('coder:git-state', session, withPr)
        .catch(() => null)
      if (asked === latest.current) setGit((current) => (next && !withPr && current ? { ...next, pr: current.pr, github: current.github } : next))
      return next
    },
    [session, enabled]
  )
  useEffect(() => {
    // Quick first, so the branch shows at once; then again with GitHub's side.
    void refresh(false).then(() => refresh(true))
  }, [refresh, tick])
  const pending = git?.pr?.state === 'open' && git.pr.checks === 'pending'
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => void refresh(true), 60_000)
    return () => clearInterval(timer)
  }, [pending, refresh])
  return { git, refresh }
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

export function checksLabel(pr: CoderPullRequest): string {
  if (pr.state === 'merged') return 'merged'
  if (pr.state === 'closed') return 'closed'
  if (pr.draft) return 'draft'
  return pr.checks === 'passing' ? 'checks passed' : pr.checks === 'failing' ? 'checks failing' : pr.checks === 'pending' ? 'checks running' : 'open'
}

function Row({ icon: Icon, label, hint, disabled, danger, current, onClick }: { icon: LucideIcon; label: string; hint?: string; disabled?: boolean; danger?: boolean; current?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role={current === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={current}
      disabled={disabled || current}
      onClick={onClick}
      className={cx('flex min-h-8 items-center gap-2.5 rounded-md px-2 py-1 text-left text-xs transition-colors enabled:hover:bg-surface-hover', current ? 'font-medium' : 'disabled:opacity-50', danger && 'text-danger')}
    >
      <Icon aria-hidden size={13} strokeWidth={current ? 2 : 1.75} className={cx('shrink-0', danger ? 'text-danger' : current ? 'text-accent' : 'text-text-muted')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {hint && <span className="text-2xs text-text-faint">{hint}</span>}
      </span>
    </button>
  )
}

/**
 * The branch in Terra Code's bar, as a button: how far it is ahead of and behind GitHub, its pull
 * request, and a menu to push, pull, open or merge a pull request, and switch or make branches.
 */
export function GitMenu({ git, busy, working, onAction }: { git: CoderGitState; busy: boolean; working: boolean; onAction: (action: GitAction) => void }) {
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
  const act = (action: GitAction) => {
    setOpen(false)
    onAction(action)
  }
  const onBase = !!git.branch && git.branch === git.defaultBranch
  const pr = git.pr
  const stopped = busy || working
  const name = git.branch ?? 'no branch'
  return (
    <div ref={ref} className="relative min-w-0 shrink">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Branch ${name}${git.ahead ? `, ${plural(git.ahead, 'commit')} to push` : ''}${git.behind ? `, ${plural(git.behind, 'commit')} to pull` : ''}. Git menu`}
        title="Push, pull, pull requests and branches"
        onClick={() => {
          if (!open) onAction('refresh')
          setOpen(!open)
        }}
        className={cx('flex h-6 min-w-0 max-w-64 items-center gap-1 rounded-md px-1.5 font-mono text-2xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text', open && 'bg-surface-hover text-text')}
      >
        {busy ? <Loader2 aria-hidden size={12} strokeWidth={1.75} className="shrink-0 animate-spin" /> : <GitBranch aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />}
        <span className="truncate">{name}</span>
        {git.ahead > 0 && (
          <span className="flex shrink-0 items-center text-accent">
            <ArrowUp aria-hidden size={10} strokeWidth={2} />
            {git.ahead}
          </span>
        )}
        {git.behind > 0 && (
          <span className="flex shrink-0 items-center text-text">
            <ArrowDown aria-hidden size={10} strokeWidth={2} />
            {git.behind}
          </span>
        )}
        {git.conflicts.length > 0 && <CircleAlert aria-hidden size={11} strokeWidth={2} className="shrink-0 text-danger" />}
        {pr && pr.state === 'open' && <PrDot pr={pr} />}
      </button>
      {open && (
        <div role="menu" aria-label="Git" className="sc-glass-strong absolute top-full left-0 z-30 mt-1 flex w-72 flex-col rounded-lg p-1 text-text shadow-3">
          {git.midway && (
            <>
              <p className="px-2 pt-1 pb-1.5 text-2xs text-danger">
                {git.midway === 'rebase' ? 'A rebase' : 'A merge'} stopped{git.conflicts.length ? ` with conflicts in ${plural(git.conflicts.length, 'file')}` : ''}.
              </p>
              {git.conflicts.length > 0 && <Row icon={Sparkles} label="Resolve the conflicts with Terra Code" disabled={working} onClick={() => act('resolve')} />}
              <Row icon={Undo2} label={`Give up the ${git.midway}`} hint="Back to how things were before it" danger disabled={stopped} onClick={() => act('abort')} />
              <div className="my-1 h-px bg-border" />
            </>
          )}
          {git.remote && !git.midway && (
            <>
              {git.behind > 0 && git.ahead > 0 ? (
                <Row icon={ArrowUpDown} label="Sync with GitHub" hint={`Pull ${plural(git.behind, 'commit')}, then push ${git.ahead}`} disabled={stopped} onClick={() => act('sync')} />
              ) : git.behind > 0 ? (
                <Row icon={ArrowDown} label={`Pull ${plural(git.behind, 'commit')}`} disabled={stopped} onClick={() => act('pull')} />
              ) : (
                <Row icon={ArrowUp} label={git.upstream ? (git.ahead > 0 ? `Push ${plural(git.ahead, 'commit')}` : 'Push') : `Push ${git.branch ?? 'this branch'} to GitHub`} hint={git.upstream ? (git.ahead === 0 ? 'Nothing new to push' : undefined) : 'For the first time'} disabled={stopped || !git.branch || (!!git.upstream && git.ahead === 0)} onClick={() => act('push')} />
              )}
              {git.behind === 0 && <Row icon={RefreshCw} label="Pull" hint="Get any new commits from GitHub" disabled={stopped} onClick={() => act('pull')} />}
            </>
          )}
          {git.repo && !git.midway && (
            <>
              {git.remote && <div className="my-1 h-px bg-border" />}
              {pr && pr.state === 'open' ? (
                <>
                  <Row icon={ExternalLink} label={`Pull request #${pr.number}`} hint={`${pr.title} · ${checksLabel(pr)}`} onClick={() => (setOpen(false), void api().invoke('browser:open', pr.url))} />
                  <Row icon={GitMerge} label={`Merge #${pr.number} into ${pr.base}`} hint={pr.checks === 'failing' ? 'Its checks are failing' : pr.mergeable === false ? 'It has conflicts with the base' : 'On GitHub, then tidy up here'} disabled={stopped} onClick={() => act('merge-pr')} />
                </>
              ) : (
                <Row
                  icon={GitPullRequestArrow}
                  label="Create a pull request…"
                  hint={!git.github ? 'Connect GitHub in Terra Code settings first' : onBase ? `You’re on ${git.branch}: it makes a branch first` : `From ${git.branch ?? 'this branch'} into ${git.defaultBranch ?? 'the default branch'}`}
                  disabled={stopped || !git.github || !git.branch}
                  onClick={() => act('pr')}
                />
              )}
              {pr && pr.state !== 'open' && <Row icon={ExternalLink} label={`#${pr.number} is ${pr.state}`} hint={pr.title} onClick={() => (setOpen(false), void api().invoke('browser:open', pr.url))} />}
            </>
          )}
          {/* The midway section ends in a line of its own, and nothing may come before the branches. */}
          {!git.midway && (git.remote || git.repo) && <div className="my-1 h-px bg-border" />}
          <p className="px-2 pt-1 pb-1 text-2xs font-medium text-text-faint">Branches</p>
          <div className="sc-scroll-quiet flex max-h-44 flex-col overflow-y-auto">
            {git.branches.slice(0, 12).map((branch) => (
              <Row key={branch} icon={branch === git.branch ? Check : GitBranch} label={branch} current={branch === git.branch} disabled={stopped || !!git.midway} onClick={() => act(`switch:${branch}`)} />
            ))}
          </div>
          <Row icon={GitBranchPlus} label="New branch…" hint="Your changes come along" disabled={stopped || !!git.midway} onClick={() => act('new-branch')} />
          <Row icon={GitMerge} label={`Merge a branch into ${git.branch ?? 'this one'}…`} disabled={stopped || !!git.midway || git.branches.length < 2} onClick={() => act('merge-branch')} />
        </div>
      )}
    </div>
  )
}

function PrDot({ pr }: { pr: CoderPullRequest }) {
  const colour = pr.checks === 'failing' ? 'text-danger' : pr.checks === 'passing' ? 'text-success' : pr.checks === 'pending' ? 'text-text-muted' : 'text-text-faint'
  return (
    <span title={`#${pr.number}: ${checksLabel(pr)}`} className={cx('flex shrink-0 items-center gap-0.5', colour)}>
      <GitPullRequest aria-hidden size={11} strokeWidth={1.75} />#{pr.number}
    </span>
  )
}

/** The note shown above the box while a merge or pull has stopped on conflicts. */
export function ConflictBar({ git, working, onResolve, onAbort }: { git: CoderGitState; working: boolean; onResolve: () => void; onAbort: () => void }) {
  if (!git.midway) return null
  return (
    <section aria-label="Merge conflicts" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 px-2.5 py-1.5 text-xs">
      <CircleAlert aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1">
        {git.midway === 'rebase' ? 'A rebase' : 'A merge'} stopped{git.conflicts.length ? ` on conflicts in ${git.conflicts.length === 1 ? git.conflicts[0] : plural(git.conflicts.length, 'file')}` : ''}.
      </span>
      {git.conflicts.length > 0 && (
        <Button variant="primary" disabled={working} onClick={onResolve}>
          Resolve with Terra Code
        </Button>
      )}
      <Button variant="ghost" disabled={working} onClick={onAbort}>
        Give up
      </Button>
    </section>
  )
}

function CardShell({ icon: Icon, title, children, onCancel }: { icon: LucideIcon; title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface p-2.5">
      <div className="flex items-center gap-2 px-0.5 text-sm font-medium">
        <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <button type="button" aria-label="Close" onClick={onCancel} className="grid size-6 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text">
          <X aria-hidden size={13} strokeWidth={2} />
        </button>
      </div>
      {children}
    </section>
  )
}

const fieldClass = 'rounded-md border border-border bg-field px-2.5 py-1.5 text-xs outline-none placeholder:text-text-faint focus:border-border-strong'

/** A branch name from a few words, as people would write one. */
export const branchFromWords = (words: string) =>
  words
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

/** Opens a pull request: the quick model writes the title and description from the commits, and the person checks them. */
export function PullRequestCard({ session, git, onDone, onCancel }: { session: string; git: CoderGitState; onDone: (note: string, pr: CoderPullRequest) => void; onCancel: () => void }) {
  const onBase = !!git.branch && git.branch === git.defaultBranch
  const [base, setBase] = useState(git.defaultBranch ?? 'main')
  const [branch, setBranch] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [writing, setWriting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The branch made for this, so trying again after a failure doesn't try to make it twice. */
  const made = useRef<string | null>(null)
  useEffect(() => {
    setWriting(true)
    void api()
      .invoke('coder:pr-draft', session, base)
      .then(
        (written) => {
          setTitle((current) => current || written.title)
          setBody((current) => current || written.body)
          if (onBase) setBranch((current) => current || branchFromWords(written.title))
        },
        () => undefined
      )
      .finally(() => setWriting(false))
    // Written once for the base it opened with; changing the base keeps what's been written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (onBase && made.current !== branch.trim()) {
        await api().invoke('coder:git-switch', session, branch, true)
        made.current = branch.trim()
      }
      const pr = await api().invoke('coder:pr-create', session, { title, body, base, draft })
      onDone(`Opened pull request #${pr.number}: ${pr.title}`, pr)
    } catch (failure) {
      setError(cleanError((failure as Error).message))
      setBusy(false)
    }
  }
  const bases = [...new Set([git.defaultBranch, ...git.branches].filter((name): name is string => !!name && name !== git.branch))]
  return (
    <CardShell icon={GitPullRequestArrow} title="Create a pull request" onCancel={onCancel}>
      {onBase && (
        <label className="flex flex-col gap-1 px-0.5 text-2xs text-text-muted">
          You’re on {git.branch}, so the work goes on a new branch first
          <Input aria-label="New branch name" value={branch} placeholder="feature/short-name" onChange={(e) => setBranch(e.target.value)} className="h-7 font-mono text-xs" />
        </label>
      )}
      <input aria-label="Pull request title" value={title} placeholder={writing ? 'Writing a title…' : 'What it does'} onChange={(e) => setTitle(e.target.value)} className={cx(fieldClass, 'font-medium')} />
      <textarea aria-label="Pull request description" value={body} placeholder={writing ? 'Writing a description…' : 'Why, and how it was tested'} onChange={(e) => setBody(e.target.value)} rows={6} className={cx(fieldClass, 'resize-y font-mono')} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5 text-xs text-text-muted">
        <label className="flex items-center gap-1.5">
          Into
          <select aria-label="Base branch" value={base} onChange={(e) => setBase(e.target.value)} className="sc-select h-6.5 rounded-md border border-border bg-field pl-1.5 font-mono text-xs">
            {bases.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} className="accent-(--sc-accent)" />
          As a draft
        </label>
        <span className="text-2xs text-text-faint">{git.upstream && git.ahead === 0 ? 'Everything is pushed.' : 'Pushes the branch first.'}</span>
      </div>
      {error && <p className="px-0.5 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || !title.trim() || !base || (onBase && !branch.trim())} onClick={() => void submit()}>
          {busy ? 'Opening…' : 'Open the pull request'}
        </Button>
      </div>
    </CardShell>
  )
}

const METHODS: { id: CoderMergeMethod; label: string; hint: string }[] = [
  { id: 'squash', label: 'Squash', hint: 'One tidy commit on the base' },
  { id: 'merge', label: 'Merge commit', hint: 'Keeps every commit, joined by a merge' },
  { id: 'rebase', label: 'Rebase', hint: 'Every commit, replayed in a line' }
]

/** Merges the open pull request on GitHub, then brings this folder back to the base, up to date. */
export function MergeCard({ session, pr, onDone, onCancel }: { session: string; pr: CoderPullRequest; onDone: (note: string) => void; onCancel: () => void }) {
  const [method, setMethod] = useState<CoderMergeMethod>('squash')
  const [remove, setRemove] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    setBusy(true)
    setError(null)
    void api()
      .invoke('coder:pr-merge', session, pr.number, method, remove)
      .then(onDone, (failure: Error) => {
        setError(cleanError(failure.message))
        setBusy(false)
      })
  }
  return (
    <CardShell icon={GitMerge} title={`Merge #${pr.number} into ${pr.base}`} onCancel={onCancel}>
      <p className="px-0.5 text-xs text-text-muted">{pr.title}</p>
      {(pr.checks === 'failing' || pr.checks === 'pending' || pr.mergeable === false) && (
        <p className="flex items-center gap-1.5 px-0.5 text-xs text-danger">
          <CircleDot aria-hidden size={12} strokeWidth={2} />
          {pr.mergeable === false ? 'GitHub says it has conflicts with the base: pull the base in first.' : pr.checks === 'failing' ? 'Its checks are failing. /fix-ci can look into why.' : 'Its checks are still running.'}
        </p>
      )}
      <div role="radiogroup" aria-label="How to merge" className="grid grid-cols-3 gap-1">
        {METHODS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={method === option.id}
            onClick={() => setMethod(option.id)}
            className={cx('flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-xs transition-colors', method === option.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-hover')}
          >
            <span className="font-medium">{option.label}</span>
            <span className="text-2xs text-text-faint">{option.hint}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1.5 px-0.5 text-xs text-text-muted">
        <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} className="accent-(--sc-accent)" />
        Remove the branch afterwards, here and on GitHub
      </label>
      {error && <p className="px-0.5 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={() => void api().invoke('browser:open', pr.url)}>
          Open on GitHub
        </Button>
        <Button variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Merging…' : 'Merge'}
        </Button>
      </div>
    </CardShell>
  )
}

/** A name for a new branch, or a branch to merge in. */
export function BranchCard({ session, git, kind, onDone, onCancel }: { session: string; git: CoderGitState; kind: 'new' | 'merge'; onDone: (note: string) => void; onCancel: () => void }) {
  const others = git.branches.filter((name) => name !== git.branch)
  const [value, setValue] = useState(kind === 'merge' ? (git.defaultBranch && git.defaultBranch !== git.branch ? git.defaultBranch : (others[0] ?? '')) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    setBusy(true)
    setError(null)
    const call = kind === 'new' ? api().invoke('coder:git-switch', session, value, true) : api().invoke('coder:git-merge', session, value)
    void call.then(onDone, (failure: Error) => {
      const message = cleanError(failure.message)
      // A merge that stopped on conflicts isn't a failure of the card: the bar takes it from here.
      if (message.startsWith('CONFLICTS: ')) return onDone(message.slice('CONFLICTS: '.length))
      setError(message)
      setBusy(false)
    })
  }
  return (
    <CardShell icon={kind === 'new' ? GitBranchPlus : GitMerge} title={kind === 'new' ? 'New branch' : `Merge a branch into ${git.branch ?? 'this one'}`} onCancel={onCancel}>
      {kind === 'new' ? (
        <Input
          aria-label="Branch name"
          autoFocus
          value={value}
          placeholder="feature/short-name"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && submit()}
          className="h-7 font-mono text-xs"
        />
      ) : (
        <select aria-label="Branch to merge in" value={value} onChange={(e) => setValue(e.target.value)} className="sc-select h-7 rounded-md border border-border bg-field pl-1.5 font-mono text-xs">
          {[...others, ...(git.defaultBranch && git.remote ? [`origin/${git.defaultBranch}`] : [])].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      <p className="px-0.5 text-2xs text-text-faint">{kind === 'new' ? `Made from ${git.branch ?? 'here'}. Changes you haven’t committed come along.` : 'Here, on this computer. If it stops on conflicts, Terra Code can resolve them.'}</p>
      {error && <p className="px-0.5 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || !value.trim()} onClick={submit}>
          {kind === 'new' ? 'Make it' : 'Merge'}
        </Button>
      </div>
    </CardShell>
  )
}
