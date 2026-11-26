/** Clear browsing data: how far back, and what. */
export const CLEAR_RANGES = [
  { id: 'hour', label: 'The last hour', ms: 3_600_000 },
  { id: 'day', label: 'The last 24 hours', ms: 86_400_000 },
  { id: 'week', label: 'The last 7 days', ms: 7 * 86_400_000 },
  { id: 'month', label: 'The last 4 weeks', ms: 28 * 86_400_000 },
  { id: 'all', label: 'All time', ms: Number.POSITIVE_INFINITY }
] as const

export type ClearRange = (typeof CLEAR_RANGES)[number]['id']

export const CLEAR_KINDS = [
  { id: 'history', label: 'Browsing history', hint: 'Pages visited in that time, from history and the address bar.' },
  { id: 'downloads', label: 'Download list', hint: 'The list of finished downloads. The files stay where they are.' },
  { id: 'cookies', label: 'Cookies and site data', hint: 'Signs you out of most sites. Chromium keeps no dates for these, so it’s all of them, whatever the time. Extensions keep theirs.' },
  { id: 'cache', label: 'Cached pictures and files', hint: 'Pages load a little slower the next time. All of it, whatever the time.' }
] as const

export type ClearKind = (typeof CLEAR_KINDS)[number]['id']

export const isClearRange = (value: unknown): value is ClearRange => CLEAR_RANGES.some((range) => range.id === value)
export const isClearKind = (value: unknown): value is ClearKind => CLEAR_KINDS.some((kind) => kind.id === value)

/** The earliest time a range reaches back to; 0 for all time. */
export function clearSince(range: ClearRange, now = Date.now()): number {
  const { ms } = CLEAR_RANGES.find((entry) => entry.id === range)!
  return Number.isFinite(ms) ? now - ms : 0
}
