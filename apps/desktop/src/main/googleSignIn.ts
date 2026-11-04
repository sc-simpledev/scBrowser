import { app, type Session, type WebContents } from 'electron'

// Chromium only lets the real hosts load over HTTPS, so tests use a stand-in.
const SIGN_IN_HOSTS = process.env.SCB_E2E && process.env.SCB_SIGN_IN_HOST ? [process.env.SCB_SIGN_IN_HOST] : ['accounts.google.com', 'accounts.youtube.com']

export const isGoogleSignIn = (url: string) => URL.canParse(url) && SIGN_IN_HOSTS.includes(new URL(url).hostname)

/** Taken before the app removes Electron from its everyday user agent. */
let ownUserAgent = ''
export const rememberOwnUserAgent = (userAgent: string) => {
  ownUserAgent = userAgent
}

/**
 * Google rejects Chromium browsers that claim to be something they aren't: a clean Chrome
 * identity gets its full checks, which Electron fails, and Firefox contradicts what the page
 * can see. It accepts Electron saying so, so its sign-in pages alone are told the truth. Other
 * sites keep the clean identity, as some of them turn Electron away. Client hints stay as they are.
 */
export function attachGoogleSignIn(target: Session): void {
  target.webRequest.onBeforeSendHeaders(({ url, resourceType, requestHeaders }, callback) => {
    // A tab's identity changes as its navigation starts, too late for that first request. What
    // a page loads for itself keeps the identity that page has.
    const userAgent = isGoogleSignIn(url) ? ownUserAgent : resourceType === 'mainFrame' ? app.userAgentFallback : null
    callback({ requestHeaders: userAgent ? { ...requestHeaders, 'User-Agent': userAgent } : requestHeaders })
  })
}

/** What the page's own scripts read has to match, and go back to normal when it leaves. */
export function followGoogleSignIn(contents: WebContents): void {
  const update = (url: string) => {
    const wanted = isGoogleSignIn(url) ? ownUserAgent : app.userAgentFallback
    if (contents.getUserAgent() !== wanted) contents.setUserAgent(wanted)
  }
  contents.on('did-start-navigation', ({ url, isMainFrame }) => {
    if (isMainFrame) update(url)
  })
  contents.on('will-redirect', ({ url, isMainFrame }) => {
    if (isMainFrame) update(url)
  })
}
