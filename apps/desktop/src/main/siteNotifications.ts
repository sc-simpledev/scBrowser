import { MAX_NOTIFICATION_TEXT, MAX_SITE_NOTIFICATIONS, siteOf, type SiteNotification } from '@scbrowser/shared'

/** At most this many from one page a minute make the list; more are shown or held as usual, just not listed. */
const PER_PAGE_PER_MINUTE = 10

/**
 * Notifications sites sent, newest first, kept in memory for the More menu's Notifications list. A
 * page's preload reports each one as it's made (only once the site has the permission), and is told
 * whether to show it or hold it back for Do not disturb.
 */
export class SiteNotifications {
  private list: SiteNotification[] = []
  private nextId = 1
  private readonly recent = new Map<string, number[]>()

  constructor(private readonly onChange: () => void = () => undefined) {}

  /** Notes a notification; true when it's held back rather than shown. */
  record(input: { url: string; title: unknown; body: unknown; tabId: number | null; hold: boolean }, now = Date.now()): boolean {
    const site = siteOf(input.url)
    if (!site || typeof input.title !== 'string') return false
    const origin = new URL(input.url).origin
    const times = (this.recent.get(origin) ?? []).filter((at) => now - at < 60_000)
    if (times.length >= PER_PAGE_PER_MINUTE) return input.hold
    this.recent.set(origin, [...times, now])
    const clip = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTIFICATION_TEXT) : '')
    this.list = [{ id: this.nextId++, origin, site, title: clip(input.title) || site, body: clip(input.body), at: now, tabId: input.tabId, held: input.hold, read: false }, ...this.list].slice(0, MAX_SITE_NOTIFICATIONS)
    this.onChange()
    return input.hold
  }

  all(): SiteNotification[] {
    return this.list
  }

  /** How many came in since the list was last looked at. */
  unread(): number {
    return this.list.filter((one) => !one.read).length
  }

  markRead(): void {
    if (!this.list.some((one) => !one.read)) return
    this.list = this.list.map((one) => ({ ...one, read: true }))
    this.onChange()
  }

  clear(): void {
    this.list = []
    this.onChange()
  }

  /** A tab closed: its notifications stay listed, but can't take the person back to it. */
  forgetTab(tabId: number): void {
    if (!this.list.some((one) => one.tabId === tabId)) return
    this.list = this.list.map((one) => (one.tabId === tabId ? { ...one, tabId: null } : one))
  }
}

/** A notification as one menu line: the site, then its title, cut to fit. */
export function notificationLabel(one: SiteNotification, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - one.at) / 60_000))
  const when = minutes < 1 ? 'now' : minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`
  const text = one.body ? `${one.title}: ${one.body}` : one.title
  const short = text.length > 60 ? `${text.slice(0, 59)}…` : text
  return `${one.site} · ${short} (${when}${one.held ? ', held' : ''})`
}
