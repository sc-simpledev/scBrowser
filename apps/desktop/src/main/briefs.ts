import { randomUUID } from 'node:crypto'
import { withContext, type PageContext } from '@scbrowser/ai'
import {
  BRIEF_ASK_PROMPT,
  BRIEF_PAGES,
  BRIEF_TOKENS,
  briefQuestion,
  MAX_BRIEF_QUESTION,
  previousBriefNote,
  briefPrompt,
  briefQuery,
  briefTitle,
  DEFAULT_BRIEF_PREFS,
  HOSTED_BRIEFS_PER_DAY,
  localDay,
  MAX_BRIEF_ISSUES,
  MAX_BRIEF_SCHEDULES,
  MAX_BRIEF_TEXT,
  MAX_ISSUES_PER_SCHEDULE,
  nextBriefRun,
  type BriefInput,
  type BriefIssue,
  type BriefPrefs,
  type BriefSchedule,
  type BriefState,
  type BriefSummary,
  type CitationSource
} from '@scbrowser/shared'
import type { Recency } from './ai/webSearch'
import type { KeyValueRepo } from './storage/kv'

const SCHEDULES_KEY = 'briefs:schedules'
const ISSUES_KEY = 'briefs:issues'
const PREFS_KEY = 'briefs:prefs'
const HOSTED_KEY = 'briefs:hosted-usage'
/** The newest brief already opened by itself at a start, so the same one isn't opened every time. */
const SHOWN_KEY = 'briefs:shown-at-start'

const TICK_MS = 60_000
/** Soon after starting, so a brief missed while scTerra was closed is ready quickly. */
const FIRST_TICK_MS = 15_000
/** A brief finished this soon after starting counts as one the person opened scTerra to. */
export const STARTUP_WINDOW_MS = 5 * 60_000
/** A failed run tries again after this, a few times, before waiting for its next time. */
const RETRY_MS = 30 * 60_000
const MAX_RETRIES = 3

export class BriefLimitError extends Error {}

export interface BriefDeps {
  kv: KeyValueRepo
  /** Whether the chat model is scTerra AI, or null when no model is chosen. */
  hosted: () => boolean | null
  write: (system: string, user: string, maxTokens: number) => Promise<string>
  search: (query: string, options: { recency: Recency; read: number; sites: string[] }) => Promise<PageContext[]>
  online: () => boolean
  onChange: (summary: BriefSummary) => void
  /** A brief has just been written. `startup` when it was soon after scTerra opened. */
  onReady: (issue: BriefIssue, startup: boolean) => void
  now?: () => number
  /** Off in tests, which call `tick` themselves. */
  timers?: boolean
}

/**
 * Runs the person's briefs at their times, one at a time: a web search on the topic, then one
 * request to their chat model. Nothing runs unless the person set the brief up.
 */
export class BriefService {
  private readonly running = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly retries = new Map<string, number>()
  private readonly startedAt: number
  private readonly timers: ReturnType<typeof setTimeout>[] = []

  constructor(private readonly deps: BriefDeps) {
    this.startedAt = this.now()
    if (deps.timers !== false) {
      const first = setTimeout(() => void this.tick(), FIRST_TICK_MS)
      const every = setInterval(() => void this.tick(), TICK_MS)
      first.unref?.()
      every.unref?.()
      this.timers.push(first, every)
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  schedules(): BriefSchedule[] {
    const saved = this.deps.kv.get(SCHEDULES_KEY)
    return Array.isArray(saved) ? (saved as BriefSchedule[]) : []
  }

  issues(): BriefIssue[] {
    const saved = this.deps.kv.get(ISSUES_KEY)
    return Array.isArray(saved) ? (saved as BriefIssue[]) : []
  }

  prefs(): BriefPrefs {
    const saved = this.deps.kv.get(PREFS_KEY)
    return { ...DEFAULT_BRIEF_PREFS, ...(saved && typeof saved === 'object' ? (saved as Partial<BriefPrefs>) : {}) }
  }

  /** Briefs used today on scTerra AI. */
  hostedUsed(): number {
    const saved = this.deps.kv.get(HOSTED_KEY) as { day?: string; count?: number } | undefined
    return saved?.day === localDay(this.now()) && Number.isInteger(saved.count) ? saved.count! : 0
  }

  state(): BriefState {
    return {
      schedules: this.schedules(),
      issues: this.issues(),
      running: [...this.running],
      prefs: this.prefs(),
      hosted: this.deps.hosted(),
      hostedLeft: Math.max(0, HOSTED_BRIEFS_PER_DAY - this.hostedUsed())
    }
  }

  summary(): BriefSummary {
    const unseen = this.issues().filter((issue) => issue.unseen)
    const latest = unseen[0] ?? null
    return { unseen: unseen.length, latest: latest && { id: latest.id, title: latest.title, createdAt: latest.createdAt } }
  }

  private saveSchedules(schedules: BriefSchedule[]): void {
    this.deps.kv.set(SCHEDULES_KEY, schedules)
  }

  private saveIssues(issues: BriefIssue[]): void {
    this.deps.kv.set(ISSUES_KEY, issues)
    this.deps.onChange(this.summary())
  }

  private patch(id: string, change: Partial<BriefSchedule>): void {
    this.saveSchedules(this.schedules().map((schedule) => (schedule.id === id ? { ...schedule, ...change } : schedule)))
  }

  save(id: string | null, input: BriefInput): BriefSchedule {
    const now = this.now()
    const topic = input.topic.replace(/\s+/g, ' ').trim()
    const title = input.title.trim() || briefTitle(topic)
    const fields = { title, topic, time: input.time, frequency: input.frequency, weekday: input.weekday, length: input.length, sites: input.sites ?? [], onlyNew: input.onlyNew ?? false }
    const schedules = this.schedules()
    if (id === null) {
      if (schedules.length >= MAX_BRIEF_SCHEDULES) throw new Error(`You can have ${MAX_BRIEF_SCHEDULES} briefs at most.`)
      const schedule: BriefSchedule = { id: randomUUID(), ...fields, paused: false, createdAt: now, nextRunAt: nextBriefRun(fields, now), lastRunAt: null, error: null }
      this.saveSchedules([...schedules, schedule])
      return schedule
    }
    const existing = schedules.find((schedule) => schedule.id === id)
    if (!existing) throw new Error('That brief no longer exists.')
    const retimed = existing.time !== fields.time || existing.frequency !== fields.frequency || existing.weekday !== fields.weekday
    const next = { ...existing, ...fields, ...(retimed ? { nextRunAt: nextBriefRun(fields, now, existing.lastRunAt) } : {}) }
    this.saveSchedules(schedules.map((schedule) => (schedule.id === id ? next : schedule)))
    return next
  }

  /** Its briefs so far stay, to read or delete on their own. */
  remove(id: string): void {
    this.saveSchedules(this.schedules().filter((schedule) => schedule.id !== id))
    this.retries.delete(id)
  }

  /** Coming back from a pause starts at its next time, rather than running for the times it missed. */
  pause(id: string, paused: boolean): void {
    const schedule = this.schedules().find((candidate) => candidate.id === id)
    if (!schedule) return
    this.patch(id, { paused, ...(paused ? {} : { nextRunAt: nextBriefRun(schedule, this.now(), schedule.lastRunAt), error: null }) })
  }

  setPrefs(prefs: Partial<BriefPrefs>): void {
    const next = { ...this.prefs() }
    if (typeof prefs.openOnStart === 'boolean') next.openOnStart = prefs.openOnStart
    if (typeof prefs.notify === 'boolean') next.notify = prefs.notify
    this.deps.kv.set(PREFS_KEY, next)
  }

  markSeen(id: string | null): void {
    const issues = this.issues()
    if (!issues.some((issue) => issue.unseen && (id === null || issue.id === id))) return
    this.saveIssues(issues.map((issue) => (id === null || issue.id === id ? { ...issue, unseen: false } : issue)))
  }

  deleteIssue(id: string): void {
    this.saveIssues(this.issues().filter((issue) => issue.id !== id))
  }

  /**
   * Whether scTerra should open the briefs page as it starts: there's an unread brief it hasn't
   * already opened that way. Calling it records that they were shown.
   */
  takeStartupBriefs(): boolean {
    if (!this.prefs().openOnStart) return false
    const shown = Number(this.deps.kv.get(SHOWN_KEY) ?? 0)
    const fresh = this.issues().filter((issue) => issue.unseen && issue.createdAt > shown)
    if (fresh.length === 0) return false
    this.deps.kv.set(SHOWN_KEY, Math.max(...fresh.map((issue) => issue.createdAt)))
    return true
  }

  /** Answers a question about a brief already written, from the brief and its sources. Nothing is saved. */
  async ask(issueId: string, question: string): Promise<string> {
    const issue = this.issues().find((candidate) => candidate.id === issueId)
    const asked = question.trim().slice(0, MAX_BRIEF_QUESTION)
    if (!issue) throw new Error('That brief no longer exists.')
    if (!asked) throw new Error('Ask a question first.')
    if (this.deps.hosted() === null) throw new Error('Choose a model in AI settings first.')
    return (await this.deps.write(BRIEF_ASK_PROMPT, briefQuestion(issue, asked), 4_000)).trim()
  }

  /** Runs every brief whose time has come. */
  async tick(): Promise<void> {
    if (!this.deps.online()) return
    const now = this.now()
    const due = this.schedules().filter((schedule) => !schedule.paused && schedule.nextRunAt <= now && !this.running.has(schedule.id))
    for (const schedule of due) await this.run(schedule.id, false).catch(() => undefined)
  }

  /** Writes a brief now. Briefs run one at a time, so a list of them never piles up requests. */
  run(id: string, manual = true): Promise<BriefIssue> {
    if (this.running.has(id)) return Promise.reject(new Error('That brief is already being written.'))
    this.running.add(id)
    this.deps.onChange(this.summary())
    const job = this.queue.then(() => this.write(id, manual))
    this.queue = job.catch(() => undefined)
    return job.finally(() => {
      this.running.delete(id)
      this.deps.onChange(this.summary())
    })
  }

  private async write(id: string, manual: boolean): Promise<BriefIssue> {
    const schedule = this.schedules().find((candidate) => candidate.id === id)
    if (!schedule) throw new Error('That brief no longer exists.')
    const now = this.now()
    try {
      const hosted = this.deps.hosted()
      if (hosted === null) throw new Error('Choose a model in AI settings first.')
      if (hosted && this.hostedUsed() >= HOSTED_BRIEFS_PER_DAY) {
        throw new BriefLimitError(`You've had today's ${HOSTED_BRIEFS_PER_DAY} briefs on scTerra AI. Briefs on your own API key have no limit.`)
      }
      const recency: Recency = schedule.frequency === 'daily' ? 'd' : 'w'
      const pages = await this.deps.search(briefQuery(schedule.topic), { recency, read: BRIEF_PAGES[schedule.length], sites: schedule.sites ?? [] })
      if (pages.length === 0) throw new Error("The web search didn't find anything on this topic.")
      const numbered = pages.map((page, index) => ({ ...page, id: index + 1 }))
      const previous = schedule.onlyNew ? this.issues().find((issue) => issue.scheduleId === id) : undefined
      const request = `Write my ${schedule.length} brief on: ${schedule.topic}${previous ? previousBriefNote(previous.text, previous.createdAt) : ''}`
      const [message] = withContext([{ role: 'user', content: request }], numbered, null)
      const text = (await this.deps.write(briefPrompt(schedule.length, now), message!.content, BRIEF_TOKENS[schedule.length])).trim()
      if (!text) throw new Error('The AI sent back nothing.')
      if (hosted) this.deps.kv.set(HOSTED_KEY, { day: localDay(this.now()), count: this.hostedUsed() + 1 })

      const sources: CitationSource[] = numbered.map((page) => ({ n: page.id, tabId: null, title: page.title.slice(0, 300), url: page.url, kind: 'page' }))
      const issue: BriefIssue = { id: randomUUID(), scheduleId: id, title: schedule.title, topic: schedule.topic, length: schedule.length, createdAt: this.now(), text: text.slice(0, MAX_BRIEF_TEXT), sources, unseen: true }
      this.retries.delete(id)
      const current = this.schedules().find((candidate) => candidate.id === id)
      if (current) this.patch(id, { lastRunAt: now, error: null, nextRunAt: manual ? current.nextRunAt : nextBriefRun(current, now, now) })
      this.saveIssues(trimIssues([issue, ...this.issues()]))
      this.deps.onReady(issue, !manual && this.now() - this.startedAt < STARTUP_WINDOW_MS)
      return issue
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't write the brief."
      const current = this.schedules().find((candidate) => candidate.id === id)
      if (current && !manual) this.patch(id, { error: message, nextRunAt: this.retryAt(current, error, now) })
      else if (current) this.patch(id, { error: message })
      throw error
    }
  }

  /** When to try a failed brief again: tomorrow after the daily limit, soon after a passing failure. */
  private retryAt(schedule: BriefSchedule, error: unknown, now: number): number {
    if (error instanceof BriefLimitError) {
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(0, 0, 0, 0)
      return nextBriefRun({ ...schedule, frequency: 'daily' }, tomorrow.getTime() - 1)
    }
    const tries = (this.retries.get(schedule.id) ?? 0) + 1
    if (tries <= MAX_RETRIES) {
      this.retries.set(schedule.id, tries)
      return now + RETRY_MS
    }
    this.retries.delete(schedule.id)
    return nextBriefRun(schedule, now, schedule.lastRunAt)
  }

  destroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer))
  }
}

/** Keeps the newest of each brief, and the newest overall. */
export function trimIssues(issues: BriefIssue[]): BriefIssue[] {
  const counts = new Map<string, number>()
  return issues
    .filter((issue) => {
      const count = (counts.get(issue.scheduleId) ?? 0) + 1
      counts.set(issue.scheduleId, count)
      return count <= MAX_ISSUES_PER_SCHEDULE
    })
    .slice(0, MAX_BRIEF_ISSUES)
}
