import { Check, ExternalLink, FolderGit2, LogOut, Plus, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, cx, Input } from '@scbrowser/ui'
import { isGithubRepoName, type CoderGithubStatus, type Settings } from '@scbrowser/shared'
import { api } from '../api'
import { Choices } from './PanelSettings'
import { CopyButton, Spinner } from './CodeParts'
import { RepoPicker } from './ProjectStart'

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Where a fine-grained token is made, with the permissions Terra Code uses filled in where GitHub allows. */
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/** Terra Code's GitHub sign-in, loaded once and again when asked. */
export function useGithubStatus(): { status: CoderGithubStatus | null; reload: () => void; set: (status: CoderGithubStatus) => void } {
  const [status, setStatus] = useState<CoderGithubStatus | null>(null)
  const reload = useCallback(() => void api().invoke('coder:github-status').then(setStatus, () => setStatus(null)), [])
  useEffect(reload, [reload])
  // Connecting, linking or creating in one place shows everywhere on the page, such as the start screen's line.
  useEffect(() => {
    const follow = (event: Event) => setStatus((event as CustomEvent<CoderGithubStatus>).detail)
    window.addEventListener(GITHUB_CHANGED_EVENT, follow)
    return () => window.removeEventListener(GITHUB_CHANGED_EVENT, follow)
  }, [])
  const set = useCallback((next: CoderGithubStatus) => {
    setStatus(next)
    window.dispatchEvent(new CustomEvent(GITHUB_CHANGED_EVENT, { detail: next }))
  }, [])
  return { status, reload, set }
}

const GITHUB_CHANGED_EVENT = 'sc-github-changed'

export const githubLabel = (status: CoderGithubStatus | null, access: Settings['coderGithub']) => {
  if (!status?.source) return 'Not connected'
  if (status.error) return 'Needs you'
  if (status.project === 'not-git' || status.project === 'no-remote') return 'Not linked'
  return access === 'write' ? 'Look and act' : access === 'read' ? 'Look only' : 'Off'
}

/**
 * Connecting GitHub: the GitHub CLI's sign-in in one click where it's there, or a token pasted in.
 * Then how much Terra Code may do there: nothing, look, or look and act (asking each time).
 */
export function GithubSettings({ prefs, onPrefs, github }: { prefs: Settings; onPrefs: (patch: Partial<Settings>) => void; github: ReturnType<typeof useGithubStatus> }) {
  const { status, set } = github
  const [pasting, setPasting] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The code to type on github.com while a device sign-in waits. */
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const signIn = () => {
    setError(null)
    setBusy(true)
    void api()
      .invoke('coder:github-device-start')
      .then(({ code }) => {
        setDeviceCode(code)
        act(api().invoke('coder:github-device-wait'))
      }, (failure: Error) => {
        setError(cleanError(failure.message))
        setBusy(false)
      })
  }
  const act = (promise: Promise<CoderGithubStatus>) => {
    setBusy(true)
    setError(null)
    void promise
      .then(
        (next) => {
          set(next)
          setToken('')
          setPasting(false)
          setDeviceCode(null)
          // Connecting turns looking on in the main process; the page's copy catches up.
          if (next.source && prefs.coderGithub === 'off') onPrefs({ coderGithub: 'read' })
        },
        (failure: Error) => {
          setError(cleanError(failure.message))
          setDeviceCode(null)
        }
      )
      .finally(() => setBusy(false))
  }

  if (!status) return <p className="text-2xs text-text-faint">Checking GitHub…</p>

  if (!status.source)
    return (
      <div className="flex flex-col gap-2">
        <Steps step={1} />
        <p className="text-2xs text-text-faint">Let Terra Code read issues, pull requests and Actions runs, and with your yes, open issues and pull requests. Cloud runs need it too. First, sign in to your GitHub account:</p>
        {deviceCode && (
          <div role="status" className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2.5">
            <span className="text-2xs text-text-muted">Type this code on the GitHub page that opened:</span>
            <span className="flex items-center gap-2">
              <code className="font-mono text-base font-semibold tracking-[0.15em]">{deviceCode}</code>
              <CopyButton text={deviceCode} label="Copy the code" />
            </span>
            <span className="flex items-center gap-1.5 text-2xs text-text-faint">
              <Spinner /> Waiting for you to approve it
            </span>
          </div>
        )}
        {status.deviceFlow && !deviceCode && (
          <Button variant="primary" disabled={busy} onClick={signIn} className="self-start">
            Sign in with GitHub
          </Button>
        )}
        {status.cliReady && !deviceCode ? (
          <Button variant={status.deviceFlow ? 'secondary' : 'primary'} disabled={busy} onClick={() => act(api().invoke('coder:github-use-cli'))} className="self-start">
            <Terminal aria-hidden size={13} strokeWidth={1.75} />
            Use the GitHub CLI’s sign-in
          </Button>
        ) : status.deviceFlow || deviceCode ? null : (
          <p className="text-2xs text-text-muted">
            Quickest: install the GitHub CLI and run <code className="font-mono whitespace-nowrap">gh auth login</code>, then come back here.
          </p>
        )}
        {pasting ? (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              act(api().invoke('coder:github-save-token', token))
            }}
          >
            <Input type="password" aria-label="GitHub token" autoFocus value={token} placeholder="github_pat_…" onChange={(event) => setToken(event.target.value)} className="h-7 font-mono text-2xs" />
            <p className="text-2xs text-text-faint">Kept encrypted on this computer. Give it Contents, Issues, Pull requests and Actions; cloud runs also need Workflows and Secrets.</p>
            <div className="flex flex-wrap gap-1">
              <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
                {busy ? 'Checking…' : 'Connect'}
              </Button>
              <Button variant="ghost" onClick={() => void api().invoke('browser:open', NEW_TOKEN_URL)}>
                Make a token
                <ExternalLink aria-hidden size={11} strokeWidth={1.75} />
              </Button>
              <Button variant="ghost" onClick={() => setPasting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setPasting(true)} className="self-start text-2xs text-accent hover:text-accent-hover">
            {status.cliReady ? 'Or paste a token instead' : 'Paste a token'}
          </button>
        )}
        {error && <p className="text-2xs text-danger">{error}</p>}
      </div>
    )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">
            {status.login ? (
              <>
                Signed in as <span className="font-medium">@{status.login}</span>
              </>
            ) : (
              'Connected'
            )}
          </span>
          <span className="text-2xs text-text-faint">{status.source === 'cli' ? 'With the GitHub CLI’s sign-in' : 'With a token, kept encrypted'}</span>
        </span>
        <Button variant="ghost" disabled={busy} onClick={() => act(api().invoke('coder:github-disconnect'))}>
          <LogOut aria-hidden size={12} strokeWidth={1.75} />
          Disconnect
        </Button>
      </div>
      {status.error && <p className="text-2xs text-danger">{status.error}</p>}
      <ProjectStep status={status} onStatus={set} />
      <Choices
        label="What Terra Code may do on GitHub"
        value={prefs.coderGithub}
        onChange={(coderGithub) => onPrefs({ coderGithub })}
        options={[
          { id: 'read', label: 'Look only', hint: 'Issues, pull requests, code and Actions runs' },
          { id: 'write', label: 'Look and act', hint: 'Also opens issues, pull requests and comments, asking each time. Cloud runs need this' },
          { id: 'off', label: 'Off', hint: 'Stays connected, but Terra Code doesn’t use it' }
        ]}
      />
      {error && <p className="text-2xs text-danger">{error}</p>}
    </div>
  )
}

/** Where someone is in connecting: their account, then this project, then what Terra Code may do. */
function Steps({ step }: { step: 1 | 2 | 3 }) {
  const names = ['Your account', 'This project', 'What it may do']
  return (
    <ol aria-label="Connecting GitHub" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
      {names.map((name, index) => {
        const number = index + 1
        const done = number < step
        return (
          <li key={name} aria-current={number === step ? 'step' : undefined} className={cx('flex items-center gap-1', number === step ? 'font-medium text-text' : 'text-text-faint')}>
            <span aria-hidden className={cx('grid size-3.5 place-items-center rounded-full border text-[9px]', done ? 'border-accent bg-accent text-on-accent' : number === step ? 'border-accent text-accent' : 'border-border-strong')}>
              {done ? <Check size={8} strokeWidth={3} /> : number}
            </span>
            {name}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Step 2: how the open folder stands with GitHub, with a way forward when it isn't linked: make a
 * new repository for it (and push what's there), or point it at one the person already has.
 */
function ProjectStep({ status, onStatus }: { status: CoderGithubStatus; onStatus: (status: CoderGithubStatus) => void }) {
  const folderName = (status.folder ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const [mode, setMode] = useState<'idle' | 'create' | 'link'>('idle')
  const [name, setName] = useState('')
  const [makePrivate, setMakePrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const linked = status.project === 'linked'
  const step = linked ? 3 : 2

  const create = () => {
    setBusy(true)
    setError(null)
    void api()
      .invoke('coder:github-create', name.trim() || folderName, makePrivate)
      .then(({ status: next, pushed, pushError }) => {
        onStatus(next)
        setMode('idle')
        setDone(pushed ? `Made ${next.repo} and pushed ${pushed} to it.` : pushError ? `Made ${next.repo}, but pushing didn’t work: ${pushError}` : `Made ${next.repo}. It’s empty until your first commit is pushed; Terra Code can do that when you ask.`)
      }, (failure: Error) => setError(cleanError(failure.message)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <Steps step={step} />
      {status.project === 'no-folder' && <p className="text-2xs text-text-muted">Choose a project folder first. If it’s only on GitHub, use Clone from GitHub on Terra Code’s start screen.</p>}
      {linked && (
        <p className="flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
          <FolderGit2 aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-accent" />
          <span className="min-w-0 truncate">
            This project is <span className="font-mono text-text">{status.repo}</span> on GitHub.
          </span>
          <button type="button" className="shrink-0 text-accent hover:text-accent-hover" onClick={() => void api().invoke('browser:open', `https://github.com/${status.repo}`)}>
            Open
          </button>
        </p>
      )}
      {status.project === 'other-remote' && (
        <p className="text-2xs text-text-muted">
          This project’s git remote is <span className="font-mono break-all">{status.remote}</span>, which isn’t on GitHub, so Terra Code can only reach GitHub as a whole.
        </p>
      )}
      {(status.project === 'not-git' || status.project === 'no-remote') && mode === 'idle' && (
        <>
          <p className="text-2xs text-text-muted">{status.project === 'not-git' ? `${folderName || 'This folder'} isn’t on GitHub yet (it isn’t a git repository either; linking starts one).` : `${folderName || 'This project'} uses git but isn’t on GitHub yet.`} Put it there, or link it to a repository you already have:</p>
          <div className="flex flex-wrap gap-1">
            <Button variant="primary" onClick={() => { setName(folderName.replace(/[^\w.-]+/g, '-')); setMode('create') }}>
              <Plus aria-hidden size={12} strokeWidth={1.75} />
              Create a repository
            </Button>
            <Button variant="secondary" onClick={() => setMode('link')}>
              Link to an existing one
            </Button>
          </div>
        </>
      )}
      {mode === 'create' && (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
        >
          <label className="flex flex-col gap-1 text-2xs text-text-muted">
            Repository name
            <Input aria-label="Repository name" autoFocus value={name} onChange={(event) => setName(event.target.value)} className="h-7 font-mono text-2xs" />
          </label>
          <label className="flex items-center gap-1.5 text-2xs text-text-muted">
            <input type="checkbox" checked={makePrivate} onChange={(event) => setMakePrivate(event.target.checked)} className="accent-(--sc-accent)" />
            Private (only you and people you add can see it)
          </label>
          <p className="text-2xs text-text-faint">Made on @{status.login}’s account. If the project has commits, the current branch is pushed to it.</p>
          <div className="flex flex-wrap gap-1">
            <Button type="submit" variant="primary" disabled={busy || !isGithubRepoName(name.trim())}>
              {busy ? 'Creating…' : 'Create and push'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === 'link' && (
        <RepoPicker
          compact
          label="Link to a repository"
          working="Linking"
          onClose={() => setMode('idle')}
          onPick={(repo) =>
            api()
              .invoke('coder:github-link', repo.fullName)
              .then((next) => {
                onStatus(next)
                setMode('idle')
                setDone(`Linked to ${repo.fullName}. Nothing was pushed or downloaded; ask Terra Code to pull or push when you’re ready.`)
              })
          }
        />
      )}
      {done && <p role="status" className="text-2xs text-text-muted">{done}</p>}
      {error && <p className="text-2xs text-danger">{error}</p>}
    </div>
  )
}

/**
 * One line on Terra Code's start screen saying how the open project stands with GitHub, with the
 * next step one click away. Says nothing for a remote that isn't GitHub's.
 */
export function GithubStartLine({ folder, onSetUp }: { folder: string; onSetUp: () => void }) {
  const { status, reload } = useGithubStatus()
  useEffect(reload, [folder, reload])
  if (!status || status.project === 'other-remote' || status.project === 'no-folder') return null
  const words = !status.source
    ? status.repo
      ? `This project is ${status.repo} on GitHub. Connect your account to let Terra Code see its issues and pull requests.`
      : 'GitHub isn’t connected.'
    : status.repo
      ? null
      : 'This project isn’t on GitHub yet.'
  if (status.source && status.repo)
    return (
      <p className="flex items-center gap-1.5 text-xs text-text-faint">
        <FolderGit2 aria-hidden size={13} strokeWidth={1.75} className="shrink-0" />
        On GitHub as <span className="font-mono text-text-muted">{status.repo}</span>
      </p>
    )
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-text-faint">
      <FolderGit2 aria-hidden size={13} strokeWidth={1.75} className="shrink-0" />
      {words}
      <button type="button" onClick={onSetUp} className="font-medium text-accent hover:text-accent-hover">
        {status.source ? 'Put it on GitHub' : 'Connect GitHub'}
      </button>
    </p>
  )
}
