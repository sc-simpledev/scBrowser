import type { Session } from 'electron'
import { SIGN_IN_HOSTS } from '@scbrowser/shared'

// Chromium only lets the real hosts load over HTTPS, so tests use a stand-in.
const hosts: readonly string[] = process.env.SCB_E2E && process.env.SCB_SIGN_IN_HOST ? [process.env.SCB_SIGN_IN_HOST] : SIGN_IN_HOSTS

export const isGoogleSignIn = (url: string) => URL.canParse(url) && hosts.includes(new URL(url).hostname)

/** Taken before the app removes Electron from its everyday user agent. */
let ownUserAgent = ''
export const rememberOwnUserAgent = (userAgent: string) => {
  ownUserAgent = userAgent.replace(/\s(scTerra|scDelta|scBrowser|@scbrowser\/desktop)\/\S+/gi, '')
}

/**
 * Google rejects Chromium browsers that claim to be something they aren't: a clean Chrome
 * identity gets its full checks, which Electron fails, and Firefox contradicts what the page
 * can see. It accepts Electron saying so, so its sign-in pages alone are told the truth, along
 * with what they load. The tab's own user agent must stay as it is: changing it mid-navigation
 * makes Chromium reload the page before and drop the navigation. Scripts on these pages get the
 * same answer from `preload/internal.ts`.
 */
export function attachGoogleSignIn(target: Session): void {
  target.webRequest.onBeforeSendHeaders(({ url, resourceType, referrer, requestHeaders }, callback) => {
    // The referrer rather than the frame, as a frame can be gone by now and the request must always get an answer.
    const signingIn = isGoogleSignIn(url) || (resourceType !== 'mainFrame' && isGoogleSignIn(referrer))
    if (signingIn) return callback({ requestHeaders: { ...requestHeaders, 'User-Agent': ownUserAgent } })
    if (isWebStore(url) || isWebStore(referrer)) return callback({ requestHeaders: withChromeBrand(requestHeaders) })
    callback({ requestHeaders })
  })
}

const WEB_STORE = 'chromewebstore.google.com'
const isWebStore = (url: string | undefined) => !!url && URL.canParse(url) && new URL(url).hostname === WEB_STORE

/**
 * The Chrome Web Store asks people to switch to Chrome unless the client hints name Google Chrome.
 * Scripts on the store get the same brands from `preload/internal.ts`.
 */
export function withChromeBrand(headers: Record<string, string>): Record<string, string> {
  const major = process.versions.chrome?.split('.')[0] ?? '140'
  const next: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) if (name.toLowerCase() !== 'sec-ch-ua') next[name] = value
  next['sec-ch-ua'] = `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not_A Brand";v="24"`
  return next
}
