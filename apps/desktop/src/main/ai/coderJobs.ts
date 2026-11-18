import { spawn, type ChildProcess } from 'node:child_process'
import type { CoderJob } from '@scbrowser/shared'
import { clip, commandEnv, killTree, shellCommand, type SandboxMode } from './coderTools'

/** What a job keeps of its output: enough for the model to find a recent error. */
const MAX_KEPT = 400_000
const MAX_READ = 20_000
const TAIL = 1200
/** Jobs one session may have at once, so a runaway model can't start dozens of servers. */
export const MAX_JOBS = 6

interface Job {
  id: number
  command: string
  child: ChildProcess
  output: string
  /** How much of `output` the model has read. */
  read: number
  /** Characters dropped from the start of `output` to keep it in bounds. */
  dropped: number
  running: boolean
  exitCode: number | null
  waiters: (() => void)[]
}

/**
 * Commands that keep running, such as dev servers and watchers. The model starts one, reads what
 * it printed since last time, and stops it. Each session's jobs end with the session, and all of
 * them when the browser closes.
 */
export class CoderJobs {
  private readonly sessions = new Map<string, Map<number, Job>>()
  private next = 1

  constructor(private readonly onChange: (sessionId: string, jobs: CoderJob[]) => void = () => undefined) {}

  start(sessionId: string, root: string, command: string, sandbox: SandboxMode = 'off'): CoderJob {
    const jobs = this.sessions.get(sessionId) ?? new Map<number, Job>()
    this.sessions.set(sessionId, jobs)
    if ([...jobs.values()].filter((job) => job.running).length >= MAX_JOBS) throw new Error(`Only ${MAX_JOBS} background jobs can run at once. Stop one with kill first.`)
    const { file, args } = shellCommand(root, command, sandbox)
    const windows = process.platform === 'win32'
    const child = spawn(file, args, { cwd: root, env: commandEnv(), detached: !windows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const job: Job = { id: this.next++, command, child, output: '', read: 0, dropped: 0, running: true, exitCode: null, waiters: [] }
    jobs.set(job.id, job)
    let notify: ReturnType<typeof setTimeout> | null = null
    const changed = () => {
      // A chatty server mustn't flood the page, so changes go out at most every half second.
      notify ??= setTimeout(() => {
        notify = null
        this.onChange(sessionId, this.list(sessionId))
      }, 500)
    }
    const add = (chunk: Buffer) => {
      job.output += chunk.toString('utf8')
      if (job.output.length > MAX_KEPT) {
        const cut = job.output.length - MAX_KEPT
        job.output = job.output.slice(cut)
        job.dropped += cut
        job.read = Math.max(0, job.read - cut)
      }
      for (const wake of job.waiters.splice(0)) wake()
      changed()
    }
    child.stdout?.on('data', add)
    child.stderr?.on('data', add)
    const ended = (code: number | null, error?: Error) => {
      if (!job.running) return
      job.running = false
      job.exitCode = code
      if (error) job.output += `\n(couldn't start: ${error.message})`
      for (const wake of job.waiters.splice(0)) wake()
      changed()
    }
    child.on('error', (error) => ended(null, error))
    child.on('close', (code) => ended(code))
    changed()
    return view(job)
  }

  /** What it printed since the model last looked, waiting up to `waitSeconds` for something new. */
  async output(sessionId: string, id: number, waitSeconds: number, signal: AbortSignal): Promise<string> {
    const job = this.sessions.get(sessionId)?.get(id)
    if (!job) throw new Error(`There's no job ${id}. Start one with run and "background": true.`)
    if (waitSeconds > 0 && job.running && job.read >= job.output.length) {
      await new Promise<void>((done) => {
        const timer = setTimeout(done, waitSeconds * 1000)
        const wake = () => {
          clearTimeout(timer)
          // A moment more, so a burst of output arrives together.
          setTimeout(done, 300)
        }
        job.waiters.push(wake)
        signal.addEventListener('abort', () => (clearTimeout(timer), done()), { once: true })
      })
    }
    const fresh = job.output.slice(job.read)
    job.read = job.output.length
    const state = job.running ? `(job ${id} is still running)` : `(job ${id} has ended, exit code ${job.exitCode ?? 'none'})`
    return `${fresh ? clip(fresh.trimEnd(), MAX_READ) : '(nothing new)'}\n${state}`
  }

  kill(sessionId: string, id: number): string {
    const job = this.sessions.get(sessionId)?.get(id)
    if (!job) throw new Error(`There's no job ${id}.`)
    if (!job.running) return `Job ${id} had already ended.`
    killTree(job.child)
    return `Stopped job ${id}.`
  }

  list(sessionId: string): CoderJob[] {
    return [...(this.sessions.get(sessionId)?.values() ?? [])].map(view)
  }

  /** What the model is reminded of each step: which jobs are running. */
  summary(sessionId: string): string {
    const running = this.list(sessionId).filter((job) => job.running)
    return running.length ? `(Background jobs still running: ${running.map((job) => `${job.id} \`${job.command}\``).join(', ')}.)` : ''
  }

  stopAll(sessionId?: string): void {
    const sessions = sessionId === undefined ? [...this.sessions.keys()] : [sessionId]
    for (const id of sessions) {
      for (const job of this.sessions.get(id)?.values() ?? []) if (job.running) killTree(job.child)
      this.sessions.delete(id)
    }
  }
}

const view = (job: Job): CoderJob => ({ id: job.id, command: job.command, running: job.running, exitCode: job.exitCode, tail: job.output.slice(-TAIL) })
