import type { ContextSource } from './ai'

/** A page a reply was given, numbered as the model saw it, to link its citations back to. */
export interface CitationSource {
  n: number
  /** The tab it came from. Gone after a restart, when the address is used instead. */
  tabId: number | null
  title: string
  url: string
  kind: ContextSource
}

/** Where to go in a source: some words to find, or a moment in a video. */
export interface CitationTarget {
  quote: string | null
  seconds: number | null
}

export const CITATION_INSTRUCTIONS = `Pages are numbered by the id on their <page> tag. When a sentence of your answer uses a page, cite it straight after, as [1]. Where you can, add a few words copied exactly from the page, as [1: "exact words from it"], so the person can jump to that spot. Keep quotes under 12 words, and never make one up. Video transcripts have a time at the start of each line, like [1:23]; cite moments in a video the same way, as [1:23]. Leave out citations when no page was given.`

const MAX_QUOTE = 240
const CITE_PREFIX = '#sc-cite-'
const TIME_PREFIX = '#sc-time-'

/** "1:02:03" or "2:03" as seconds, or null if it isn't a time. */
export function parseTimestamp(text: string): number | null {
  const parts = text.split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null
  if (parts.slice(1).some((part) => part > 59)) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

export const formatTimestamp = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Turns citations and video times in a reply into Markdown links to our own `#sc-` addresses,
 * which the reply renderer draws as chips. Code is left as it is, and so are numbers past the
 * last page, so a reply that happens to write [3] about something else isn't linked.
 */
export function linkCitations(text: string, { sources, timestamps }: { sources: number; timestamps: boolean }): string {
  if (sources === 0 && !timestamps) return text
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part
      let out = part
      if (sources > 0) {
        out = out.replace(/\[(\d{1,2})\s*:\s*["“]([^"”\n\]]{2,240})["”]\](?!\()/g, (whole, n: string, quote: string) =>
          Number(n) >= 1 && Number(n) <= sources ? `[${n}](${CITE_PREFIX}${n}~${encodeURIComponent(quote.trim().slice(0, MAX_QUOTE))})` : whole
        )
        out = out.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (whole, list: string) => {
          const numbers = list.split(',').map((n) => Number(n.trim()))
          if (!numbers.every((n) => n >= 1 && n <= sources)) return whole
          return numbers.map((n) => `[${n}](${CITE_PREFIX}${n})`).join('')
        })
      }
      if (timestamps) {
        out = out.replace(/\[((?:\d{1,2}:)?\d{1,2}:\d{2})\](?!\()/g, (whole, time: string) => {
          const seconds = parseTimestamp(time)
          return seconds === null ? whole : `[${time}](${TIME_PREFIX}${seconds})`
        })
      }
      return out
    })
    .join('')
}

/** What a citation link points to, or null if it isn't one. */
export function parseCitationHref(href: string): { n: number; target: CitationTarget } | null {
  if (href.startsWith(CITE_PREFIX)) {
    const [n, quote] = href.slice(CITE_PREFIX.length).split('~')
    const number = Number(n)
    if (!Number.isInteger(number) || number < 1) return null
    let decoded: string | null = null
    try {
      decoded = quote ? decodeURIComponent(quote).slice(0, MAX_QUOTE) : null
    } catch {
      decoded = null
    }
    return { n: number, target: { quote: decoded, seconds: null } }
  }
  if (href.startsWith(TIME_PREFIX)) {
    const seconds = Number(href.slice(TIME_PREFIX.length))
    return Number.isInteger(seconds) && seconds >= 0 ? { n: 0, target: { quote: null, seconds } } : null
  }
  return null
}

export const isCitationTarget = (value: unknown): value is CitationTarget => {
  const { quote, seconds } = (value ?? {}) as Record<string, unknown>
  return (quote === null || (typeof quote === 'string' && quote.length <= MAX_QUOTE)) && (seconds === null || (Number.isInteger(seconds) && (seconds as number) >= 0 && (seconds as number) < 360_000))
}

export const isCitationSource = (value: unknown): value is Pick<CitationSource, 'tabId' | 'url'> => {
  const { tabId, url } = (value ?? {}) as Record<string, unknown>
  return (tabId === null || Number.isInteger(tabId)) && typeof url === 'string' && url.length <= 8192 && /^(https?|file):/i.test(url)
}

/** An address that finds the words when it loads, for a source whose tab has closed. */
export function textFragmentUrl(url: string, quote: string | null): string {
  if (!quote || !URL.canParse(url)) return url
  const parsed = new URL(url)
  parsed.hash = `:~:text=${encodeURIComponent(quote)}`
  return parsed.toString()
}

/** A YouTube address that starts at a moment, for a video whose tab has closed. */
export function videoTimeUrl(url: string, seconds: number | null): string {
  if (seconds === null || !URL.canParse(url)) return url
  const parsed = new URL(url)
  parsed.searchParams.set('t', `${seconds}s`)
  return parsed.toString()
}
