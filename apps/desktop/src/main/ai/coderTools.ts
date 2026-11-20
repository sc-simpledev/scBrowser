import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { globToRegExp } from '@scbrowser/ai'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', 'dist', 'out', 'build', 'release', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'target', '.cache', '.turbo', 'coverage'])
const MAX_READ_BYTES = 2_000_000
const MAX_OUTPUT = 30_000
const MAX_SEARCH_FILES = 4000
const MAX_SEARCH_HITS = 200
const LIST_LIMIT = 600
export const COMMAND_TIMEOUT_MS = 120_000

export class ToolError extends Error {}

/** Keeps the start and the end of long output, which is where errors and summaries usually are. */
export function clip(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text
  const half = Math.floor(max / 2)
  return `${text.slice(0, half)}\n… ${text.length - max} characters cut …\n${text.slice(-half)}`
}

/**
 * A path inside the project folder, or an error. Links are followed before checking, so a symbolic
 * link inside the folder can't lead outside it. Missing files are checked by their nearest existing folder.
 */
export async function inside(root: string, path: string): Promise<string> {
  if (path.includes('\0')) throw new ToolError('That path is not allowed.')
  const target = resolve(root, path)
  const realRoot = await realpath(root)
  let existing = target
  const rest: string[] = []
  for (;;) {
    try {
      existing = await realpath(existing)
      break
    } catch {
      const parent = dirname(existing)
      if (parent === existing) throw new ToolError('That path is outside the project folder.')
      rest.unshift(existing.slice(parent.length + 1))
      existing = parent
    }
  }
  const real = join(existing, ...rest)
  const rel = relative(realRoot, real)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ToolError('That path is outside the project folder.')
  return real
}

export const shown = (root: string, full: string) => relative(root, full).split(sep).join('/') || '.'

export async function listFiles(folder: string, path: string): Promise<string> {
  const root = await realpath(folder)
  const start = await inside(root, path)
  const lines: string[] = []
  const walk = async (dir: string, depth: number) => {
    const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])).toSorted((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (lines.length >= LIST_LIMIT) return
      const full = join(dir, entry.name)
      const indent = '  '.repeat(depth)
      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/${SKIP_DIRS.has(entry.name) ? ' (skipped)' : ''}`)
        if (depth < 1 && !SKIP_DIRS.has(entry.name)) await walk(full, depth + 1)
      } else {
        lines.push(`${indent}${entry.name}`)
      }
    }
  }
  if (!(await stat(start)).isDirectory()) throw new ToolError(`${path} is a file. Use read for files.`)
  await walk(start, 0)
  return lines.length === 0 ? '(empty folder)' : `${shown(root, start)}/\n${lines.join('\n')}${lines.length >= LIST_LIMIT ? '\n… more not shown' : ''}`
}

export async function readText(full: string): Promise<string> {
  const info = await stat(full).catch(() => null)
  if (!info) throw new ToolError("That file doesn't exist.")
  if (info.isDirectory()) throw new ToolError('That is a folder. Use list for folders.')
  if (info.size > MAX_READ_BYTES) throw new ToolError(`That file is too large to read (${Math.round(info.size / 1024)} KB).`)
  const bytes = await readFile(full)
  if (bytes.subarray(0, 8000).includes(0)) throw new ToolError('That looks like a binary file.')
  return bytes.toString('utf8')
}

export async function readLines(root: string, path: string, offset: number, limit: number): Promise<string> {
  const text = await readText(await inside(root, path))
  const lines = text.split('\n')
  const from = Math.min(offset, Math.max(1, lines.length))
  const slice = lines.slice(from - 1, from - 1 + limit)
  const body = slice.map((line, i) => `${String(from + i).padStart(5)}  ${line}`).join('\n')
  const more = from - 1 + limit < lines.length ? `\n… ${lines.length - (from - 1 + limit)} more lines (read with offset ${from + limit})` : ''
  return clip(`${path} (${lines.length} lines)\n${body}${more}`)
}

/** Every file under the folder (skipping the usual build and dependency folders), as paths with forward slashes. */
async function walkFiles(root: string, start: string, visit: (relative: string, full: string, size: number) => boolean | Promise<boolean>): Promise<void> {
  let seen = 0
  const step = async (full: string): Promise<boolean> => {
    if (seen >= MAX_SEARCH_FILES) return false
    const info = await lstat(full).catch(() => null)
    if (!info || info.isSymbolicLink()) return true
    if (info.isDirectory()) {
      const entries = (await readdir(full).catch(() => [] as string[])).sort()
      for (const entry of entries) if (!SKIP_DIRS.has(entry) && !(await step(join(full, entry)))) return false
      return true
    }
    seen++
    return visit(shown(root, full), full, info.size)
  }
  await step(start)
}

const GLOB_LIMIT = 300

export async function globFiles(folder: string, pattern: string): Promise<string> {
  const root = await realpath(folder)
  const regex = globToRegExp(pattern)
  const found: string[] = []
  await walkFiles(root, root, (path) => {
    if (regex.test(path)) found.push(path)
    return found.length < GLOB_LIMIT
  })
  if (found.length === 0) return 'No files match.'
  return found.join('\n') + (found.length >= GLOB_LIMIT ? '\n… more not shown' : '')
}

export async function deleteFile(full: string): Promise<void> {
  const info = await stat(full).catch(() => null)
  if (!info) throw new ToolError("That file doesn't exist.")
  if (!info.isFile()) throw new ToolError('Only single files can be deleted.')
  await unlink(full)
}

export async function moveFile(from: string, to: string): Promise<void> {
  const info = await stat(from).catch(() => null)
  if (!info?.isFile()) throw new ToolError("That file doesn't exist.")
  if (await stat(to).then(() => true, () => false)) throw new ToolError('Something already exists at the new path.')
  await mkdir(dirname(to), { recursive: true })
  await rename(from, to)
}

export async function searchFiles(folder: string, path: string, pattern: string, glob: string | null = null, context = 0): Promise<string> {
  // Shown relative to the real folder, which can differ from the one given (short names on Windows, /private on Macs).
  const root = await realpath(folder)
  let regex: RegExp
  try {
    regex = new RegExp(pattern, 'i')
  } catch {
    throw new ToolError('That pattern is not a valid regular expression.')
  }
  const start = await inside(root, path)
  const only = glob ? globToRegExp(glob) : null
  const hits: string[] = []
  await walkFiles(root, start, async (name, full, size) => {
    if (size > 1_000_000 || (only && !only.test(name))) return true
    const bytes = await readFile(full).catch(() => null)
    if (!bytes || bytes.subarray(0, 4000).includes(0)) return true
    const lines = bytes.toString('utf8').split('\n')
    let shownTo = -1
    for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++) {
      if (!regex.test(lines[i]!)) continue
      if (context === 0) {
        hits.push(`${name}:${i + 1}: ${lines[i]!.trim().slice(0, 240)}`)
        continue
      }
      // With context, nearby lines come too, as grep -C does, and runs that touch share one block.
      const from = Math.max(shownTo + 1, i - context)
      if (shownTo !== -1 && from > shownTo + 1) hits.push('--')
      for (let j = from; j <= Math.min(lines.length - 1, i + context); j++) hits.push(`${name}${j === i ? ':' : '-'}${j + 1}${j === i ? ':' : '-'} ${lines[j]!.slice(0, 240)}`)
      shownTo = Math.min(lines.length - 1, i + context)
    }
    return hits.length < MAX_SEARCH_HITS
  })
  if (hits.length === 0) return 'No matches.'
  return clip(hits.join('\n') + (hits.length >= MAX_SEARCH_HITS ? '\n… more matches not shown' : ''))
}

/** Several edits in order. One that fails leaves the file as it was, and says which. */
export function applyEdits(text: string, edits: { find: string; replace: string }[]): string {
  return edits.reduce((current, { find, replace }, index) => {
    try {
      return applyEdit(current, find, replace)
    } catch (error) {
      if (edits.length === 1 || !(error instanceof ToolError)) throw error
      throw new ToolError(`Edit ${index + 1} of ${edits.length}: ${error.message} Nothing was changed.`)
    }
  }, text)
}

/** Where `find` occurs, forgiving a difference in leading whitespace when the exact text isn't there. */
export function applyEdit(text: string, find: string, replace: string): string {
  const first = text.indexOf(find)
  if (first !== -1) {
    if (text.indexOf(find, first + 1) !== -1) throw new ToolError('"find" matches more than one place. Include more lines around it.')
    return text.slice(0, first) + replace + text.slice(first + find.length)
  }
  const strip = (lines: string[]) => lines.map((line) => line.trim()).join('\n')
  const wanted = strip(find.split('\n'))
  const lines = text.split('\n')
  const size = find.split('\n').length
  const found: number[] = []
  for (let i = 0; i + size <= lines.length; i++) if (strip(lines.slice(i, i + size)) === wanted) found.push(i)
  if (found.length === 0) throw new ToolError('"find" was not found in the file. Read the file again and copy the text exactly.')
  if (found.length > 1) throw new ToolError('"find" matches more than one place. Include more lines around it.')
  const at = found[0]!
  return [...lines.slice(0, at), ...replace.split('\n'), ...lines.slice(at + size)].join('\n')
}

/** A short line diff for the approval card: unchanged lines at the ends are left out. */
export function lineDiff(before: string, after: string, context = 3): string {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const from = Math.max(0, start - context)
  const out = [`@@ line ${from + 1} @@`]
  for (let i = from; i < start; i++) out.push(`  ${a[i]}`)
  for (let i = start; i < endA; i++) out.push(`- ${a[i]}`)
  for (let i = start; i < endB; i++) out.push(`+ ${b[i]}`)
  for (let i = endA; i < Math.min(a.length, endA + context); i++) out.push(`  ${a[i]}`)
  return clip(out.join('\n'), 20_000)
}

export async function writeText(full: string, content: string): Promise<void> {
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf8')
}

/** Inherited from an AppImage or Electron, which would break programs run from here. */
const DROPPED_ENV = /^(ELECTRON_|APPDIR$|APPIMAGE$|ARGV0$|CHROME_DESKTOP$|GDK_PIXBUF_MODULE_FILE$|GIO_EXTRA_MODULES$|GSETTINGS_SCHEMA_DIR$|QT_PLUGIN_PATH$|PERLLIB$|PYTHONHOME$)/

/** Folders the person's login shell adds to PATH (nvm, volta, ~/.local/bin), which an app started from a menu doesn't get. */
let loginFolders: string[] = []

/**
 * Asks the person's login shell for its PATH, once, so `npx`, `uvx` and project tools installed
 * through nvm and the like are found when scTerra was started from the desktop rather than a
 * terminal. Never on Windows. A shell that prints things on start is fine: the PATH is marked.
 */
export function primeLoginPath(run: (shell: string, args: string[]) => Promise<string> = shellOutput): Promise<void> {
  if (process.platform === 'win32' || process.env.SCB_E2E === '1') return Promise.resolve()
  const shell = process.env.SHELL && /^\/[\w/.-]+$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/sh'
  return run(shell, ['-ilc', 'printf "\\n__SCTERRA_PATH__%s\\n" "$PATH"'])
    .then((out) => {
      const line = out.split('\n').find((one) => one.startsWith('__SCTERRA_PATH__'))
      loginFolders = line ? line.slice('__SCTERRA_PATH__'.length).split(':').filter((folder) => folder.startsWith('/')) : []
    })
    .catch(() => undefined)
}

function shellOutput(shell: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(shell, args, { timeout: 4000, env: { ...process.env, TERM: 'dumb' }, windowsHide: true }, (error, stdout) => (error && !stdout ? reject(error) : resolve(String(stdout))))
  })
}

export function commandEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) if (!DROPPED_ENV.test(key)) clean[key] = value
  // An AppImage puts its own libraries first, which other programs mustn't load.
  if (env.APPDIR && clean.LD_LIBRARY_PATH) {
    const kept = clean.LD_LIBRARY_PATH.split(':').filter((part) => part && !part.startsWith(env.APPDIR!))
    if (kept.length > 0) clean.LD_LIBRARY_PATH = kept.join(':')
    else delete clean.LD_LIBRARY_PATH
  }
  if (env.APPDIR && clean.PATH) clean.PATH = clean.PATH.split(':').filter((part) => !part.startsWith(env.APPDIR!)).join(':')
  if (loginFolders.length && process.platform !== 'win32') {
    const have = (clean.PATH ?? '').split(':').filter(Boolean)
    clean.PATH = [...have, ...loginFolders.filter((folder) => !have.includes(folder) && !(env.APPDIR && folder.startsWith(env.APPDIR)))].join(':')
  }
  return clean
}

/** How commands are fenced in: not at all, only able to write in the project, or that with no network too. */
export type SandboxMode = 'off' | 'project' | 'offline' | 'container'

let bwrapPath: string | null | undefined
const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
/** Linux with bubblewrap installed, or a Mac, which has sandbox-exec built in. */
export function sandboxAvailable(): boolean {
  if (process.platform === 'darwin') return existsSync(SANDBOX_EXEC)
  if (process.platform !== 'linux') return false
  if (bwrapPath === undefined) bwrapPath = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'].find((path) => existsSync(path)) ?? null
  return bwrapPath !== null
}

/** A program on PATH (the login shell's too), or null. */
export function findProgram(name: string, root?: string): string | null {
  const windows = process.platform === 'win32'
  const dirs = [...(root ? [join(root, 'node_modules', '.bin')] : []), ...(commandEnv().PATH ?? '').split(windows ? ';' : ':')].filter(Boolean)
  for (const dir of dirs) for (const ext of windows ? ['.cmd', '.exe', ''] : ['']) if (existsSync(join(dir, name + ext))) return join(dir, name + ext)
  return null
}

/** The project has a dev container and the devcontainer CLI is installed, so commands can run inside it. */
export function devContainerAvailable(root: string | null): boolean {
  if (!root) return false
  return (existsSync(join(root, '.devcontainer', 'devcontainer.json')) || existsSync(join(root, '.devcontainer.json'))) && findProgram('devcontainer', root) !== null
}

/** Dev containers started this run, by project, so `devcontainer up` happens once. */
const containers = new Map<string, Promise<void>>()

/** Starts the project's dev container if it isn't running. The first time can take minutes, for the image. */
export function ensureContainer(root: string): Promise<void> {
  let up = containers.get(root)
  if (!up) {
    const cli = findProgram('devcontainer', root)
    up = new Promise<void>((resolve, reject) => {
      if (!cli) return reject(new ToolError('The devcontainer CLI isn’t installed (npm install -g @devcontainers/cli).'))
      execFile(cli, ['up', '--workspace-folder', root], { cwd: root, env: commandEnv(), timeout: 15 * 60_000, maxBuffer: 20_000_000, windowsHide: true }, (error, _stdout, stderr) => (error ? reject(new ToolError(`The dev container didn’t start: ${String(stderr).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`)) : resolve()))
    })
    containers.set(root, up)
    up.catch(() => containers.delete(root))
  }
  return up
}

/** A path in a sandbox-exec profile's quotes. */
const profilePath = (path: string) => `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** macOS's own sandbox: everything readable, writes only where a build needs them, and optionally no network. */
function macProfile(root: string, temp: string, caches: string[], offline: boolean): string {
  // Only the project, a temporary folder of its own and build caches: macOS's shared temporary folders are other apps' too.
  const writable = [root, temp, ...caches].map((path) => `(subpath ${profilePath(path)})`).join(' ')
  return ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* ${writable} (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))`, ...(offline ? ['(deny network-outbound (remote ip))'] : [])].join('\n')
}

let macTemp: string | null = null
/** A temporary folder for sandboxed commands, made once, as its real path (the profile matches real paths). */
function sandboxTemp(): string {
  if (!macTemp) macTemp = realpathSync(mkdtempSync(join(tmpdir(), 'scterra-sandbox-')))
  return macTemp
}

/** Caches package managers and build tools write to, which a sandboxed build still needs. */
const WRITABLE_CACHES = ['.cache', '.npm', '.pnpm-store', '.local/share/pnpm', '.yarn', '.bun', '.cargo', '.rustup', 'go', '.m2', '.gradle', '.nuget', '.deno']

/**
 * The program and arguments that run `command` in the person's shell, inside bubblewrap when asked:
 * the whole system readable, but only the project, the temporary folder and build caches writable,
 * and with `offline` no network at all.
 */
export function shellCommand(root: string, command: string, sandbox: SandboxMode = 'off'): { file: string; args: string[] } {
  const windows = process.platform === 'win32'
  const shell = windows ? (process.env.ComSpec ?? 'cmd.exe') : (process.env.SHELL || '/bin/bash')
  const args = windows ? ['/d', '/s', '/c', command] : ['-lc', command]
  if (sandbox === 'container') {
    const cli = findProgram('devcontainer', root)
    if (cli) return { file: cli, args: ['exec', '--workspace-folder', root, 'sh', '-lc', command] }
    return { file: shell, args }
  }
  if (sandbox === 'off' || !sandboxAvailable()) return { file: shell, args }
  const home = homedir()
  const caches = WRITABLE_CACHES.map((name) => join(home, name)).filter((path) => existsSync(path))
  if (process.platform === 'darwin') {
    const temp = sandboxTemp()
    const real = (path: string) => (existsSync(path) ? realpathSync(path) : path)
    return { file: SANDBOX_EXEC, args: ['-p', macProfile(real(root), temp, caches.map(real), sandbox === 'offline'), '/usr/bin/env', `TMPDIR=${temp}/`, shell, ...args] }
  }
  return {
    file: bwrapPath!,
    args: [
      '--ro-bind', '/', '/',
      '--dev', '/dev',
      '--proc', '/proc',
      '--tmpfs', '/tmp',
      ...caches.flatMap((path) => ['--bind', path, path]),
      '--bind', root, root,
      '--chdir', root,
      '--die-with-parent',
      ...(sandbox === 'offline' ? ['--unshare-net'] : []),
      '--', shell, ...args
    ]
  }
}

export interface ShellOptions {
  signal: AbortSignal
  timeoutMs?: number
  sandbox?: SandboxMode
  /** Each piece of output as it arrives. */
  onOutput?: (text: string) => void
  env?: NodeJS.ProcessEnv
}

/** Runs through the person's own shell in the project folder, and is stopped after two minutes or on request. */
export function runCommand(root: string, command: string, signal: AbortSignal, timeoutMs = COMMAND_TIMEOUT_MS, options: Omit<ShellOptions, 'signal' | 'timeoutMs'> = {}): Promise<{ ok: boolean; output: string; code: number | null }> {
  // In a dev container, the container comes up first, once.
  if (options.sandbox === 'container')
    return ensureContainer(root).then(
      () => runShell(root, command, signal, timeoutMs, options),
      (error: unknown) => ({ ok: false, output: error instanceof Error ? error.message : 'The dev container didn’t start.', code: null })
    )
  return runShell(root, command, signal, timeoutMs, options)
}

function runShell(root: string, command: string, signal: AbortSignal, timeoutMs: number, options: Omit<ShellOptions, 'signal' | 'timeoutMs'>): Promise<{ ok: boolean; output: string; code: number | null }> {
  return new Promise((done) => {
    const windows = process.platform === 'win32'
    const { file, args } = shellCommand(root, command, options.sandbox)
    let output = ''
    let finished = false
    const child = spawn(file, args, { cwd: root, env: { ...commandEnv(), ...options.env }, detached: !windows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const add = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      output += text
      options.onOutput?.(text)
      // Holds on to a little more than gets shown, which keeps the tail.
      if (output.length > MAX_OUTPUT * 4) output = output.slice(0, MAX_OUTPUT) + output.slice(-MAX_OUTPUT * 2)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const kill = () => killTree(child)
    const timer = setTimeout(() => {
      output += `\n(stopped after ${Math.round(timeoutMs / 1000)} seconds)`
      kill()
    }, timeoutMs)
    const onAbort = () => {
      output += '\n(stopped)'
      kill()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const finish = (code: number | null, error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      const status = error ? `\n(couldn't start: ${error.message})` : `\n(exit code ${code ?? 'none'})`
      done({ ok: !error && code === 0, output: clip(output.trimEnd() + status), code })
    }
    child.on('error', (error) => finish(null, error))
    child.on('close', (code) => finish(code))
  })
}

/** Stops a command and everything it started. */
export function killTree(child: ChildProcess): void {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    else if (child.pid) process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}
