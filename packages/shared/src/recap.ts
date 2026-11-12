/** What goes to the assistant for a recap: only titles and addresses, and only because the person asked. */
export const MAX_RECAP_PAGES = 120

const clean = (text: string) => text.replace(/\s+/g, ' ').replace(/<\/?(page|selection)\b/gi, (tag) => tag.replace('<', '&lt;')).trim()

/**
 * Asks for a recap of a day's browsing from its history. History keeps each page's latest visit,
 * so a page looked at again since is counted on the later day.
 */
export function recapPrompt(day: string, visits: { title: string; url: string; lastVisit: number }[], unread: { title: string; url: string }[]): string {
  const time = (at: number) => new Date(at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
  const pages = visits.slice(0, MAX_RECAP_PAGES).map((visit) => `${time(visit.lastVisit)} ${clean(visit.title || visit.url).slice(0, 120)} (${visit.url.slice(0, 160)})`)
  const later = unread.slice(0, 20).map((item) => `- ${clean(item.title || item.url).slice(0, 120)} (${item.url.slice(0, 160)})`)
  return `Recap what I was doing in my browser ${day}, from the pages below (time, title, address). Group them into the few things I was working on or reading about, say in a line what each was, and link the two or three most useful pages of each as Markdown links. Then list what looks unfinished and worth picking up again${later.length > 0 ? ', including anything relevant from my unread reading list' : ''}. You only have titles and addresses, so say so rather than guessing at contents. Keep it short.\n\n<selection>\nPages:\n${pages.join('\n')}${later.length > 0 ? `\n\nUnread reading list:\n${later.join('\n')}` : ''}\n</selection>`
}

/** Local midnight at the start of the day before `now`, and of today. */
export function yesterdayRange(now: number): { after: number; before: number } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const before = start.getTime()
  start.setDate(start.getDate() - 1)
  return { after: start.getTime(), before }
}
