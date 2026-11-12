import { recapPrompt, yesterdayRange, type HistoryEntry } from '@scbrowser/shared'

interface RecapDeps {
  history: { between: (after: number, before: number, limit?: number) => HistoryEntry[] }
  unread: () => { title: string; url: string }[]
  disabledHosts: () => string[]
  setPendingPrompt: (text: string) => void
}

/**
 * Lines up a recap of yesterday for the assistant page to send when it opens. False if there's
 * nothing from yesterday. Sites with AI turned off are left out.
 */
export function prepareRecap({ history, unread, disabledHosts, setPendingPrompt }: RecapDeps, now = Date.now()): boolean {
  const off = disabledHosts()
  const allowed = (url: string) => URL.canParse(url) && !off.includes(new URL(url).host)
  const { after, before } = yesterdayRange(now)
  const visits = history.between(after, before).filter((visit) => allowed(visit.url))
  if (visits.length === 0) return false
  setPendingPrompt(recapPrompt('yesterday', visits, unread().filter((item) => allowed(item.url))))
  return true
}
