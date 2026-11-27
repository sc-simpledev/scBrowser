import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MCP_DIRECTORY, type CoderProjectSetup } from '@scbrowser/shared'
import { commandEnv } from './coderTools'
import { claudeSettings } from './coderProject'

const exists = (path: string) => access(path).then(() => true, () => false)
const readJson = async (path: string): Promise<Record<string, unknown> | null> => {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Scripts worth running without asking, in the order they're offered. */
const SAFE_SCRIPTS = ['test', 'typecheck', 'type-check', 'lint', 'check', 'build', 'format']

/**
 * What a project folder looks like, for its first-run card: its stack, whether it has notes for
 * coding agents, commands safe enough to let through, and MCP servers that fit it. Only reads files.
 */
export async function projectSetup(folder: string, existingRules: string[]): Promise<CoderProjectSetup> {
  const at = (name: string) => join(folder, name)
  const [pkg, pyproject, requirements, cargo, gomod, makefile, tsconfig, terra, agents, claude] = await Promise.all([
    readJson(at('package.json')),
    readFile(at('pyproject.toml'), 'utf8').catch(() => null),
    readFile(at('requirements.txt'), 'utf8').catch(() => null),
    exists(at('Cargo.toml')),
    exists(at('go.mod')),
    readFile(at('Makefile'), 'utf8').catch(() => null),
    exists(at('tsconfig.json')),
    exists(at('TERRA.md')),
    exists(at('AGENTS.md')),
    exists(at('CLAUDE.md'))
  ])
  const stack: string[] = []
  const rules: string[] = []
  const mcp = new Set<string>()
  const deps = pkg ? { ...((pkg.dependencies as Record<string, string>) ?? {}), ...((pkg.devDependencies as Record<string, string>) ?? {}) } : {}
  const has = (name: string) => name in deps || Object.keys(deps).some((dep) => dep.startsWith(`${name}/`))
  if (pkg) {
    const manager = (await exists(at('pnpm-lock.yaml'))) ? 'pnpm' : (await exists(at('yarn.lock'))) ? 'yarn' : (await exists(at('bun.lockb'))) || (await exists(at('bun.lock'))) ? 'bun' : 'npm'
    stack.push(tsconfig || has('typescript') ? 'TypeScript' : 'JavaScript')
    for (const [dep, label] of [['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@angular/core', 'Angular'], ['vite', 'Vite'], ['electron', 'Electron'], ['express', 'Express']] as const) if (has(dep)) stack.push(label)
    stack.push(manager)
    const scripts = (pkg.scripts as Record<string, string>) ?? {}
    for (const script of SAFE_SCRIPTS) if (script in scripts) rules.push(script === 'test' && manager === 'npm' ? 'npm test*' : `${manager} run ${script}*`)
    if (has('@playwright/test') || has('playwright') || has('puppeteer') || has('cypress') || has('react') || has('vue') || has('svelte') || has('next')) mcp.add('playwright')
    if (has('@sentry')) mcp.add('sentry')
    if (Object.keys(deps).length) mcp.add('context7')
  }
  const python = pyproject ?? requirements
  if (python !== null) {
    stack.push('Python')
    if (/pytest/.test(python) || (await exists(at('tests')))) rules.push('pytest*', 'python -m pytest*')
    if (/ruff/.test(python)) rules.push('ruff check*')
    if (/\b(transformers|diffusers|datasets|huggingface)/.test(python)) mcp.add('huggingface')
    if (/sentry-sdk/.test(python)) mcp.add('sentry')
    mcp.add('context7')
  }
  if (cargo) {
    stack.push('Rust')
    rules.push('cargo check*', 'cargo test*', 'cargo clippy*', 'cargo build*')
  }
  if (gomod) {
    stack.push('Go')
    rules.push('go test*', 'go vet*', 'go build*')
  }
  if (makefile && /^test:/m.test(makefile)) rules.push('make test*')
  // A project set up for Claude Code already says which commands it trusts: offered, never taken as given.
  rules.push(...(await claudeSettings(folder)).allow)
  const known = new Set(MCP_DIRECTORY.map((entry) => entry.id))
  return {
    stack,
    instructions: terra || agents || claude,
    rules: [...new Set(rules)].filter((rule) => !existingRules.includes(rule)),
    mcp: [...mcp].filter((id) => known.has(id))
  }
}

/** Clones a GitHub repository into a folder, with the token only on that command, never kept in git's settings. */
export function cloneRepo(fullName: string, into: string, token: string | null): Promise<void> {
  const auth = token ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] : []
  return new Promise((resolve, reject) => {
    execFile('git', [...auth, 'clone', '--', `https://github.com/${fullName}.git`, into], { env: { ...commandEnv(), GIT_TERMINAL_PROMPT: '0' }, timeout: 10 * 60_000, windowsHide: true, maxBuffer: 10_000_000 }, (error, _stdout, stderr) => {
      if (!error) return resolve()
      const said = String(stderr).split('\n').filter((line) => /fatal|error/i.test(line)).join(' ').replace(/x-access-token:[^@\s]+/g, '…').slice(0, 300)
      reject(new Error(said || 'Cloning failed.'))
    })
  })
}

/** Git in a folder, with the token (if any) only on this one command, and its error in words. */
export function git(folder: string, args: string[], token: string | null = null, base = 'https://github.com'): Promise<string> {
  const auth = token ? ['-c', `http.${base}/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] : []
  return new Promise((resolve, reject) => {
    // ssh never asks for a password either: with no key, it fails at once rather than waiting unseen.
    const ssh = process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new'
    execFile('git', [...auth, ...args], { cwd: folder, env: { ...commandEnv(), GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: ssh }, timeout: 10 * 60_000, windowsHide: true, maxBuffer: 10_000_000 }, (error, stdout, stderr) => {
      if (!error) return resolve(String(stdout))
      const said = String(stderr).split('\n').filter((line) => /fatal|error|rejected|hint: Updates/i.test(line)).join(' ').replace(/x-access-token:[^@\s]+/g, '…').slice(0, 300)
      reject(new Error(said || `git ${args[0]} failed.`))
    })
  })
}

/**
 * Links a project folder to a GitHub repository as its `origin`, starting a git repository first
 * when there isn't one. Nothing is pushed or fetched, and an existing origin is never replaced.
 */
export async function linkRepo(folder: string, fullName: string, base = 'https://github.com'): Promise<void> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new Error('That isn’t a repository name.')
  const inside = await git(folder, ['rev-parse', '--is-inside-work-tree']).then((out) => out.trim() === 'true', () => false)
  if (!inside) await git(folder, ['init'])
  const origin = await git(folder, ['remote', 'get-url', 'origin']).then((out) => out.trim(), () => '')
  if (origin) throw new Error('This project already has a remote called origin. Change it with git remote set-url origin, or ask Terra Code to.')
  await git(folder, ['remote', 'add', 'origin', `${base}/${fullName}.git`])
}

/** Whether the folder's repository has a commit to push yet. */
export const hasCommits = (folder: string) => git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(() => true, () => false)

/** Pushes the current branch to origin and tracks it there. */
export async function pushBranch(folder: string, token: string | null, base = 'https://github.com'): Promise<string> {
  const branch = (await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  await git(folder, ['push', '--set-upstream', 'origin', branch], token, base)
  return branch
}

/** GitHub's device sign-in: a code the person types on github.com, with nothing to copy back. */
export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
  expires_in: number
}

const LOGIN = (process.env.SCB_E2E === '1' && process.env.SCB_GITHUB_LOGIN) || 'https://github.com'

export async function deviceStart(clientId: string, fetchImpl: typeof fetch = fetch): Promise<DeviceCode> {
  const response = await fetchImpl(`${LOGIN}/login/device/code`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, scope: 'repo workflow read:org' }) })
  const body = (await response.json().catch(() => null)) as DeviceCode | null
  if (!response.ok || !body?.device_code) throw new Error('GitHub didn’t start the sign-in. Try again in a moment.')
  return body
}

/** Waits for the person to approve on github.com, polling as fast as GitHub allows. */
export async function deviceWait(clientId: string, code: DeviceCode, signal: AbortSignal, fetchImpl: typeof fetch = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<string> {
  let interval = Math.max(1, code.interval) * 1000
  const until = Date.now() + code.expires_in * 1000
  while (Date.now() < until) {
    await sleep(interval)
    if (signal.aborted) throw new Error('Stopped.')
    const response = await fetchImpl(`${LOGIN}/login/oauth/access_token`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, device_code: code.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) })
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; interval?: number }
    if (body.access_token) return body.access_token
    if (body.error === 'slow_down') interval = (body.interval ?? interval / 1000 + 5) * 1000
    else if (body.error === 'access_denied') throw new Error('The sign-in was turned down on GitHub.')
    else if (body.error === 'expired_token') break
    else if (body.error && body.error !== 'authorization_pending') throw new Error(`GitHub said ${body.error}.`)
  }
  throw new Error('The code ran out before it was approved. Start again.')
}
