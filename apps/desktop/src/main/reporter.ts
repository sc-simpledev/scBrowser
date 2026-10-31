import { scrubStack, type CrashEntry, type ReportEnvironment } from '@scbrowser/shared'
import type { SettingsStore } from './settings'
import type { KeyValueRepo } from './storage/kv'

const LOG_KEY = 'reports:crashes'
const RUNNING_KEY = 'reports:running'
const USAGE_KEY = 'reports:usage-day'
const MAX_LOG = 50
const USAGE_CHECK_MS = 60 * 60_000

export type Send = (body: unknown) => Promise<unknown>

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

/**
 * Crashes are logged on this device, where they can be read in Settings. Nothing leaves it
 * unless the matching setting is on, and then only what `CrashEntry` and the environment hold.
 */
export class Reporter {
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly settings: SettingsStore,
    private readonly environment: ReportEnvironment,
    private readonly send: Send | null
  ) {}

  start(): void {
    // Still marked as running means the last session ended without quitting.
    if (this.kv.get(RUNNING_KEY)) this.record('browser', 'unclean-exit')
    this.kv.set(RUNNING_KEY, true)
    this.sendUsage()
    this.timer = setInterval(() => this.sendUsage(), USAGE_CHECK_MS)
  }

  /** The last step of a clean exit. */
  finish(): void {
    clearInterval(this.timer)
    this.kv.set(RUNNING_KEY, false)
  }

  list(): CrashEntry[] {
    return (this.kv.get(LOG_KEY) as CrashEntry[] | undefined) ?? []
  }

  clear(): void {
    this.kv.delete(LOG_KEY)
  }

  record(kind: CrashEntry['kind'], reason: string, stack?: string): void {
    const scrubbed = scrubStack(stack)
    const entry: CrashEntry = { at: Date.now(), kind, reason, ...(scrubbed ? { stack: scrubbed } : {}) }
    this.kv.set(LOG_KEY, [entry, ...this.list()].slice(0, MAX_LOG))
    if (this.settings.get().crashReports) this.post({ type: 'crash', ...this.environment, kind, reason, stack: scrubbed })
  }

  private sendUsage(): void {
    if (!this.settings.get().usageStats || this.kv.get(USAGE_KEY) === today()) return
    this.kv.set(USAGE_KEY, today())
    this.post({ type: 'usage', ...this.environment })
  }

  private post(body: unknown): void {
    this.send?.(body).catch(() => undefined)
  }
}
