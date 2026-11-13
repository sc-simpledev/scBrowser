/** A tab put away until a time the person picked, when it opens again by itself. */
export interface SnoozedTab {
  id: string
  url: string
  title: string
  container: string | null
  snoozedAt: number
  wakeAt: number
  /** Comes back as soon as a page on this site is opened, whatever the time. */
  wakeHost?: string | null
  /** Back into this tab group when it wakes. */
  group?: string | null
}

export const MAX_SNOOZED = 100

export const SNOOZE_CHOICES = ['hour', 'evening', 'tomorrow', 'week', 'site'] as const
export type SnoozeChoice = (typeof SNOOZE_CHOICES)[number]

export const SNOOZE_LABELS: Record<SnoozeChoice, string> = { hour: 'In an hour', evening: 'This evening, 6:00', tomorrow: 'Tomorrow morning, 9:00', week: 'Next Monday, 9:00', site: 'Until I open this site again' }

export const isSnoozeChoice = (value: unknown): value is SnoozeChoice => (SNOOZE_CHOICES as readonly unknown[]).includes(value)

/** The site a snooze waits for: the host without `www.`. */
export const snoozeHost = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '') : '')

/** When a choice comes round, in local time. Null when it makes no sense now, like this evening at 9 pm. */
export function snoozeUntil(choice: SnoozeChoice, now: number): number | null {
  const at = (days: number, hour: number) => {
    const date = new Date(now)
    date.setDate(date.getDate() + days)
    date.setHours(hour, 0, 0, 0)
    return date.getTime()
  }
  if (choice === 'hour') return now + 3_600_000
  // Waits for the site, but not for ever: a month at most.
  if (choice === 'site') return now + 30 * 86_400_000
  if (choice === 'evening') return new Date(now).getHours() < 17 ? at(0, 18) : null
  if (choice === 'tomorrow') return at(1, 9)
  const ahead = (8 - new Date(now).getDay()) % 7 || 7
  return at(ahead, 9)
}
