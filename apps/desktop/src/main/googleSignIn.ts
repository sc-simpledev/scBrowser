import { app, type Session, type WebContents } from 'electron'

// Chromium only lets the real host load over HTTPS, so tests use a stand-in.
const SIGN_IN_HOST = (process.env.SCB_E2E && process.env.SCB_SIGN_IN_HOST) || 'accounts.google.com'
/** Firefox 140 came out on this day, and a new version follows every four weeks. */
const FIREFOX_140 = Date.UTC(2025, 5, 24)
const FOUR_WEEKS = 28 * 86_400_000

export const isGoogleSignIn = (url: string) => URL.canParse(url) && new URL(url).hostname === SIGN_IN_HOST

const PLATFORMS: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Windows NT 10.0; Win64; x64',
  darwin: 'Macintosh; Intel Mac OS X 10.15'
}

/** A current one, so that it doesn't age into a browser Google calls out of date. */
export function firefoxUserAgent(platform: NodeJS.Platform = process.platform, now = Date.now()): string {
  const version = 140 + Math.max(0, Math.floor((now - FIREFOX_140) / FOUR_WEEKS))
  return `Mozilla/5.0 (${PLATFORMS[platform] ?? 'X11; Linux x86_64'}; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`
}

/**
 * Google refuses sign-in from Chromium browsers it doesn't recognise, calling them possibly
 * insecure, so its sign-in pages alone are told this is Firefox. Nothing else sees this, and
 * the hints Chromium adds would give it away. Other Electron browsers do the same.
 */
export function attachGoogleSignIn(target: Session): void {
  target.webRequest.onBeforeSendHeaders({ urls: [`*://${SIGN_IN_HOST}/*`] }, ({ requestHeaders }, callback) => {
    const headers = Object.fromEntries(Object.entries(requestHeaders).filter(([name]) => !/^sec-ch-ua/i.test(name)))
    callback({ requestHeaders: { ...headers, 'User-Agent': firefoxUserAgent() } })
  })
}

/** What the page's own scripts read has to match, and go back to normal when it leaves. */
export function followGoogleSignIn(contents: WebContents): void {
  const update = (url: string) => {
    const wanted = isGoogleSignIn(url) ? firefoxUserAgent() : app.userAgentFallback
    if (contents.getUserAgent() !== wanted) contents.setUserAgent(wanted)
  }
  contents.on('did-start-navigation', ({ url, isMainFrame }) => {
    if (isMainFrame) update(url)
  })
  contents.on('will-redirect', ({ url, isMainFrame }) => {
    if (isMainFrame) update(url)
  })
}
