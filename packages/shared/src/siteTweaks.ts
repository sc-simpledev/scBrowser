/** A site as people think of it: the host without `www.`, so forgetting or tweaking one covers both. */
export const siteBase = (host: string) => host.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')

/** The site itself or any of its subdomains, so `mail.example.com` belongs to `example.com`. */
export const belongsToSite = (host: string, base: string) => {
  const clean = host.toLowerCase().replace(/^\./, '')
  return clean === base || clean.endsWith(`.${base}`)
}

/** The site of a web address, or null for anything that isn't http or https. */
export function siteOf(url: string): string | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  return /^https?:$/.test(parsed.protocol) && parsed.hostname ? siteBase(parsed.hostname) : null
}

export const isSiteHost = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$|^\[[0-9a-f:]+\]$/.test(value)

export const MAX_TWEAKED_SITES = 500
export const MAX_HIDDEN_PER_SITE = 100
export const MAX_SITE_CSS = 20_000

/**
 * Selectors from the element picker: tags, ids, classes, child steps and `:nth-of-type`. Nothing
 * that could close the rule and start another, as they become `selector { display: none }`.
 */
export const isSafeSelector = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1000 && /^[A-Za-z0-9_\-\s>.#:()\\]+$/.test(value) && !/\\[{};@]/.test(value)

export const isHiddenElements = (value: unknown): value is Record<string, string[]> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length <= MAX_TWEAKED_SITES && entries.every(([host, list]) => isSiteHost(host) && Array.isArray(list) && list.length <= MAX_HIDDEN_PER_SITE && list.every(isSafeSelector))
}

export const isSiteCss = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length <= MAX_TWEAKED_SITES && entries.every(([host, css]) => isSiteHost(host) && typeof css === 'string' && css.length <= MAX_SITE_CSS)
}

/** What a site's tweaks add to its pages, or an empty string for none. */
export function siteTweakCss(host: string, hidden: Record<string, string[]>, css: Record<string, string>): string {
  const base = siteBase(host)
  const selectors = Object.entries(hidden).flatMap(([site, list]) => (belongsToSite(base, site) ? list.filter(isSafeSelector) : []))
  const own = Object.entries(css).flatMap(([site, text]) => (belongsToSite(base, site) && text.trim() ? [text] : []))
  return [...(selectors.length > 0 ? [`${selectors.join(',\n')} { display: none !important; }`] : []), ...own].join('\n')
}
