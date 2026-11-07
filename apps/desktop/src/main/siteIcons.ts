import { nativeImage, type Session } from 'electron'

const MAX_ICON_BYTES = 128 * 1024
const ICON_TIMEOUT_MS = 8000

/** Fetches an icon as a data address, so showing it later contacts nobody. */
export async function fetchIcon(session: Session, url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return url.length <= MAX_ICON_BYTES * 2 ? url : null
  if (!/^https?:/i.test(url)) return null
  try {
    const response = await session.fetch(url, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS) })
    if (!response.ok) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    // Plenty of servers send icons as octet-stream or text, so the bytes decide when the header doesn't.
    const type = imageType(response.headers.get('content-type')?.split(';')[0]?.trim() ?? '', bytes)
    if (!type) return null
    return bytes.length > 0 && bytes.length <= MAX_ICON_BYTES ? `data:${type};base64,${bytes.toString('base64')}` : null
  } catch {
    return null
  }
}

/** For a site that hasn't been visited, which has no page to name its icon. */
export const fetchSiteIcon = (session: Session, pageUrl: string) => fetchIcon(session, new URL('/favicon.ico', pageUrl).toString())

export function imageType(header: string, bytes: Buffer): string | null {
  if (/^image\/[\w.+-]+$/.test(header)) return header
  const head = bytes.subarray(0, 256)
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'image/png'
  if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) return 'image/x-icon'
  if (head.toString('latin1', 0, 3) === 'GIF') return 'image/gif'
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg'
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (/<svg[\s>]/i.test(head.toString('utf8'))) return 'image/svg+xml'
  return null
}

const tabIcons = new Map<string, Promise<string | null>>()
const TAB_ICON_CACHE = 300
const TAB_ICON_SIZE = 32

/**
 * A tab's icon, fetched through the tab's own session (so its sign-ins, container and VPN apply) and
 * handed to the browser UI as a small data address. Loading it straight from the browser UI failed on
 * sites that only serve icons to their own pages, or block requests from elsewhere. Remembered by
 * address for the run, and shrunk to 32 pixels when Chromium can read it, to keep saved tabs small.
 */
export function tabIcon(session: Session, url: string, fallbackPage?: string): Promise<string | null> {
  const key = url || fallbackPage || ''
  const cached = tabIcons.get(key)
  if (cached) return cached
  const load = (async () => {
    let icon = url ? await fetchIcon(session, url) : null
    if (!icon && fallbackPage && /^https?:/.test(fallbackPage)) icon = await fetchSiteIcon(session, fallbackPage)
    if (!icon || icon.startsWith('data:image/svg')) return icon
    const image = nativeImage.createFromDataURL(icon)
    if (image.isEmpty()) return icon.length <= 24 * 1024 ? icon : null
    const { width } = image.getSize()
    return width > TAB_ICON_SIZE ? image.resize({ width: TAB_ICON_SIZE, quality: 'best' }).toDataURL() : icon
  })()
  tabIcons.set(key, load)
  if (tabIcons.size > TAB_ICON_CACHE) tabIcons.delete(tabIcons.keys().next().value!)
  // A failure isn't remembered, so the next visit tries again.
  void load.then((icon) => {
    if (!icon) tabIcons.delete(key)
  })
  return load
}
