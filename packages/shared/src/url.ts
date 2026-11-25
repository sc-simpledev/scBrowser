export const NEW_TAB_URL = 'sc://newtab'

export interface SearchEngine {
  name: string
  /** `%s` is replaced with the encoded query. */
  template: string
}

export const DEFAULT_SEARCH_ENGINE: SearchEngine = {
  name: 'Google',
  template: 'https://www.google.com/search?q=%s'
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'sc:', 'about:', 'view-source:', 'chrome-extension:'])
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i
const HOST_LIKE = /^[^\s/?#]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/

/** Schemes that are the browser's own, or that have been used to attack the apps behind them. */
const NOT_APP_SCHEMES = new Set([
  'http', 'https', 'ws', 'wss', 'ftp', 'ftps', 'sftp', 'file', 'sc', 'about', 'view-source', 'chrome', 'chrome-extension', 'chrome-untrusted', 'devtools',
  'javascript', 'vbscript', 'data', 'blob', 'filesystem', 'jar', 'res', 'mhtml', 'shell', 'hcp', 'smb', 'cifs', 'nfs', 'afp', 'dav', 'ssh', 'telnet',
  'ms-msdt', 'ms-search', 'search-ms', 'search', 'ms-officecmd', 'ms-cxh', 'ms-cxh-full', 'ms-excel', 'ms-word', 'ms-powerpoint'
])
/** Common ones that have no `//`, which typed text otherwise needs before it counts as a link. */
const BARE_APP_SCHEMES = new Set(['mailto', 'tel', 'sms', 'magnet'])
const APP_URL = /^([a-z][a-z0-9+.-]{0,39}):(\/\/)?\S*$/i

/** The scheme of a link that belongs to another app, like `claude://`, or null if it doesn't. */
export function appScheme(url: string): string | null {
  const scheme = APP_URL.exec(url)?.[1]?.toLowerCase()
  return scheme && !NOT_APP_SCHEMES.has(scheme) ? scheme : null
}

/** Whether typed text means an app link. `localhost:3000` and `note:milk` don't. */
export function isTypedAppUrl(input: string): boolean {
  const scheme = appScheme(input)
  return !!scheme && (BARE_APP_SCHEMES.has(scheme) || input.slice(scheme.length, scheme.length + 3) === '://')
}

/** A script to run on the open page. A space straight after the colon reads as a search, not code. */
export const isJavascriptUrl = (input: string) => /^javascript:\S/i.test(input.trim())

/** The script inside a `javascript:` address. */
export function javascriptUrlCode(input: string): string {
  const code = input.trim().slice('javascript:'.length)
  try {
    return decodeURIComponent(code)
  } catch {
    return code
  }
}

/**
 * Turns whatever the user typed in the omnibox into a URL to load:
 * a URL with a known scheme, a bare host ("example.com/path"), or a search.
 */
export function resolveOmniboxInput(raw: string, engine: SearchEngine = DEFAULT_SEARCH_ENGINE, keywords: readonly SearchKeyword[] = []): string {
  const input = raw.trim()
  if (!input) return NEW_TAB_URL
  if (isJavascriptUrl(input) || isTypedAppUrl(input)) return input
  const site = keywordSearch(input, keywords)
  if (site) return site.url

  if (SCHEME.test(input) && !input.includes(' ')) {
    const scheme = input.slice(0, input.indexOf(':') + 1).toLowerCase()
    if (ALLOWED_SCHEMES.has(scheme)) return input
    // "localhost:3000" parses as scheme "localhost:" — fall through to host handling.
  }

  if (!input.includes(' ') && (LOCALHOST.test(input) || IPV4.test(input))) return `http://${input}`
  if (!input.includes(' ') && HOST_LIKE.test(input)) return `https://${input}`

  return engine.template.replace('%s', encodeURIComponent(input))
}

/** Chromium normalises standard-scheme URLs, so `sc://newtab` comes back as `sc://newtab/`. */
export function isNewTabUrl(url: string): boolean {
  return url === NEW_TAB_URL || url === `${NEW_TAB_URL}/`
}

export const ERROR_PAGE_URL = 'sc://error/'

export const READER_PAGE_URL = 'sc://reader/'

export const BLOCKED_PAGE_URL = 'sc://blocked/'

export const PDF_PAGE_URL = 'sc://pdf/'

/** `httpUrl` offers a way back to plain HTTP when an automatic HTTPS upgrade failed. */
export function errorPageUrl(failedUrl: string, reason: string, httpUrl?: string | null): string {
  return `${ERROR_PAGE_URL}?${new URLSearchParams({ url: failedUrl, reason, ...(httpUrl ? { http: httpUrl } : {}) })}`
}

export const isReaderUrl = (url: string) => url.startsWith(READER_PAGE_URL)

/** The address a tab should present: error and reader pages stand in for the real page. */
export function effectiveUrl(url: string): string {
  if (!url.startsWith(ERROR_PAGE_URL) && !isReaderUrl(url) && !url.startsWith(BLOCKED_PAGE_URL) && !url.startsWith(PDF_PAGE_URL)) return url
  return new URL(url).searchParams.get('url') ?? url
}

/** Text to show in the omnibox for a URL; the new tab page shows as empty. */
export function displayUrl(url: string): string {
  const shown = effectiveUrl(url)
  return isNewTabUrl(shown) || shown === 'about:blank' ? '' : shown
}

/** Google's sign-in pages, which are shown a different identity: see `googleSignIn.ts`. */
export const SIGN_IN_HOSTS = ['accounts.google.com', 'accounts.youtube.com'] as const

/** A word that searches one site: `yt cats` searches YouTube for cats. */
export interface SearchKeyword {
  keyword: string
  name: string
  /** `%s` is replaced with the encoded search. */
  template: string
}

export const MAX_SEARCH_KEYWORDS = 40

/** Short words that are rarely the first word of a real search. */
export const DEFAULT_SEARCH_KEYWORDS: SearchKeyword[] = [
  { keyword: 'yt', name: 'YouTube', template: 'https://www.youtube.com/results?search_query=%s' },
  { keyword: 'wiki', name: 'Wikipedia', template: 'https://en.wikipedia.org/w/index.php?search=%s' },
  { keyword: 'gh', name: 'GitHub', template: 'https://github.com/search?q=%s' },
  { keyword: 'maps', name: 'Google Maps', template: 'https://www.google.com/maps/search/%s' },
  { keyword: 'ddg', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' }
]

/** A keyword is one word of letters, digits, dots or dashes, so it can't look like an address on its own. */
export const isKeywordWord = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{0,19}$/i.test(value) && !HOST_LIKE.test(value)

export function isSearchKeyword(value: unknown): value is SearchKeyword {
  if (typeof value !== 'object' || value === null) return false
  const { keyword, name, template } = value as Record<string, unknown>
  return (
    isKeywordWord(keyword) &&
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.length <= 60 &&
    typeof template === 'string' &&
    template.length <= 2048 &&
    /^https?:\/\/[^\s]+$/i.test(template) &&
    template.includes('%s')
  )
}

export const isSearchKeywords = (value: unknown): value is SearchKeyword[] =>
  Array.isArray(value) &&
  value.length <= MAX_SEARCH_KEYWORDS &&
  value.every(isSearchKeyword) &&
  new Set(value.map((entry: SearchKeyword) => entry.keyword.toLowerCase())).size === value.length

/** `yt cats` when `yt` is a keyword: which site, what to search for there, and the address. */
export function keywordSearch(raw: string, keywords: readonly SearchKeyword[]): { keyword: SearchKeyword; query: string; url: string } | null {
  const match = /^(\S+)\s+(\S[\s\S]*)$/.exec(raw.trim())
  if (!match) return null
  const word = match[1]!.toLowerCase()
  const keyword = keywords.find((entry) => entry.keyword.toLowerCase() === word)
  if (!keyword) return null
  const query = match[2]!.trim()
  return { keyword, query, url: keyword.template.replace('%s', encodeURIComponent(query)) }
}

/** The keyword typed on its own, so the address bar can say what a space and a search would do. */
export const keywordNamed = (raw: string, keywords: readonly SearchKeyword[]): SearchKeyword | null =>
  keywords.find((entry) => entry.keyword.toLowerCase() === raw.trim().toLowerCase()) ?? null

/**
 * Parts of addresses that only say where a click came from: ad and mail campaign tags and click ids.
 * Only names that never change what a page shows. `si` is YouTube's and Spotify's share tag, so it's
 * only taken off there.
 */
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'igshid', 'igsh',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'mkt_tok', 'vero_id', 'vero_conv',
  'oly_anon_id', 'oly_enc_id', '_openstat', 'wickedid', 'rb_clickid', 's_cid', 'ref_src', 'ref_url', 'srsltid', 'epik', 'irclickid', 'sc_cid'
])
const SHARE_TAG_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/i

/** The address without tracking tags, or the same address when it has none. The rest is kept exactly as written. */
export function cleanUrl(url: string): string {
  if (!/^https?:/i.test(url) || !URL.canParse(url)) return url
  const query = url.indexOf('?')
  const firstHash = url.indexOf('#')
  // A `?` after the `#` belongs to the page's own routing, which never reaches the server.
  if (query === -1 || (firstHash !== -1 && firstHash < query)) return url
  const hash = url.indexOf('#', query)
  const search = url.slice(query + 1, hash === -1 ? undefined : hash)
  const shareHost = SHARE_TAG_HOSTS.test(new URL(url).hostname)
  const parts = search.split('&')
  const kept = parts.filter((part) => {
    let name = part.split('=')[0]!
    try {
      name = decodeURIComponent(name.replace(/\+/g, ' '))
    } catch {
      return true
    }
    const lower = name.toLowerCase()
    return !(lower.startsWith('utm_') || TRACKING_PARAMS.has(lower) || (shareHost && lower === 'si'))
  })
  if (kept.length === parts.length) return url
  const rest = kept.filter((part) => part !== '').join('&')
  return `${url.slice(0, query)}${rest ? `?${rest}` : ''}${hash === -1 ? '' : url.slice(hash)}`
}
