import type { Cookie, CookiesSetDetails, Session } from 'electron'

/** How long a kept sign-in lasts without the site renewing it. Chrome keeps them until cleared. */
const KEEP_DAYS = 30

/**
 * Many sites sign people in with a cookie that has no expiry date, which Chromium throws away when
 * the browser closes. Chrome keeps them when it continues where it left off; Electron has no such
 * thing, so those people had to sign in again at every start. This gives such cookies a date as
 * they're set, so they're saved like any other. The site can still change or remove them.
 */
export function keepSessionCookies(target: Session, enabled: () => boolean): void {
  target.cookies.on('changed', (_event, cookie, cause, removed) => {
    if (removed || !cookie.session || cause !== 'explicit' || !enabled()) return
    const details = persistent(cookie)
    if (details) void target.cookies.set(details).catch(() => undefined)
  })
}

export function persistent(cookie: Cookie, now = Date.now()): CookiesSetDetails | null {
  const host = cookie.domain?.replace(/^\./, '')
  if (!host) return null
  const scheme = cookie.secure ? 'https' : 'http'
  return {
    url: `${scheme}://${host}${cookie.path ?? '/'}`,
    name: cookie.name,
    value: cookie.value,
    // A host-only cookie set with a domain would start reaching subdomains too.
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path ?? '/',
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    ...(cookie.sameSite && cookie.sameSite !== 'unspecified' ? { sameSite: cookie.sameSite } : {}),
    expirationDate: Math.floor(now / 1000) + KEEP_DAYS * 86_400
  }
}
