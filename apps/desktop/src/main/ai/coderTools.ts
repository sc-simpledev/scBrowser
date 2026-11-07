import { spawn } from 'node:child_process'
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
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

export async function listFiles(root: string, path: string): Promise<string> {
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

export async function searchFiles(root: string, path: string, pattern: string): Promise<string> {
  let regex: RegExp
  try {
    regex = new RegExp(pattern, 'i')
  } catch {
    throw new ToolError('That pattern is not a valid regular expression.')
  }
  const start = await inside(root, path)
  const hits: string[] = []
  let files = 0
  const visit = async (full: string) => {
    if (hits.length >= MAX_SEARCH_HITS || files >= MAX_SEARCH_FILES) return
    const info = await lstat(full).catch(() => null)
    if (!info || info.isSymbolicLink()) return
    if (info.isDirectory()) {
      for (const entry of await readdir(full).catch(() => [] as string[])) if (!SKIP_DIRS.has(entry)) await visit(join(full, entry))
      return
    }
    if (info.size > 1_000_000) return
    files++
    const bytes = await readFile(full).catch(() => null)
    if (!bytes || bytes.subarray(0, 4000).includes(0)) return
    const lines = bytes.toString('utf8').split('\n')
    for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++) {
      if (regex.test(lines[i]!)) hits.push(`${shown(root, full)}:${i + 1}: ${lines[i]!.trim().slice(0, 240)}`)
    }
  }
  await visit(start)
  if (hits.length === 0) return 'No matches.'
  return clip(hits.join('\n') + (hits.length >= MAX_SEARCH_HITS ? '\n… more matches not shown' : ''))
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
  return clean
}

/** Runs through the person's own shell in the project folder, and is stopped after two minutes or on request. */
export function runCommand(root: string, command: string, signal: AbortSignal, timeoutMs = COMMAND_TIMEOUT_MS): Promise<{ ok: boolean; output: string }> {
  return new Promise((done) => {
    const windows = process.platform === 'win32'
    const shell = windows ? (process.env.ComSpec ?? 'cmd.exe') : (process.env.SHELL || '/bin/bash')
    const args = windows ? ['/d', '/s', '/c', command] : ['-lc', command]
    let output = ''
    let finished = false
    const child = spawn(shell, args, { cwd: root, env: commandEnv(), detached: !windows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const add = (chunk: Buffer) => {
      output += chunk.toString('utf8')
      // Holds on to a little more than gets shown, which keeps the tail.
      if (output.length > MAX_OUTPUT * 4) output = output.slice(0, MAX_OUTPUT) + output.slice(-MAX_OUTPUT * 2)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const kill = () => {
      try {
        if (windows) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
        else if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
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
      done({ ok: !error && code === 0, output: clip(output.trimEnd() + status) })
    }
    child.on('error', (error) => finish(null, error))
    child.on('close', (code) => finish(code))
  })
}
