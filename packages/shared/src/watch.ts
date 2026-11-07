/** A page checked now and then, to say when its words change, like a price or "in stock". */
export interface PageWatch {
  id: string
  url: string
  title: string
  /** Part of the page picked to watch, or null for all of its text. */
  selector: string | null
  everyMinutes: WatchInterval
  /** The text as of the last check. */
  lastText: string
  lastCheckedAt: number | null
  /** When it last changed, or null if it hasn't since watching started. */
  changedAt: number | null
  /** Changed since the person last looked. */
  unseen: boolean
  /** Why the last check failed, if it did. */
  error: string | null
  /** What changed last time, line by line. */
  added: string[]
  removed: string[]
}

export const WATCH_INTERVALS = [15, 60, 360, 1440] as const
export type WatchInterval = (typeof WATCH_INTERVALS)[number]
export const MAX_WATCHES = 50
/** Enough for a long article, without the store growing without end. */
export const MAX_WATCH_TEXT = 40_000
const MAX_DIFF_LINES = 40

export const intervalLabel = (minutes: WatchInterval) => (minutes < 60 ? `Every ${minutes} minutes` : minutes === 60 ? 'Every hour' : minutes < 1440 ? `Every ${minutes / 60} hours` : 'Every day')

/** Lines without spacing differences or blank lines, so only real changes count. */
export function normaliseWatchText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_WATCH_TEXT)
}

/**
 * Lines that came and went. Counted, so a line that appears twice and loses one shows as removed,
 * and order-only shuffles don't count, as pages often reorder the same items.
 */
export function diffWatchText(before: string, after: string): { added: string[]; removed: string[] } {
  const count = (text: string) => {
    const counts = new Map<string, number>()
    for (const line of text ? text.split('\n') : []) counts.set(line, (counts.get(line) ?? 0) + 1)
    return counts
  }
  const old = count(before)
  const next = count(after)
  const added: string[] = []
  const removed: string[] = []
  for (const line of after ? after.split('\n') : []) {
    const left = old.get(line) ?? 0
    if (left > 0) old.set(line, left - 1)
    else if (added.length < MAX_DIFF_LINES) added.push(line)
  }
  for (const line of before ? before.split('\n') : []) {
    const left = next.get(line) ?? 0
    if (left > 0) next.set(line, left - 1)
    else if (removed.length < MAX_DIFF_LINES) removed.push(line)
  }
  return { added, removed }
}

export const isWatchInterval = (value: unknown): value is WatchInterval => (WATCH_INTERVALS as readonly unknown[]).includes(value)
