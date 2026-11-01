import type { Session } from 'electron'

const MAX_ICON_BYTES = 128 * 1024
const ICON_TIMEOUT_MS = 8000

/** Fetches an icon as a data address, so showing it later contacts nobody. */
export async function fetchIcon(session: Session, url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return url.length <= MAX_ICON_BYTES * 2 ? url : null
  if (!/^https?:/i.test(url)) return null
  try {
    const response = await session.fetch(url, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS) })
    const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!response.ok || !/^image\/[\w.+-]+$/.test(type)) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return bytes.length > 0 && bytes.length <= MAX_ICON_BYTES ? `data:${type};base64,${bytes.toString('base64')}` : null
  } catch {
    return null
  }
}

/** For a site that hasn't been visited, which has no page to name its icon. */
export const fetchSiteIcon = (session: Session, pageUrl: string) => fetchIcon(session, new URL('/favicon.ico', pageUrl).toString())
