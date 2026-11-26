import { clearSince, type ClearKind, type ClearRange } from '@scbrowser/shared'
import type { DownloadManager } from './downloads'
import { siteSessions } from './siteData'
import type { HistoryRepo } from './storage/history'

/** scTerra's own pages that keep a little in storage, which clearing sites' data leaves alone. */
const OWN_ORIGINS = ['sc://assistant', 'sc://code']

/**
 * Clear browsing data. History and the download list go by time. Chromium keeps no dates for
 * cookies, site storage or the cache, so those go whole, as the page says. Extensions keep their
 * own storage, as in Chrome.
 */
export async function clearBrowsingData(range: ClearRange, kinds: readonly ClearKind[], { history, downloads }: { history: HistoryRepo; downloads: DownloadManager }, now = Date.now()): Promise<void> {
  const since = clearSince(range, now)
  if (kinds.includes('history')) history.clearSince(since)
  if (kinds.includes('downloads')) downloads.clearFinishedSince(since)
  const sessions = siteSessions()
  await Promise.all(
    sessions.map(async (target) => {
      if (kinds.includes('cookies')) {
        const extensions = target.extensions.getAllExtensions().map(({ id }) => `chrome-extension://${id}`)
        await target
          .clearData({ dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'webSQL', 'backgroundFetch'], excludeOrigins: [...OWN_ORIGINS, ...extensions] })
          .catch(() => undefined)
      }
      if (kinds.includes('cache')) {
        await target.clearCache().catch(() => undefined)
        await target.clearData({ dataTypes: ['cache'] }).catch(() => undefined)
      }
    })
  )
}
