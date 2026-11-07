import { webFrameMain, type WebContents } from 'electron'

/** Its own world, so the page's scripts can't see or change it. */
const WORLD = 1011

/**
 * Words on a reject button, in the languages sites use most. Whole labels only, so "Reject" in
 * a sentence or "Accept all" can never match. Nothing here ever presses accept.
 */
export const REJECT_WORDS = String.raw`^(?:(?:reject|decline|deny|refuse|disagree)(?: all| everything)?(?: (?:optional |non-essential |additional |unnecessary )?cookies)?|(?:i )?(?:do not|don't) (?:accept|agree)|(?:only |use |accept |allow )?(?:only )?(?:strictly )?(?:necessary|essential|required)(?: cookies)?(?: only)?|continue without (?:accepting|agreeing)|(?:alle )?ablehnen|nur (?:notwendige|essenzielle|erforderliche)(?: cookies)?(?: (?:zulassen|akzeptieren|erlauben|verwenden))?|tout refuser|refuser(?: tout)?|continuer sans accepter|rechazar(?: todo| todas)?|rifiuta(?: tutto| tutti)?|(?:alles |alle )?weigeren|recusar(?: tudo| todos)?|rejeitar(?: tudo| todos)?|odrzuć(?: wszystkie)?|avvisa alla|afvis(?: alle)?|hylkää(?: kaikki)?|avslå(?: alla| alle)?|odmítnout(?: vše)?|elutasít(?:ás)?)$`

/** Banners from the common consent tools: how to spot one, and its reject button. */
const KNOWN = [
  ['#onetrust-banner-sdk, #onetrust-consent-sdk', '#onetrust-reject-all-handler, .ot-pc-refuse-all-handler'],
  ['#CybotCookiebotDialog', '#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'],
  ['#didomi-host, #didomi-notice', '#didomi-notice-disagree-button, .didomi-continue-without-agreeing'],
  ['.qc-cmp2-container', ''],
  ['#truste-consent-track', '#truste-consent-required'],
  ['.cky-consent-container', '.cky-btn-reject'],
  ['.cmplz-cookiebanner', '.cmplz-deny'],
  ['.osano-cm-dialog', '.osano-cm-denyAll'],
  ['#iubenda-cs-banner', '.iubenda-cs-reject-btn'],
  ['.klaro .cookie-notice, .klaro .cookie-modal', '.cm-btn-decline'],
  ['#axeptio_overlay', '#axeptio_btn_dismiss'],
  ['#BorlabsCookieBox', '[data-cookie-refuse]'],
  ['#cookiescript_injected', '#cookiescript_reject'],
  ['#moove_gdpr_cookie_info_bar', '.moove-gdpr-infobar-reject-btn'],
  ['#cmpbox', '.cmpboxbtnno'],
  ['.termly-styles-root, #termly-code-snippet-support', '[data-tid="banner-decline"]']
]

/** Consent tools that draw inside a shadow root, which the plain search can't see into. */
const SHADOW = [
  ['#usercentrics-root', '[data-testid="uc-deny-all-button"]'],
  ['#usercentrics-cmp-ui', '#deny, [data-action-type="deny"]']
]

/** Names that mark an element as part of a consent banner, for sites with their own. */
const BANNER_NAMES = String.raw`cookie|consent|gdpr|privacy[-_ ]?(?:banner|notice|popup|prompt)|\bcmp\b|onetrust|didomi|cybot|usercentrics|truste|qc-cmp|sp_message`

const SCRIPT = (wholePage: boolean) => `(() => {
  if (window.__scterraCookies) return
  window.__scterraCookies = true
  const REJECT = new RegExp(${JSON.stringify(REJECT_WORDS)}, 'i')
  const BANNER = new RegExp(${JSON.stringify(BANNER_NAMES)}, 'i')
  const KNOWN = ${JSON.stringify(KNOWN)}
  const SHADOW = ${JSON.stringify(SHADOW)}
  const WHOLE_PAGE = ${wholePage}
  const BUTTONS = 'button, [role=button], input[type=button], input[type=submit], a'
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim()
  const visible = (el) => {
    const box = el.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
  }
  const inBanner = (el) => {
    for (let node = el; node && node !== document.documentElement; node = node.parentElement || node.getRootNode().host) {
      const names = [node.id, typeof node.className === 'string' ? node.className : '', node.getAttribute && node.getAttribute('aria-label'), node.getAttribute && node.getAttribute('aria-describedby')].join(' ')
      if (BANNER.test(names)) return true
    }
    return false
  }
  const rejectIn = (root) => {
    for (const el of root.querySelectorAll(BUTTONS)) {
      const text = label(el)
      if (text.length > 0 && text.length <= 60 && REJECT.test(text) && visible(el)) return el
    }
    return null
  }
  const find = () => {
    for (const [banner, reject] of KNOWN) {
      const box = document.querySelector(banner)
      if (!box || !visible(box)) continue
      const button = reject && box.ownerDocument.querySelector(reject)
      if (button && visible(button)) return button
      const byText = rejectIn(box)
      if (byText) return byText
    }
    for (const [host, reject] of SHADOW) {
      const root = document.querySelector(host)?.shadowRoot
      if (!root) continue
      const button = root.querySelector(reject)
      if (button && visible(button)) return button
      const byText = rejectIn(root)
      if (byText) return byText
    }
    for (const el of document.querySelectorAll(BUTTONS)) {
      const text = label(el)
      if (text.length > 0 && text.length <= 60 && REJECT.test(text) && (WHOLE_PAGE || inBanner(el)) && visible(el)) return el
    }
    return null
  }
  let presses = 0
  let lastPress = 0
  const started = Date.now()
  const attempt = () => {
    // A second layer sometimes follows the first, so allow two, a moment apart.
    if (presses >= 2 || Date.now() - lastPress < 800) return
    const button = find()
    if (!button) return
    presses++
    lastPress = Date.now()
    button.click()
  }
  let queued = false
  const observer = new MutationObserver(() => {
    if (queued) return
    queued = true
    setTimeout(() => { queued = false; attempt() }, 250)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
  attempt()
  const timer = setInterval(() => {
    attempt()
    // Banners show within the first moments, and watching longer only costs the page.
    if (Date.now() - started > 15000 || presses >= 2) {
      clearInterval(timer)
      observer.disconnect()
    }
  }, 1000)
})()`

/** Consent screens that are whole pages, where every reject button is part of the banner. */
const CONSENT_PAGES = /^consent\.(google|youtube)\.[a-z.]+$/

/** Consent tools that draw in their own frame, from these hosts. */
const CONSENT_FRAMES = /(^|\.)(privacy-mgmt\.com|consent-pref\.trustarc\.com|cmp\.quantcast\.com|consentcdn\.cookiebot\.com)$/

/** Presses the reject button of a cookie banner on the page, if it has one. */
export function rejectCookieBanner(contents: WebContents): void {
  const url = contents.getURL()
  if (contents.isDestroyed() || !/^https?:/i.test(url)) return
  const host = new URL(url).hostname
  void contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SCRIPT(CONSENT_PAGES.test(host)) }]).catch(() => undefined)
}

/**
 * Banners in a consent tool's own frame. Electron can only reach a subframe's main world, so this
 * runs there, and only in frames from the hosts above, which hold nothing but the banner.
 */
export function watchConsentFrames(contents: WebContents, enabled: () => boolean): void {
  contents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
    if (isMainFrame || !enabled()) return
    const frame = webFrameMain.fromId(processId, routingId)
    if (!frame || !URL.canParse(frame.url) || !CONSENT_FRAMES.test(new URL(frame.url).hostname)) return
    void frame.executeJavaScript(SCRIPT(true)).catch(() => undefined)
  })
}
