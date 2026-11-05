import type { WebContents } from 'electron'

/** Its own world, so the page's scripts can't see or change the check. */
const WORLD = 1010

/**
 * Chromium's own force-dark switch belongs to Chrome's browser code, which Electron doesn't have,
 * so turning it on did nothing. This flips the page's colours instead, then flips pictures and
 * video back so they look right. Pages that are already dark are left alone.
 */
const DARK_CSS = `
html { filter: invert(1) hue-rotate(180deg) !important; background: #fff !important; }
img, video, picture, canvas, iframe, embed, object, svg image, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }
picture img { filter: none !important; }
`

/** True when the page's own background is already dark, so it needs nothing. */
const ALREADY_DARK = `(() => {
  const paint = (element) => {
    if (!element) return null
    const match = getComputedStyle(element).backgroundColor.match(/[\\d.]+/g)
    if (!match) return null
    const [r, g, b, a = 1] = match.map(Number)
    return a < 0.5 ? null : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }
  const light = paint(document.body) ?? paint(document.documentElement) ?? 1
  return light < 0.45
})()`

const keys = new WeakMap<WebContents, string>()

export async function darkenPage(contents: WebContents): Promise<void> {
  if (contents.isDestroyed() || !/^(https?|file):/.test(contents.getURL())) return
  const old = keys.get(contents)
  keys.delete(contents)
  if (old) await contents.removeInsertedCSS(old).catch(() => undefined)
  const dark = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: ALREADY_DARK }]).catch(() => true)
  if (dark || contents.isDestroyed()) return
  keys.set(contents, await contents.insertCSS(DARK_CSS, { cssOrigin: 'user' }))
}
