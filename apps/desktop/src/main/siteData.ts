import { session, type Session } from 'electron'
import { belongsToSite, CONTAINERS, containerPartition } from '@scbrowser/shared'
import type { HistoryRepo } from './storage/history'
import type { PermissionsRepo } from './storage/permissions'

/** Every session a site's data can be in: the main one and each container's. */
export const siteSessions = (): Session[] => [session.defaultSession, ...CONTAINERS.map((container) => session.fromPartition(containerPartition(container.id)))]

/** The usual addresses of a site, plus any seen in history, as storage is kept by exact origin. */
function originsFor(base: string, seen: string[]): string[] {
  const hosts = [base, `www.${base}`]
  return [...new Set([...hosts.flatMap((host) => [`https://${host}`, `http://${host}`]), ...seen])]
}

/** Cookies, storage, caches and service workers, for the site and its subdomains. */
export async function clearSiteStorage(target: Session, base: string, seenOrigins: string[]): Promise<void> {
  const cookies = await target.cookies.get({}).catch(() => [])
  await Promise.all(
    cookies
      .filter((cookie) => belongsToSite(cookie.domain ?? '', base))
      .map((cookie) => {
        const domain = (cookie.domain ?? '').replace(/^\./, '')
        return target.cookies.remove(`${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path ?? '/'}`, cookie.name).catch(() => undefined)
      })
  )
  await target
    .clearData({ dataTypes: ['localStorage', 'indexedDB', 'serviceWorkers', 'cache', 'fileSystems', 'webSQL', 'backgroundFetch'], origins: originsFor(base, seenOrigins) })
    .catch(() => undefined)
}

/** What this computer remembers about a site, apart from the bookmarks and passwords the person kept on purpose. */
export async function forgetSite(base: string, { history, permissions }: { history: HistoryRepo; permissions: PermissionsRepo }): Promise<void> {
  const origins = history.forgetSite(base)
  for (const { origin, permission } of permissions.list()) {
    if (URL.canParse(origin) && belongsToSite(new URL(origin).hostname, base)) permissions.revoke(origin, permission)
  }
  await Promise.all(siteSessions().map((target) => clearSiteStorage(target, base, origins)))
}
