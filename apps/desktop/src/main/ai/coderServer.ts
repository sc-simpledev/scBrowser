import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { CLOUD_SECRET, type CoderCloudRun, type CoderEvent, type CoderServerCheck } from '@scbrowser/shared'
import { git } from './coder'
import { eventsFromLog, type CloudTask } from './coderCloud'

/**
 * Terra Code on a server of the person's own, over SSH, instead of GitHub Actions. The same runner
 * as a cloud run starts there with nohup, so it carries on with this computer off. It needs ssh
 * with a key (nothing is ever typed into it), and git and Node 20 or newer on the server. The
 * project goes there as a git bundle of the folder as it is now, uncommitted changes too, and the
 * work comes back the same way, as a bundle over the same SSH. Nothing touches GitHub unless the
 * person asks the server to push its branch.
 */

export interface ServerTarget {
  /** `user@host`, a name from ~/.ssh/config, or an address. */
  host: string
  port: number | null
}

/** Where runs live on the server, under its home folder. */
const RUNS_DIR = '.scterra/runs'
const CONNECT_SECONDS = 15
/** Runs older than this are cleared away when the next one starts. */
const KEEP_DAYS = 14

/**
 * Reads what the person typed for their server. Anything ssh could take as an option (a leading
 * dash) or a shell could read as more than a name is refused, as it ends up on ssh's command line.
 */
export function parseServer(text: string): ServerTarget | null {
  const value = text.trim()
  if (!value || value.startsWith('-') || value.length > 255) return null
  const match = /^((?:[A-Za-z0-9._~][A-Za-z0-9._~-]*)@)?([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::(\d{1,5}))?$/.exec(value)
  if (!match || match[2]!.startsWith('-')) return null
  const port = match[3] ? Number(match[3]) : null
  if (port !== null && (port < 1 || port > 65_535)) return null
  return { host: `${match[1] ?? ''}${match[2]}`, port }
}

/** The server as the person would recognise it. */
export const serverName = (target: ServerTarget) => (target.port ? `${target.host}:${target.port}` : target.host)

export function sshArgs(target: ServerTarget): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${CONNECT_SECONDS}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=30',
    ...(target.port ? ['-p', String(target.port)] : []),
    target.host
  ]
}

/** Whatever the login shell is, the script runs in bash where there is one, else sh. */
const REMOTE_SHELL = `sh -c 'if command -v bash >/dev/null 2>&1; then exec bash -s; else exec sh -s; fi'`

/**
 * A non-interactive SSH session doesn't read the files that put Node on PATH for nvm, Volta, fnm
 * or Homebrew, so the script looks in the usual places first.
 */
const PRELUDE = `for f in "$HOME/.profile" "$HOME/.nvm/nvm.sh"; do [ -f "$f" ] && . "$f" >/dev/null 2>&1; done
PATH="$HOME/.volta/bin:$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/.fnm/aliases/default/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
`

/** Text in single quotes for the remote shell. */
export const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

export interface SshResult {
  code: number
  stdout: string
  stderr: string
}

export type SshRunner = (args: string[], input: string | Readable | null, timeoutMs: number, output?: NodeJS.WritableStream) => Promise<SshResult>

/** The system's own ssh. Tests may point `SCB_SSH` at a stand-in that runs the command locally. */
export const runSsh: SshRunner = (args, input, timeoutMs, output) =>
  new Promise((resolve, reject) => {
    const program = (process.env.SCB_E2E === '1' || process.env.VITEST) && process.env.SCB_SSH ? process.env.SCB_SSH : 'ssh'
    const child = spawn(program, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => (output ? output.write(chunk) : (stdout += chunk.toString('utf8'))))
    child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString('utf8')).slice(-20_000)))
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(error.code === 'ENOENT' ? 'ssh isn’t installed on this computer, so scTerra can’t reach a server.' : error.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (output && 'end' in output) (output as NodeJS.WritableStream).end()
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.stdin.on('error', () => undefined)
    if (typeof input === 'string') child.stdin.end(input)
    else if (input) input.pipe(child.stdin)
    else child.stdin.end()
  })

/** What ssh said when it couldn't get in, in a sentence. */
function sshProblem(target: ServerTarget, result: SshResult): string {
  const said = result.stderr.trim().split('\n').filter((line) => line && !/^Warning: Permanently added/.test(line)).at(-1) ?? ''
  if (/Permission denied/i.test(said)) return `${serverName(target)} didn’t accept this computer’s SSH key. Add it to the server’s authorized_keys (ssh-copy-id ${target.host}), as scTerra never types passwords.`
  if (/Could not resolve hostname/i.test(said)) return `No server called ${target.host} could be found.`
  if (/timed out|No route to host|Connection refused|Network is unreachable/i.test(said)) return `${serverName(target)} didn’t answer: ${said.replace(/^ssh: /, '')}`
  if (/Host key verification failed/i.test(said)) return `${serverName(target)}’s host key has changed since this computer last connected. If that’s expected, fix it in ~/.ssh/known_hosts.`
  return said ? `Couldn’t reach ${serverName(target)}: ${said.replace(/^ssh: /, '').slice(0, 300)}` : `Couldn’t reach ${serverName(target)}.`
}

/** A version string like v22.3.0, as a major number. */
const nodeMajor = (version: string) => Number(/^v?(\d+)\./.exec(version.trim())?.[1] ?? 0)

export interface CoderServerDeps {
  runner: () => Promise<string>
  ssh?: SshRunner
}

/** What the run on the server looks like from here, after one look. */
export interface ServerStatus {
  state: CoderCloudRun['state']
  summary: string | null
  error: string | null
  pushed: boolean
  live: string[]
}

export class CoderServer {
  private readonly ssh: SshRunner

  constructor(private readonly deps: CoderServerDeps) {
    this.ssh = deps.ssh ?? runSsh
  }

  private async script(target: ServerTarget, body: string, timeoutMs = 60_000): Promise<SshResult> {
    const result = await this.ssh([...sshArgs(target), REMOTE_SHELL], `${PRELUDE}${body}\n`, timeoutMs)
    // 255 is ssh's own failure: it never got in.
    if (result.code === 255) throw new Error(sshProblem(target, result))
    return result
  }

  /** Can scTerra get in without a password, and is there git and Node 20 or newer? */
  async check(text: string): Promise<CoderServerCheck> {
    const target = parseServer(text)
    if (!target) return { ok: false, message: 'Write it as user@host, or a name from your ~/.ssh/config. Add :port for a port other than 22.', node: null, git: null, system: null }
    let result: SshResult
    try {
      result = await this.script(target, `printf 'node=%s\\n' "$(node --version 2>/dev/null)"\nprintf 'git=%s\\n' "$(git --version 2>/dev/null)"\nprintf 'system=%s\\n' "$(uname -sm 2>/dev/null)"`, (CONNECT_SECONDS + 15) * 1000)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Couldn’t reach the server.', node: null, git: null, system: null }
    }
    const field = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(result.stdout)?.[1]?.trim() || null
    const node = field('node')
    const gitVersion = field('git')?.replace(/^git version /, '') ?? null
    const system = field('system')
    const missing = [!gitVersion && 'git', (!node || nodeMajor(node) < 20) && (node ? `Node 20 or newer (it has ${node})` : 'Node 20 or newer')].filter(Boolean)
    return {
      ok: missing.length === 0,
      message: missing.length ? `${serverName(target)} answered, but needs ${missing.join(' and ')}.` : `Ready: ${serverName(target)} has Node ${node} and git ${gitVersion}.`,
      node,
      git: gitVersion,
      system
    }
  }

  /**
   * The folder as it is now, uncommitted changes and new files too, as one commit on top of HEAD
   * made in a throwaway index, so the person's own index and files are never touched. HEAD itself
   * when nothing has changed.
   */
  private async snapshot(folder: string, id: string, temp: string): Promise<{ commit: string; dirty: boolean }> {
    const head = await git(folder, ['rev-parse', 'HEAD'])
    if (!head) throw new Error('Terra Code sends the project to the server with git, and this folder has no commits yet. Make a first commit.')
    const index = join(temp, 'index')
    const env = { ...process.env, GIT_INDEX_FILE: index }
    const run = (args: string[]) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn('git', args, { cwd: folder, env, windowsHide: true })
        let out = ''
        let err = ''
        child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
        child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')))
        child.on('error', reject)
        child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim().split('\n').at(-1) || `git ${args[0]} failed`))))
      })
    await run(['read-tree', 'HEAD'])
    await run(['add', '-A'])
    const tree = await run(['write-tree'])
    const headTree = await git(folder, ['rev-parse', 'HEAD^{tree}'])
    if (tree === headTree) return { commit: head, dirty: false }
    const commit = await run(['-c', 'user.name=scTerra', '-c', 'user.email=scterra@localhost', 'commit-tree', tree, '-p', head, '-m', `Uncommitted changes, as they were when Terra Code run ${id} started`])
    return { commit, dirty: true }
  }

  /** Sends the project and the runner, and starts it. The key goes in through the script, never onto the server's disk. */
  async start(target: ServerTarget, folder: string, spec: CloudTask, secret: string | null): Promise<{ warning: string | null }> {
    const temp = await mkdtemp(join(tmpdir(), 'scterra-server-'))
    const ref = `refs/scterra/run-${spec.id}`
    try {
      const { commit, dirty } = await this.snapshot(folder, spec.id, temp)
      const bundle = join(temp, 'repo.bundle')
      if ((await git(folder, ['update-ref', ref, commit])) === null) throw new Error('Couldn’t mark the commit to send.')
      if ((await git(folder, ['bundle', 'create', bundle, ref], 120_000)) === null) throw new Error('Couldn’t pack the project for the server.')
      const dir = `"$HOME/${RUNS_DIR}/${spec.id}"`
      // Old runs are cleared as new ones start, so the server's disk doesn't fill up.
      const prepare = await this.script(target, `find "$HOME/${RUNS_DIR}" -mindepth 1 -maxdepth 1 -type d -mtime +${KEEP_DAYS} -exec rm -rf {} + 2>/dev/null\nmkdir -p ${dir} && echo scterra:ready`)
      if (!prepare.stdout.includes('scterra:ready')) throw new Error(`Couldn’t make a folder on ${serverName(target)}: ${prepare.stderr.trim().slice(0, 300)}`)
      const upload = async (name: string, input: string | Readable) => {
        const sent = await this.ssh([...sshArgs(target), `cat > ${dir}/${name}`], input, 10 * 60_000)
        if (sent.code !== 0) throw new Error(sent.code === 255 ? sshProblem(target, sent) : `Couldn’t send ${name} to ${serverName(target)}.`)
      }
      await upload('runner.mjs', await this.deps.runner())
      await upload('task.json', JSON.stringify(spec, null, 2))
      await upload('repo.bundle', createReadStream(bundle))
      const started = await this.script(
        target,
        `cd ${dir} || exit 1
command -v git >/dev/null 2>&1 || { echo scterra:no-git; exit 0; }
command -v node >/dev/null 2>&1 || { echo scterra:no-node; exit 0; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { echo "scterra:old-node $(node --version)"; exit 0; }
rm -rf work && git init -q work && cd work || exit 1
git fetch -q ../repo.bundle ${quoted(`${ref}:refs/heads/${spec.branch}`)} || { echo scterra:no-bundle; exit 0; }
git checkout -q ${quoted(spec.branch)} || exit 1
rm -f ../repo.bundle
${CLOUD_SECRET}=${quoted(secret ?? '')}
export ${CLOUD_SECRET}
if command -v setsid >/dev/null 2>&1; then setsid nohup node ../runner.mjs ../task.json > ../events.log 2>&1 < /dev/null &
else nohup node ../runner.mjs ../task.json > ../events.log 2>&1 < /dev/null &
fi
echo $! > ../pid
echo scterra:started`,
        5 * 60_000
      )
      const out = started.stdout
      if (out.includes('scterra:no-git')) throw new Error(`${serverName(target)} has no git. Install it there first.`)
      if (out.includes('scterra:no-node')) throw new Error(`${serverName(target)} has no Node.js. Install Node 20 or newer there first.`)
      const old = /scterra:old-node (\S+)/.exec(out)
      if (old) throw new Error(`${serverName(target)} has Node ${old[1]}, and the runner needs 20 or newer.`)
      if (out.includes('scterra:no-bundle')) throw new Error(`${serverName(target)}’s git couldn’t open the project scTerra sent.`)
      if (!out.includes('scterra:started')) throw new Error(`The run didn’t start on ${serverName(target)}: ${started.stderr.trim().split('\n').at(-1)?.slice(0, 300) ?? 'no reason given'}`)
      const branch = await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD'])
      return { warning: dirty ? `It started from your folder as it is now, uncommitted changes too, as one extra commit on ${branch && branch !== 'HEAD' ? branch : 'your last commit'}.` : null }
    } finally {
      await git(folder, ['update-ref', '-d', ref])
      await rm(temp, { recursive: true, force: true })
    }
  }

  /** One look at a run: still going, finished (and how), or gone. */
  async status(target: ServerTarget, run: CoderCloudRun): Promise<ServerStatus> {
    const result = await this.script(
      target,
      `cd "$HOME/${RUNS_DIR}/${run.id}" 2>/dev/null || { echo scterra:gone; exit 0; }
pid=$(cat pid 2>/dev/null)
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo scterra:alive; fi
if [ -f result.json ]; then printf 'scterra:result '; tr -d '\\n' < result.json; echo; fi
echo scterra:log
tail -c 200000 events.log 2>/dev/null`
    )
    const out = result.stdout
    if (out.startsWith('scterra:gone')) return { state: 'failed', summary: null, error: `The run’s folder on ${serverName(target)} is gone.`, pushed: false, live: [] }
    const log = out.slice(out.indexOf('scterra:log') + 'scterra:log'.length)
    const events = eventsFromLog(log, '')
    const live = events.flatMap((event) => (event.type === 'tool' ? [event.summary] : event.type === 'text' ? [event.text.split('\n')[0]!.slice(0, 140)] : [])).slice(-6)
    const line = /^scterra:result (.*)$/m.exec(out)?.[1]
    if (line) {
      let done: { ok?: boolean; summary?: string; error?: string | null; pushed?: boolean } = {}
      try {
        done = JSON.parse(line) as typeof done
      } catch {
        // Written by the runner in one go, so this only happens if the disk filled up.
      }
      return { state: done.ok ? 'done' : 'failed', summary: typeof done.summary === 'string' ? done.summary : null, error: done.ok ? null : typeof done.error === 'string' ? done.error : 'The run stopped with an error.', pushed: done.pushed === true, live }
    }
    if (out.includes('scterra:alive')) return { state: 'working', summary: null, error: null, pushed: false, live }
    // Gone without saying it was done: the last error it printed, or what Node said on the way out.
    const said = events.filter((event): event is Extract<CoderEvent, { type: 'error' }> => event.type === 'error').at(-1)?.message
    const tail = log.split('\n').filter((one) => one.trim() && !one.includes('[scterra-event]')).slice(-2).join(' ').slice(0, 300)
    return { state: 'failed', summary: null, error: said ? `It stopped: ${said}` : tail ? `It stopped on ${serverName(target)}: ${tail}` : `It stopped on ${serverName(target)} without saying why (the server may have restarted).`, pushed: false, live }
  }

  async events(target: ServerTarget, run: CoderCloudRun, sessionId: string): Promise<CoderEvent[]> {
    const result = await this.script(target, `tail -c 3000000 "$HOME/${RUNS_DIR}/${run.id}/events.log" 2>/dev/null`)
    return eventsFromLog(result.stdout, sessionId)
  }

  async cancel(target: ServerTarget, run: CoderCloudRun): Promise<void> {
    await this.script(target, `cd "$HOME/${RUNS_DIR}/${run.id}" 2>/dev/null || exit 0\npid=$(cat pid 2>/dev/null)\n[ -n "$pid" ] && { kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null; }\necho '{"ok":false,"error":"Cancelled."}' > result.json`)
  }

  /** Brings the run's branch here as a branch of the same name, through a bundle over SSH. */
  async fetch(target: ServerTarget, run: CoderCloudRun, folder: string): Promise<string> {
    const temp = await mkdtemp(join(tmpdir(), 'scterra-server-'))
    try {
      const file = join(temp, 'work.bundle')
      const result = await this.ssh([...sshArgs(target), REMOTE_SHELL], `${PRELUDE}cd "$HOME/${RUNS_DIR}/${run.id}/work" && git bundle create - ${quoted(`refs/heads/${run.branch}`)} 2>/dev/null\n`, 5 * 60_000, createWriteStream(file))
      if (result.code === 255) throw new Error(sshProblem(target, result))
      if (result.code !== 0) throw new Error(`${serverName(target)} no longer has this run’s work.`)
      const fetched = await git(folder, ['fetch', file, `+refs/heads/${run.branch}:refs/heads/${run.branch}`], 120_000)
      if (fetched === null) throw new Error(`Couldn’t bring ${run.branch} here. If it’s the branch you have open, switch to another first.`)
      return `Fetched ${run.branch} from ${serverName(target)}. Look at it with git diff ${run.base}...${run.branch}, or switch to it with git switch ${run.branch}.`
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
}
