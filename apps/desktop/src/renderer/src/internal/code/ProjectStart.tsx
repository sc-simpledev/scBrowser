import { Check, GitFork, Lock, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { CODER_INIT_TASK, MCP_DIRECTORY, type CoderProjectSetup, type GithubRepo } from '@scbrowser/shared'
import { api } from '../api'
import { Spinner } from './CodeParts'

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** "3 days ago", for when a repository was last pushed to. */
function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (!Number.isFinite(days)) return ''
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months} ${months === 1 ? 'month' : 'months'} ago` : `${Math.floor(months / 12)} y ago`
}

/** Picks one of the person's GitHub repositories and clones it, without a terminal. */
export function CloneCard({ onCloned, onClose, onConnect }: { onCloned: (folder: string) => void; onClose: () => void; onConnect: () => void }) {
  return (
    <RepoPicker
      label="Clone from GitHub"
      working="Cloning"
      onClose={onClose}
      onConnect={onConnect}
      onPick={(repo) =>
        api()
          .invoke('coder:clone', repo.fullName)
          .then((folder) => {
            if (folder) onCloned(folder)
          })
      }
    />
  )
}

/** A searchable list of the person's GitHub repositories; picking one runs `onPick`. */
export function RepoPicker({ label, working, onPick, onClose, onConnect, compact }: { label: string; working: string; onPick: (repo: GithubRepo) => Promise<unknown>; onClose: () => void; onConnect?: () => void; compact?: boolean }) {
  const [query, setQuery] = useState('')
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void api()
          .invoke('coder:github-repos', query)
          .then(
            (found) => {
              setRepos(found)
              setError(null)
            },
            (failure: Error) => setError(cleanError(failure.message))
          ),
      query ? 250 : 0
    )
    return () => clearTimeout(timer)
  }, [query])
  const pick = (repo: GithubRepo) => {
    setPicking(repo.fullName)
    setError(null)
    void onPick(repo)
      .catch((failure: Error) => setError(cleanError(failure.message)))
      .finally(() => setPicking(null))
  }
  const needsGithub = error !== null && /Connect GitHub/.test(error)
  return (
    <section aria-label={label} className={cx('flex flex-col overflow-hidden rounded-lg border border-border bg-surface', !compact && 'max-w-130')}>
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <Search aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
        <input autoFocus value={query} aria-label="Find a repository" placeholder="Find a repository" onChange={(event) => setQuery(event.target.value)} className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-faint" />
        <IconButton size="sm" label="Close" onClick={onClose}>
          <X size={13} strokeWidth={1.75} />
        </IconButton>
      </div>
      {needsGithub ? (
        <div className="flex flex-col items-start gap-2 p-3 text-xs text-text-muted">
          GitHub isn’t connected yet.
          {onConnect && (
            <Button variant="primary" onClick={onConnect}>
              Connect GitHub
            </Button>
          )}
        </div>
      ) : (
        <ul aria-label="Repositories" className={cx('sc-scroll-quiet flex flex-col overflow-y-auto p-1', compact ? 'max-h-52' : 'max-h-72')}>
          {repos === null && !error && (
            <li className="flex items-center gap-2 px-2 py-2 text-xs text-text-faint">
              <Spinner /> Finding your repositories…
            </li>
          )}
          {repos?.length === 0 && <li className="px-2 py-2 text-xs text-text-faint">Nothing matches.</li>}
          {repos?.map((repo) => (
            <li key={repo.fullName}>
              <button type="button" disabled={picking !== null} onClick={() => pick(repo)} className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors enabled:hover:bg-surface-hover disabled:opacity-60">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm">
                    <span className="truncate">{repo.fullName}</span>
                    {repo.private && <Lock aria-label="Private" size={11} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
                  </span>
                  {repo.description && <span className="truncate text-2xs text-text-faint">{repo.description}</span>}
                </span>
                {picking === repo.fullName ? <Spinner label={working} /> : <span className="shrink-0 text-2xs text-text-faint">{ago(repo.pushedAt)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && !needsGithub && <p className="border-t border-border px-3 py-2 text-2xs text-danger">{error}</p>}
    </section>
  )
}

const DISMISSED_KEY = 'terra-code:setup-dismissed'
const dismissed = (folder: string) => {
  try {
    return (JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]).includes(folder)
  } catch {
    return false
  }
}
const dismiss = (folder: string) => {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...list, folder].slice(-200)))
  } catch {
    // It comes back next time.
  }
}

/**
 * The first time a folder is opened: its stack, the commands it could run without asking, MCP
 * servers that fit it, and writing TERRA.md, all chosen on one card.
 */
export function SetupCard({ folder, onStart }: { folder: string; onStart: (task: string, shown: string) => void }) {
  const [setup, setSetup] = useState<CoderProjectSetup | null>(null)
  const [rules, setRules] = useState<string[]>([])
  const [servers, setServers] = useState<string[]>([])
  const [init, setInit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(() => dismissed(folder))
  useEffect(() => {
    setHidden(dismissed(folder))
    void api()
      .invoke('coder:project-setup')
      .then((found) => {
        setSetup(found)
        setRules(found?.rules ?? [])
        setServers(found?.mcp ?? [])
        setInit(!found?.instructions)
      }, () => setSetup(null))
  }, [folder])
  if (hidden || !setup) return null
  // Nothing to set up: the card would only be in the way.
  if (setup.rules.length === 0 && setup.mcp.length === 0 && setup.instructions) return null
  const close = () => {
    dismiss(folder)
    setHidden(true)
  }
  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      if (rules.length) {
        const current = (await api().invoke('coder:setup')).rules
        await api().invoke('coder:set-rules', { allow: [...new Set([...current.allow, ...rules])], deny: current.deny })
      }
      for (const id of servers) {
        const entry = MCP_DIRECTORY.find((candidate) => candidate.id === id)
        if (!entry || entry.keys.length) continue
        await api().invoke('coder:mcp-save', entry.config.type === 'stdio' ? { name: entry.name, type: 'stdio', command: entry.config.command, args: entry.config.args, env: {}, enabled: true } : { name: entry.name, type: 'http', url: entry.config.url, headers: {}, enabled: true })
      }
      close()
      if (init && !setup.instructions) onStart(CODER_INIT_TASK, '/init')
    } catch (failure) {
      setError(cleanError(failure instanceof Error ? failure.message : 'It couldn’t be set up.'))
    } finally {
      setBusy(false)
    }
  }
  const toggle = (list: string[], value: string, set: (next: string[]) => void) => set(list.includes(value) ? list.filter((one) => one !== value) : [...list, value])
  const suggested = setup.mcp.map((id) => MCP_DIRECTORY.find((entry) => entry.id === id)).filter((entry) => !!entry && entry.keys.length === 0)
  return (
    <section aria-label="Set up this project" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-2">
        <Sparkles aria-hidden size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-sm font-medium">Set up this project</h3>
          {setup.stack.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {setup.stack.map((part) => (
                <span key={part} className="rounded-sm bg-surface-hover px-1.5 py-0.5 text-2xs text-text-muted">
                  {part}
                </span>
              ))}
            </div>
          )}
        </div>
        <IconButton size="sm" label="Not now" onClick={close}>
          <X size={13} strokeWidth={1.75} />
        </IconButton>
      </div>
      {setup.rules.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 text-xs text-text-muted">Run these without asking</legend>
          {setup.rules.map((rule) => (
            <Tick key={rule} on={rules.includes(rule)} onClick={() => toggle(rules, rule, setRules)}>
              <code className="font-mono text-2xs">{rule}</code>
            </Tick>
          ))}
        </fieldset>
      )}
      {suggested.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 text-xs text-text-muted">Add MCP servers that fit</legend>
          {suggested.map((entry) => (
            <Tick key={entry!.id} on={servers.includes(entry!.id)} onClick={() => toggle(servers, entry!.id, setServers)}>
              <span className="text-xs font-medium">{entry!.name}</span> <span className="text-2xs text-text-faint">{entry!.description}</span>
            </Tick>
          ))}
        </fieldset>
      )}
      {!setup.instructions && (
        <Tick on={init} onClick={() => setInit(!init)}>
          <span className="text-xs">Look around first and write TERRA.md, the project’s notes for Terra Code</span>
        </Tick>
      )}
      {error && <p className="text-2xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={close}>
          Not now
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void apply()}>
          {busy ? 'Setting up…' : 'Set up'}
        </Button>
      </div>
    </section>
  )
}

function Tick({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-hover">
      <span aria-hidden className={cx('grid size-3.5 shrink-0 place-items-center rounded-sm border', on ? 'border-accent bg-accent text-on-accent' : 'border-border-strong')}>{on && <Check size={9} strokeWidth={3} />}</span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}

export { GitFork as CloneIcon }
