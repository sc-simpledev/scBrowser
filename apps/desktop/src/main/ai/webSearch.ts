import { session } from 'electron'
import type { PageContext } from '@scbrowser/ai'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

const SEARCH_TIMEOUT_MS = 10_000
const PAGE_TIMEOUT_MS = 8_000
const MAX_PAGE_BYTES = 1_500_000
const RESULTS_READ = 4
const PAGE_CHARS = 9_000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole
  })
}

const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()

/** DuckDuckGo wraps each result's address in a redirect; this takes the real one back out. */
export function resultAddress(href: string): string | null {
  const raw = decodeEntities(href)
  const absolute = raw.startsWith('//') ? `https:${raw}` : raw.startsWith('/') ? `https://duckduckgo.com${raw}` : raw
  if (!URL.canParse(absolute)) return null
  const url = new URL(absolute)
  const target = url.hostname.endsWith('duckduckgo.com') ? url.searchParams.get('uddg') : absolute
  if (!target || !URL.canParse(target)) return null
  const real = new URL(target)
  // Adverts go through DuckDuckGo's own click tracking, so they're left out.
  if (!/^https?:$/.test(real.protocol) || real.hostname.endsWith('duckduckgo.com') || /\/y\.js$/.test(real.pathname)) return null
  return real.toString()
}

/** Results from DuckDuckGo's plain HTML page, or from its lite page, which has a different layout. */
export function parseResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>()
  const add = (href: string, title: string, snippet: string) => {
    const url = resultAddress(href)
    if (!url || seen.has(url) || !title) return
    seen.add(url)
    results.push({ url, title: stripTags(title), snippet: stripTags(snippet) })
  }
  const full = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|$)/gi
  for (const match of html.matchAll(full)) {
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/i.exec(match[3] ?? '')?.[1] ?? ''
    add(match[1]!, match[2]!, snippet)
  }
  if (results.length > 0) return results
  const lite = /<a[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=class=['"]result-link['"]|$)/gi
  for (const match of html.matchAll(lite)) {
    const snippet = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i.exec(match[3] ?? '')?.[1] ?? ''
    add(match[1]!, match[2]!, snippet)
  }
  return results
}

/** Readable text out of a page's HTML, without running it: no scripts, styles, menus or footers. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  // The whole of <main>, or the page's one <article>. A page of many <article> cards is read as a whole,
  // as the first card alone is only a teaser.
  const articles = html.match(/<article\b/gi)?.length ?? 0
  const body =
    /<main\b[\s\S]*<\/main>/i.exec(html)?.[0] ??
    (articles === 1 ? /<article\b[\s\S]*<\/article>/i.exec(html)?.[0] : undefined) ??
    /<body\b[\s\S]*<\/body>/i.exec(html)?.[0] ??
    html
  const text = decodeEntities(
    body
      .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
      // A header holding the headline is the article's own, not the site's banner.
      .replace(/<header\b[\s\S]*?<\/header>/gi, (block) => (/<h1\b/i.test(block) ? block : ' '))
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<[^>]*>/g, ' ')
  )
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
  return { title, text }
}

/** Requests go through the person's own session, so the VPN and tracker blocking apply, but without cookies. */
async function get(url: string, init: RequestInit & { timeout: number }): Promise<Response> {
  return session.defaultSession.fetch(url, { ...init, credentials: 'omit', signal: AbortSignal.timeout(init.timeout) } as RequestInit)
}

/** DuckDuckGo's own date filter: the past day, week or month. */
export type Recency = 'd' | 'w' | 'm'

export async function searchWeb(query: string, recency?: Recency): Promise<SearchResult[]> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!q) return []
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }
  const form = new URLSearchParams({ q, ...(recency ? { df: recency } : {}) })
  try {
    // Tests point this at a local page, as they must not reach the network.
    const endpoint = (process.env.SCB_E2E && process.env.SCB_SEARCH_URL) || 'https://html.duckduckgo.com/html/'
    const response = await get(endpoint, { method: 'POST', headers, body: form.toString(), timeout: SEARCH_TIMEOUT_MS })
    const results = response.ok ? parseResults(await response.text()) : []
    if (results.length > 0) return results
  } catch {
    // Tries the lite page below.
  }
  if (process.env.SCB_E2E && process.env.SCB_SEARCH_URL) return []
  const response = await get(`https://lite.duckduckgo.com/lite/?${form.toString()}`, { headers: { Accept: 'text/html' }, timeout: SEARCH_TIMEOUT_MS })
  if (!response.ok) throw new Error(`The search failed (${response.status}).`)
  return parseResults(await response.text())
}

/** Reads one page as plain text, as the web search does. Null if it can't be read. */
export async function readResult(result: Pick<SearchResult, 'url' | 'title'>): Promise<PageContext | null> {
  try {
    const response = await get(result.url, { headers: { Accept: 'text/html,application/xhtml+xml' }, timeout: PAGE_TIMEOUT_MS })
    if (!response.ok || !/html|text\/plain/i.test(response.headers.get('content-type') ?? '')) return null
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_PAGE_BYTES) return null
    const html = (await response.text()).slice(0, MAX_PAGE_BYTES)
    const { title, text } = htmlToText(html)
    if (text.length < 200) return null
    return { title: title || result.title, url: result.url, text: text.slice(0, PAGE_CHARS) }
  } catch {
    return null
  }
}

/**
 * Searches for the question and reads the first few results, skipping sites on the AI off list.
 * The list of results is its own source too, so the model can still name pages it couldn't read.
 */
export async function webContext(query: string, isSiteOff: (url: string) => boolean, { recency, read = RESULTS_READ, sites = [] }: { recency?: Recency; read?: number; sites?: string[] } = {}): Promise<PageContext[]> {
  const search = async (filter?: Recency) => {
    // Sites the person always wants come first, two results each, one search at a time.
    const pinned: SearchResult[] = []
    for (const site of sites.slice(0, 5)) pinned.push(...(await searchWeb(`${query} site:${site}`, filter).catch(() => [])).slice(0, 2))
    const seen = new Set<string>()
    return [...pinned, ...(await searchWeb(query, filter).catch((error: unknown) => (pinned.length > 0 ? [] : Promise.reject(error))))]
      .filter((result) => !seen.has(result.url) && !!seen.add(result.url) && !isSiteOff(result.url))
      .slice(0, Math.max(8, read + 2))
  }
  let results = await search(recency)
  // A narrow date filter can find nothing on a quiet topic, so it widens to any date.
  if (results.length === 0 && recency) results = await search()
  if (results.length === 0) return []
  const pages = (await Promise.all(results.slice(0, read).map(readResult))).filter((page): page is PageContext => page !== null)
  const list: PageContext = {
    title: `Web search: ${query.slice(0, 80)}`,
    url: `https://duckduckgo.com/?q=${encodeURIComponent(query.slice(0, 300))}`,
    text: results.map((result, i) => `${i + 1}. ${result.title}\n${result.url}\n${result.snippet}`).join('\n\n')
  }
  return [...pages, list]
}
