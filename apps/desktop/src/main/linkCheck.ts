import { session } from 'electron'
import type { LinkCheck } from '@scbrowser/shared'

const TIMEOUT_MS = 8000
const AT_ONCE = 6
export const MAX_LINKS_CHECKED = 500

/** Errors that mean the site itself is gone, rather than this computer being offline or slow. */
const GONE = /ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE/

/**
 * Whether bookmarked pages still answer: 404 and 410, or a name that no longer resolves, count as
 * dead; a timeout or anything odd stays "unknown", so nothing is offered for removal on a guess.
 * Through the browser's session, so the VPN and proxy apply, without cookies.
 */
export async function checkLinks(urls: string[], fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (url, init) => session.defaultSession.fetch(url, init)): Promise<LinkCheck[]> {
  const queue = [...new Set(urls)].filter((url) => /^https?:\/\//i.test(url)).slice(0, MAX_LINKS_CHECKED)
  const results: LinkCheck[] = []
  const one = async (url: string): Promise<LinkCheck> => {
    const ask = (method: 'HEAD' | 'GET') => fetchImpl(url, { method, redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS) })
    try {
      let response = await ask('HEAD')
      // Some servers refuse HEAD but answer GET.
      if (response.status === 405 || response.status === 501 || response.status === 403) response = await ask('GET')
      void response.body?.cancel().catch(() => undefined)
      return { url, state: response.status === 404 || response.status === 410 ? 'dead' : response.ok || response.status < 500 ? 'ok' : 'unknown', status: response.status }
    } catch (error) {
      const said = `${error instanceof Error ? error.message : ''} ${error instanceof Error && error.cause instanceof Error ? error.cause.message : ''}`
      return { url, state: GONE.test(said) ? 'dead' : 'unknown', status: null }
    }
  }
  const workers = Array.from({ length: Math.min(AT_ONCE, queue.length) }, async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) results.push(await one(url))
  })
  await Promise.all(workers)
  return results
}
