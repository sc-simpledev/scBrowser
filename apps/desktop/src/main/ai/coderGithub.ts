import { execFile } from 'node:child_process'
import { GITHUB_CLIENT_ID, type CoderGithubStatus, type GithubProject } from '@scbrowser/shared'
import type { CoderGithubHost } from './coder'

/** Tests point this at a stand-in GitHub, under SCB_E2E only. */
const API = (process.env.SCB_E2E === '1' && process.env.SCB_GITHUB_API) || 'https://api.github.com'
const KEY = 'coder:github'
/** Long answers are cut before they reach the model; trimming the noise first keeps more of what matters. */
const MAX_ANSWER_CHARS = 60_000
const CLI_TIMEOUT_MS = 5000

interface Saved {
  source: 'cli' | 'token'
  /** The token, encrypted, when it was pasted in. The CLI's is read each time and never kept. */
  sealed?: string
  login: string | null
}

export interface GithubStorage {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete?(key: string): void
}

export interface CoderGithubDeps {
  kv: GithubStorage
  access: () => 'off' | 'read' | 'write'
  seal: (text: string) => Promise<string>
  unseal: (sealed: string) => Promise<string>
  fetch?: typeof fetch
  /** The GitHub CLI's token, or null when it isn't installed or signed in. */
  cliToken?: () => Promise<string | null>
  /** `git remote get-url origin` in a folder. */
  remote?: (folder: string) => Promise<string | null>
  /** Whether a folder is inside a git repository. */
  isRepo?: (folder: string) => Promise<boolean>
}

/** The GitHub CLI's own sign-in, if it has one. */
export function ghToken(): Promise<string | null> {
  // Tests never reach the GitHub CLI on the computer running them.
  if (process.env.SCB_E2E === '1') return Promise.resolve(process.env.SCB_GH_CLI_TOKEN ?? null)
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: CLI_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      const token = String(stdout ?? '').trim()
      resolve(error || !/^[\w-]{20,}$/.test(token) ? null : token)
    })
  })
}

export function gitRemote(folder: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd: folder, timeout: CLI_TIMEOUT_MS, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).trim() || null))
  })
}

export function gitIsRepo(folder: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: folder, timeout: CLI_TIMEOUT_MS, windowsHide: true }, (error, stdout) => resolve(!error && String(stdout).trim() === 'true'))
  })
}

/** A remote address as it can be shown: any name and password in it taken out. */
export const shownRemote = (remote: string) => remote.replace(/^(\w+:\/\/)[^@/]+@/, '$1')

/** owner/name from a GitHub remote address, in any of the forms git uses. */
export function githubRepoOf(remote: string | null): string | null {
  if (!remote) return null
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(remote.trim())
  return match ? `${match[1]}/${match[2]}` : null
}

/** GitHub's answer with what's only for machines taken out: API addresses, node ids, avatars. */
export function trimGithub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimGithub)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'node_id' || key === 'gravatar_id' || key === 'avatar_url' || key === '_links' || key === 'performed_via_github_app' || key === 'reactions') continue
    if ((key === 'url' || key.endsWith('_url')) && key !== 'html_url') continue
    // Who someone is matters; their profile's every address doesn't.
    if ((key === 'user' || key === 'owner' || key === 'author' || key === 'committer' || key === 'assignee' || key === 'actor' || key === 'sender') && inner && typeof inner === 'object' && 'login' in inner) {
      out[key] = (inner as { login: unknown }).login
      continue
    }
    if (Array.isArray(inner) && (key === 'assignees' || key === 'requested_reviewers')) {
      out[key] = inner.map((person) => (person && typeof person === 'object' && 'login' in person ? (person as { login: unknown }).login : person))
      continue
    }
    out[key] = trimGithub(inner)
  }
  return out
}

/** The OAuth app for "Sign in with GitHub", if scTerra has one. */
export const githubClientId = () => process.env.SCTERRA_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID

export class GithubError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** Why GitHub said no, in words for people. */
function refusal(status: number, body: string, path: string): string {
  let said = ''
  try {
    said = String((JSON.parse(body) as { message?: unknown }).message ?? '')
  } catch {
    said = body.slice(0, 200)
  }
  if (/workflow/i.test(said)) return 'GitHub needs the workflow permission for this. With the GitHub CLI, run: gh auth refresh -s workflow. With a token, give it Workflows: Read and write.'
  if (status === 401) return 'GitHub didn’t accept the sign-in. Connect GitHub again in Terra Code settings.'
  if (status === 403 && /rate limit/i.test(said)) return 'GitHub’s rate limit is used up for now. Try again in a while.'
  if (status === 403 || status === 404) return `GitHub refused ${path.split('?')[0]} (${status}${said ? `: ${said}` : ''}). The sign-in may not have access to it.`
  return `GitHub answered ${status}${said ? `: ${said}` : ''}.`
}

/**
 * Terra Code's way into the person's GitHub: the GitHub CLI's sign-in, read each time and never
 * kept, or a token they paste in, kept encrypted. Nothing reaches the model unless they let
 * Terra Code look (or look and act) in its settings.
 */
export class CoderGithub implements CoderGithubHost {
  private readonly fetchImpl: typeof fetch
  private readonly cliToken: () => Promise<string | null>
  private readonly remote: (folder: string) => Promise<string | null>
  private readonly isRepo: (folder: string) => Promise<boolean>

  constructor(private readonly deps: CoderGithubDeps) {
    this.fetchImpl = deps.fetch ?? fetch
    this.cliToken = deps.cliToken ?? ghToken
    this.remote = deps.remote ?? gitRemote
    this.isRepo = deps.isRepo ?? gitIsRepo
  }

  /** How a folder stands with GitHub, for the steps in Terra Code's GitHub settings. */
  async project(folder: string | null): Promise<{ project: GithubProject; folder: string | null; repo: string | null; remote: string | null }> {
    if (!folder) return { project: 'no-folder', folder: null, repo: null, remote: null }
    const remote = await this.remote(folder)
    const repo = githubRepoOf(remote)
    if (repo) return { project: 'linked', folder, repo, remote: null }
    if (remote) return { project: 'other-remote', folder, repo: null, remote: shownRemote(remote) }
    return { project: (await this.isRepo(folder)) ? 'no-remote' : 'not-git', folder, repo: null, remote: null }
  }

  access(): 'off' | 'read' | 'write' {
    return this.saved() ? this.deps.access() : 'off'
  }

  private saved(): Saved | null {
    const value = this.deps.kv.get(KEY) as Saved | undefined
    return value && (value.source === 'cli' || (value.source === 'token' && typeof value.sealed === 'string')) ? value : null
  }

  async token(): Promise<string | null> {
    const saved = this.saved()
    if (!saved) return null
    if (saved.source === 'cli') return this.cliToken()
    return this.deps.unseal(saved.sealed!).catch(() => null)
  }

  async repo(folder: string): Promise<string | null> {
    return githubRepoOf(await this.remote(folder))
  }

  /** Who a token belongs to and what it may do, or why it can't be used. */
  private async whoIs(token: string): Promise<{ login: string; scopes: string[] | null }> {
    const response = await this.fetchImpl(`${API}/user`, { headers: this.headers(token) })
    if (!response.ok) throw new GithubError(response.status, response.status === 401 ? 'GitHub didn’t accept that token. Check it was copied whole and hasn’t expired.' : refusal(response.status, await response.text(), '/user'))
    const user = (await response.json()) as { login?: unknown }
    const header = response.headers.get('x-oauth-scopes')
    return { login: String(user.login ?? ''), scopes: header === null ? null : header.split(',').map((scope) => scope.trim()).filter(Boolean) }
  }

  async status(folder: string | null): Promise<CoderGithubStatus> {
    const saved = this.saved()
    const [cli, where] = await Promise.all([this.cliToken(), this.project(folder)])
    const base = { source: saved?.source ?? null, login: saved?.login ?? null, cliReady: cli !== null, scopes: null, ...where, error: null, deviceFlow: githubClientId() !== '' }
    if (!saved) return base
    const token = saved.source === 'cli' ? cli : await this.token()
    if (!token) return { ...base, error: saved.source === 'cli' ? 'The GitHub CLI isn’t signed in any more. Run gh auth login, or paste a token.' : 'The saved token can’t be read on this computer. Paste it again.' }
    try {
      const who = await this.whoIs(token)
      if (who.login !== saved.login) this.deps.kv.set(KEY, { ...saved, login: who.login })
      return { ...base, login: who.login, scopes: who.scopes }
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : 'GitHub couldn’t be reached.' }
    }
  }

  async useCli(folder: string | null): Promise<CoderGithubStatus> {
    const token = await this.cliToken()
    if (!token) throw new Error('The GitHub CLI isn’t installed or signed in. Run gh auth login in a terminal, then try again.')
    const who = await this.whoIs(token)
    this.deps.kv.set(KEY, { source: 'cli', login: who.login } satisfies Saved)
    return this.status(folder)
  }

  async saveToken(token: string, folder: string | null): Promise<CoderGithubStatus> {
    const trimmed = token.trim()
    if (!/^[\w-]{20,255}$/.test(trimmed)) throw new Error('That doesn’t look like a GitHub token. They start with github_pat_ or ghp_.')
    const who = await this.whoIs(trimmed)
    this.deps.kv.set(KEY, { source: 'token', sealed: await this.deps.seal(trimmed), login: who.login } satisfies Saved)
    return this.status(folder)
  }

  disconnect(): void {
    if (this.deps.kv.delete) this.deps.kv.delete(KEY)
    else this.deps.kv.set(KEY, null)
  }

  private headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'scTerra' }
  }

  /** A call for scTerra itself, such as starting a cloud run. Throws with words for people when GitHub says no. */
  async call<T = unknown>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = await this.token()
    if (!token) throw new Error('Connect GitHub first, in Terra Code settings.')
    const response = await this.fetchImpl(`${API}${path}`, { method, headers: { ...this.headers(token), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) })
    const text = await response.text()
    if (!response.ok) throw new GithubError(response.status, refusal(response.status, text, path))
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }

  /** A call the model asked for, answered as text for it, failures included. */
  async request(method: string, path: string, body: Record<string, unknown> | null, signal: AbortSignal): Promise<{ ok: boolean; status: number; output: string }> {
    const token = await this.token()
    if (!token) return { ok: false, status: 0, output: 'GitHub isn’t connected any more. The person can connect it again in Terra Code settings.' }
    const response = await this.fetchImpl(`${API}${path}`, { method, headers: { ...this.headers(token), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal })
    const text = await response.text()
    if (!response.ok) return { ok: false, status: response.status, output: refusal(response.status, text, path) }
    let shown = text
    if ((response.headers.get('content-type') ?? '').includes('json') && text) {
      try {
        shown = JSON.stringify(trimGithub(JSON.parse(text)))
      } catch {
        // Not JSON after all: shown as it came.
      }
    }
    const more = /rel="next"/.test(response.headers.get('link') ?? '') ? '\n(There are more results: ask for the next page with &page=2.)' : ''
    const cut = shown.length > MAX_ANSWER_CHARS ? `${shown.slice(0, MAX_ANSWER_CHARS)}\n…(cut: ask for fewer results with per_page, or one item at a time)` : shown
    return { ok: true, status: response.status, output: `${response.status}${cut ? `\n${cut}` : ''}${more}` }
  }
}
