import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatMessage } from '@scbrowser/ai'
import { commandEnv } from './coderTools'

/** A session's id comes from the page, so it only ever names a file through a hash. */
const nameOf = (sessionId: string) => createHash('sha256').update(sessionId).digest('hex').slice(0, 40)

const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024
const KEEP_DAYS = 30

/** What's needed to carry a Terra Code session on after a restart, with its undo. */
export interface CoderCheckpoint {
  version: 1
  folder: string
  native: boolean
  introduced: boolean
  messages: ChatMessage[]
  originals: [string, string | null][]
  /** Files whose earlier version isn't text, as the snapshot object that holds them. */
  opaque: [string, string][]
  seen: [string, number][]
}

export class CoderCheckpoints {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string) {}

  private path(sessionId: string): string {
    return join(this.dir, `${nameOf(sessionId)}.json`)
  }

  /** Saves run one at a time, and a partly written file never replaces a good one. */
  save(sessionId: string, checkpoint: CoderCheckpoint): Promise<void> {
    const write = async () => {
      const text = JSON.stringify(checkpoint)
      if (Buffer.byteLength(text) > MAX_CHECKPOINT_BYTES) return
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      const path = this.path(sessionId)
      const partial = `${path}.partial`
      await writeFile(partial, text, { encoding: 'utf8', mode: 0o600 })
      await rename(partial, path)
    }
    const done = this.queue.then(write, write)
    this.queue = done.catch(() => undefined)
    return done
  }

  async load(sessionId: string): Promise<CoderCheckpoint | null> {
    await this.queue
    try {
      const data = JSON.parse(await readFile(this.path(sessionId), 'utf8')) as CoderCheckpoint
      return data.version === 1 && typeof data.folder === 'string' && Array.isArray(data.messages) && Array.isArray(data.originals) ? data : null
    } catch {
      return null
    }
  }

  async remove(sessionId: string): Promise<void> {
    await this.queue
    await rm(this.path(sessionId), { force: true })
  }

  async clear(): Promise<void> {
    await this.queue
    await rm(this.dir, { recursive: true, force: true })
  }

  async prune(now = Date.now()): Promise<void> {
    await pruneOlder(this.dir, now)
  }
}

async function pruneOlder(dir: string, now: number): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    const path = join(dir, name)
    const info = await stat(path).catch(() => null)
    if (info && now - info.mtimeMs > KEEP_DAYS * 86_400_000) await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Never worth keeping a copy of, even in a project that doesn't ignore them. */
const NEVER_SNAPSHOT = ['.git/', 'node_modules/', '.venv/', 'venv/', '__pycache__/', 'dist/', 'build/', 'out/', 'target/', '.next/', '.nuxt/', '.turbo/', '.cache/', '.gradle/', 'vendor/bundle/']
const CONFIG = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'core.hooksPath=/dev/null']
/** A folder this slow to scan is probably a home directory, not a project. */
const SNAPSHOT_MS = 30_000
const SHOW_BYTES = 64 * 1024 * 1024
/** How many files one command's changes are recorded for. */
export const MAX_COMMAND_FILES = 2000

export interface SnapshotChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
}

/**
 * Copies of a project kept outside it, in a private git repository of their own, so that what a
 * command changed can be found and put back. This never touches the project's own .git, index or
 * branches, and works for folders that aren't git projects at all.
 */
export class CoderSnapshots {
  constructor(private readonly dir: string) {}

  private gitDir(sessionId: string): string {
    return join(this.dir, nameOf(sessionId), '.git')
  }

  private git(sessionId: string, folder: string, args: string[], timeout = SNAPSHOT_MS): Promise<Buffer | null> {
    const env = commandEnv()
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
    return new Promise((done) =>
      execFile('git', [`--git-dir=${this.gitDir(sessionId)}`, `--work-tree=${folder}`, ...CONFIG, ...args], { cwd: folder, env, timeout, windowsHide: true, maxBuffer: SHOW_BYTES, encoding: 'buffer' }, (error, stdout) => done(error ? null : stdout))
    )
  }

  private async ensure(sessionId: string, folder: string): Promise<boolean> {
    const gitDir = this.gitDir(sessionId)
    if (await stat(join(gitDir, 'HEAD')).then(() => true, () => false)) return true
    await mkdir(join(this.dir, nameOf(sessionId)), { recursive: true, mode: 0o700 })
    if ((await this.git(sessionId, folder, ['init', '-q'])) === null) return false
    await mkdir(join(gitDir, 'info'), { recursive: true })
    await writeFile(join(gitDir, 'info', 'exclude'), `${NEVER_SNAPSHOT.join('\n')}\n`)
    return true
  }

  /** The project as it is now, or null if that can't be recorded (no git, or too big). */
  async take(sessionId: string, folder: string): Promise<string | null> {
    if (!(await this.ensure(sessionId, folder))) return null
    if ((await this.git(sessionId, folder, ['add', '-A', '--ignore-errors'])) === null) return null
    const tree = await this.git(sessionId, folder, ['write-tree'])
    return tree && tree.toString('utf8').trim()
  }

  async changed(sessionId: string, folder: string, before: string, after: string): Promise<SnapshotChange[]> {
    if (before === after) return []
    const out = await this.git(sessionId, folder, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', before, after])
    if (!out) return []
    const parts = out.toString('utf8').split('\0')
    const found: SnapshotChange[] = []
    for (let i = 0; i + 1 < parts.length; i += 2) found.push({ path: parts[i + 1]!, status: parts[i] === 'A' ? 'added' : parts[i] === 'D' ? 'deleted' : 'modified' })
    return found
  }

  /** The contents of `object`, such as `<tree>:src/app.ts`. */
  show(sessionId: string, folder: string, object: string): Promise<Buffer | null> {
    return this.git(sessionId, folder, ['cat-file', 'blob', object])
  }

  async remove(sessionId: string): Promise<void> {
    await rm(join(this.dir, nameOf(sessionId)), { recursive: true, force: true })
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true })
  }

  async prune(now = Date.now()): Promise<void> {
    await pruneOlder(this.dir, now)
  }
}

/** Whether these bytes can be kept and compared as text without losing anything. */
export function asText(bytes: Buffer, max = 2_000_000): string | null {
  if (bytes.length > max || bytes.includes(0)) return null
  const text = bytes.toString('utf8')
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null
}
