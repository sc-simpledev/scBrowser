import type { WebContents } from 'electron'

/** Its own world, so the page's scripts can't see or change the check. */
const WORLD = 1010

/**
 * Chromium's own force-dark switch belongs to Chrome's browser code, which Electron doesn't have,
 * so this flips the page's colours instead, then flips pictures and video back so they look right.
 * A little less contrast than a plain inversion, so white pages become a soft dark grey rather than
 * pure black, and text isn't glaring. Pictures get the exact reverse, so they look as they were.
 *
 * Page level (`author`), not `user`: Electron 45's `removeInsertedCSS` silently does nothing for user
 * CSS, and this has to come off again when a page turns out to be dark after all.
 */
export const DARK_CSS = `
html { filter: invert(1) hue-rotate(180deg) contrast(0.9) !important; background: #fff !important; }
img, video, picture, canvas, iframe, embed, object, svg image, [style*="background-image"] {
  filter: contrast(1.111) hue-rotate(180deg) invert(1) !important;
}
picture img, picture video { filter: none !important; }
`

/**
 * True when the page is already dark, so it needs nothing. Checking only `body` turned dark sites
 * light: many paint their background on a wrapper and leave `body` see-through. This looks at what's
 * actually drawn at points across the window, falls back to the page's declared colour scheme for
 * the canvas, and also counts light text on the page as a sign of a dark one.
 */
export const ALREADY_DARK = `(() => {
  const luminance = (colour) => {
    const match = colour && colour.match(/[\\d.]+/g)
    if (!match || match.length < 3) return null
    const [r, g, b, a = 1] = match.map(Number)
    return a < 0.5 ? null : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }
  const root = document.documentElement
  if (!root) return true
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
  const declared = (getComputedStyle(root).colorScheme || '') + ' ' + (document.querySelector('meta[name="color-scheme"]')?.content || '')
  const canvas = /dark/.test(declared) && (prefersDark || !/light/.test(declared)) ? 0.1 : 1
  const backdrop = luminance(getComputedStyle(root).backgroundColor) ?? (document.body ? luminance(getComputedStyle(document.body).backgroundColor) : null) ?? canvas
  const width = innerWidth, height = innerHeight
  if (!width || !height) return backdrop < 0.45
  const points = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.08], [0.5, 0.92], [0.08, 0.5], [0.92, 0.5]]
  let dark = 0, light = 0
  for (const [fx, fy] of points) {
    let element = document.elementFromPoint(width * fx, height * fy)
    let value = null
    while (element && value === null) {
      value = luminance(getComputedStyle(element).backgroundColor)
      element = element.parentElement
    }
    if ((value ?? backdrop) < 0.45) dark++
    else light++
  }
  if (dark > light) return true
  const text = document.body ? luminance(getComputedStyle(document.body).color) : null
  return text !== null && text > 0.75 && dark > 0
})()`

const keys = new WeakMap<WebContents, string>()
const watched = new WeakSet<WebContents>()

async function check(contents: WebContents): Promise<void> {
  if (contents.isDestroyed() || !/^(https?|file):/.test(contents.getURL())) return clear(contents)
  const dark = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: ALREADY_DARK }]).catch(() => true)
  if (contents.isDestroyed()) return
  const applied = keys.has(contents)
  if (dark && applied) await clear(contents)
  else if (!dark && !applied) {
    // Marked first, so two checks at once can't both insert it.
    keys.set(contents, '')
    const key = await contents.insertCSS(DARK_CSS, { cssOrigin: 'author' }).catch(() => '')
    if (key && keys.get(contents) === '') keys.set(contents, key)
    else if (key && !contents.isDestroyed()) await contents.removeInsertedCSS(key).catch(() => undefined)
  }
}

async function clear(contents: WebContents): Promise<void> {
  const key = keys.get(contents)
  keys.delete(contents)
  if (key && !contents.isDestroyed()) await contents.removeInsertedCSS(key).catch(() => undefined)
}

/**
 * Called on each `dom-ready`. A page's own dark theme often arrives a moment later, from a script or a
 * late stylesheet, so it looks again once the page has loaded and once more shortly after, and takes
 * the darkening back off if the page turned dark by itself.
 */
export async function darkenPage(contents: WebContents): Promise<void> {
  await clear(contents)
  await check(contents)
  if (watched.has(contents)) return
  watched.add(contents)
  let timer: NodeJS.Timeout | undefined
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void check(contents), 1200)
  }
  contents.on('did-finish-load', () => {
    void check(contents)
    later()
  })
  contents.on('did-navigate-in-page', later)
  contents.once('destroyed', () => clearTimeout(timer))
}
