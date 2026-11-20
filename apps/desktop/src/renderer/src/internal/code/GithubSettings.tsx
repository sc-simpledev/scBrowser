import { ExternalLink, LogOut, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from '@scbrowser/ui'
import type { CoderGithubStatus, Settings } from '@scbrowser/shared'
import { api } from '../api'
import { Choices } from './PanelSettings'
import { CopyButton, Spinner } from './CodeParts'

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Where a fine-grained token is made, with the permissions Terra Code uses filled in where GitHub allows. */
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/** Terra Code's GitHub sign-in, loaded once and again when asked. */
export function useGithubStatus(): { status: CoderGithubStatus | null; reload: () => void; set: (status: CoderGithubStatus) => void } {
  const [status, setStatus] = useState<CoderGithubStatus | null>(null)
  const reload = useCallback(() => void api().invoke('coder:github-status').then(setStatus, () => setStatus(null)), [])
  useEffect(reload, [reload])
  return { status, reload, set: setStatus }
}

export const githubLabel = (status: CoderGithubStatus | null, access: Settings['coderGithub']) => {
  if (!status?.source) return 'Not connected'
  if (status.error) return 'Needs you'
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
        <p className="text-2xs text-text-faint">Let Terra Code read issues, pull requests and Actions runs, and with your yes, open issues and pull requests. Cloud runs need it too.</p>
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
      <p className="text-2xs text-text-faint">{status.repo ? <>This project is <span className="font-mono text-text-muted">{status.repo}</span>.</> : 'This project has no GitHub remote, so Terra Code can only reach GitHub as a whole.'}</p>
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
