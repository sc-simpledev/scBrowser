import { belongsToSite, isSiteHost, siteOf } from './siteTweaks'

/** Widevine, for protected video and music, as Settings shows it. */
export interface DrmStatus {
  /** `off`: not started (tests); `unsupported`: a build without Widevine. */
  state: 'off' | 'starting' | 'ready' | 'failed' | 'unsupported'
  version: string | null
  error: string | null
}

/** Settings' line about Widevine. */
export function drmStatusText(status: DrmStatus, on: boolean): string {
  if (!on) return 'Off: protected video and music won’t play anywhere.'
  if (status.state === 'ready') return `Widevine ${status.version ?? ''} is ready.`.replace('  ', ' ')
  if (status.state === 'starting') return status.version ? 'Widevine is starting…' : 'Downloading Widevine from Google. Pages opened before it finishes need a reload.'
  if (status.state === 'failed') return status.error ?? 'Widevine didn’t install.'
  if (status.state === 'unsupported') return status.error ?? 'This build of scTerra can’t play protected content.'
  return 'Widevine starts with scTerra.'
}

/** What a site can be stopped from doing, from the padlock's panel, as Chrome's site settings and NoScript do. */
export type SiteContentBlock = 'scripts' | 'images' | 'popups' | 'drm'

export const SITE_CONTENT_BLOCKS: { id: SiteContentBlock; label: string; blocked: string; allowed: string }[] = [
  { id: 'scripts', label: 'JavaScript', blocked: 'Blocked: most sites won’t work', allowed: 'Allowed' },
  { id: 'images', label: 'Images', blocked: 'Blocked', allowed: 'Allowed' },
  { id: 'popups', label: 'Pop-ups', blocked: 'Blocked, even after a click', allowed: 'Only after a click' },
  { id: 'drm', label: 'Protected content', blocked: 'Blocked', allowed: 'Can play DRM video and music' }
]

/** A block's name inside a sentence: "images", but always "JavaScript". */
export const siteBlockWord = (label: string) => (label === 'JavaScript' ? label : label.toLowerCase())

export const MAX_SITE_CONTENT = 500

const isBlock = (v: unknown): v is SiteContentBlock => v === 'scripts' || v === 'images' || v === 'popups' || v === 'drm'

export const isSiteContent = (v: unknown): v is Record<string, SiteContentBlock[]> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length <= MAX_SITE_CONTENT &&
  Object.entries(v).every(([site, blocks]) => isSiteHost(site) && Array.isArray(blocks) && blocks.length <= 4 && blocks.every(isBlock) && new Set(blocks).size === blocks.length)

/** Whether a page's site (or a site it belongs to, so `mail.example.com` follows `example.com`) blocks this. */
export function siteBlocks(rules: Record<string, SiteContentBlock[]>, url: string, kind: SiteContentBlock): boolean {
  const site = siteOf(url)
  if (!site) return false
  for (const [base, blocks] of Object.entries(rules)) if (blocks.includes(kind) && belongsToSite(site, base)) return true
  return false
}

/** The rules with one block turned on or off for a site; a site with none left is dropped. */
export function withSiteBlock(rules: Record<string, SiteContentBlock[]>, site: string, kind: SiteContentBlock, blocked: boolean): Record<string, SiteContentBlock[]> {
  const others = (rules[site] ?? []).filter((one) => one !== kind)
  const next = blocked ? [...others, kind] : others
  const { [site]: _old, ...rest } = rules
  return next.length ? { ...rest, [site]: next } : rest
}

/** A site's own say on autoplay, overriding Settings' Block autoplay in either direction. */
export type SiteAutoplay = 'allow' | 'block'

export const isSiteAutoplay = (v: unknown): v is Record<string, SiteAutoplay> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length <= MAX_SITE_CONTENT && Object.entries(v).every(([site, choice]) => isSiteHost(site) && (choice === 'allow' || choice === 'block'))

/** Whether sound and video on this page wait for a press: its site's own choice, else the switch in Settings. */
export function autoplayBlocked(rules: Record<string, SiteAutoplay>, url: string, everywhere: boolean): boolean {
  const site = siteOf(url)
  if (!site) return everywhere
  // The closest site wins, so `music.example.com` can differ from `example.com`.
  let closest: [string, SiteAutoplay] | null = null
  for (const [base, choice] of Object.entries(rules)) if (belongsToSite(site, base) && (!closest || base.length > closest[0].length)) closest = [base, choice]
  return closest ? closest[1] === 'block' : everywhere
}

/** The rules with a site's autoplay set; a site that matches Settings needs no rule of its own. */
export function withSiteAutoplay(rules: Record<string, SiteAutoplay>, site: string, blocked: boolean, everywhere: boolean): Record<string, SiteAutoplay> {
  const { [site]: _old, ...rest } = rules
  return blocked === everywhere ? rest : { ...rest, [site]: blocked ? 'block' : 'allow' }
}

/** Adds `script-src 'none'` to a response's headers, keeping any policy the site sent: policies only add up. */
export function withScriptsBlocked(headers: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = { ...(headers ?? {}) }
  const key = Object.keys(out).find((name) => name.toLowerCase() === 'content-security-policy') ?? 'Content-Security-Policy'
  out[key] = [...(out[key] ?? []), "script-src 'none'; worker-src 'none'"]
  return out
}

/** A notification a site sent, kept in the list under the bell. */
export interface SiteNotification {
  id: number
  origin: string
  site: string
  title: string
  body: string
  at: number
  tabId: number | null
  /** Held back by Do not disturb rather than shown. */
  held: boolean
  read: boolean
}

export const MAX_SITE_NOTIFICATIONS = 100
export const MAX_NOTIFICATION_TEXT = 500

/** When sites' notifications are held back instead of shown. */
export type NotificationQuiet = 'never' | 'focus' | 'always'

/** Whether a notification arriving now is held back, by the setting and whether a focus session is on. */
export const holdNotification = (quiet: NotificationQuiet, focusing: boolean) => quiet === 'always' || (quiet === 'focus' && focusing)
