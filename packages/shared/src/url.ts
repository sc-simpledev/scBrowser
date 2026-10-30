export const NEW_TAB_URL = 'sc://newtab'

export interface SearchEngine {
  name: string
  /** `%s` is replaced with the encoded query. */
  template: string
}

export const DEFAULT_SEARCH_ENGINE: SearchEngine = {
  name: 'DuckDuckGo',
  template: 'https://duckduckgo.com/?q=%s'
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'sc:', 'about:', 'view-source:'])
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i
const HOST_LIKE = /^[^\s/?#]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/

/**
 * Turns whatever the user typed in the omnibox into a URL to load:
 * a URL with a known scheme, a bare host ("example.com/path"), or a search.
 */
export function resolveOmniboxInput(raw: string, engine: SearchEngine = DEFAULT_SEARCH_ENGINE): string {
  const input = raw.trim()
  if (!input) return NEW_TAB_URL

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

export function errorPageUrl(failedUrl: string, reason: string): string {
  return `${ERROR_PAGE_URL}?${new URLSearchParams({ url: failedUrl, reason })}`
}

/** The address a tab should present and reload: an error page stands in for the page that failed. */
export function effectiveUrl(url: string): string {
  if (!url.startsWith(ERROR_PAGE_URL)) return url
  return new URL(url).searchParams.get('url') ?? url
}

/** Text to show in the omnibox for a URL; the new tab page shows as empty. */
export function displayUrl(url: string): string {
  const shown = effectiveUrl(url)
  return isNewTabUrl(shown) || shown === 'about:blank' ? '' : shown
}
