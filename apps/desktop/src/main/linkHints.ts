import type { WebContents } from 'electron'

const WORLD = 1019
/** Home-row letters first, as Vimium does, so most hints are easy to reach. */
export const HINT_LETTERS = 'sadfjklewcmpgh'
const MAX_HINTS = 600

/**
 * Labels for a number of targets, all the same length so none is the start of another: one letter
 * each while they fit, then two, and so on.
 */
export function hintLabels(count: number, letters = HINT_LETTERS): string[] {
  let length = 1
  while (letters.length ** length < count) length++
  return Array.from({ length: count }, (_, index) => {
    let label = ''
    for (let i = 0, rest = index; i < length; i++, rest = Math.floor(rest / letters.length)) label = letters[rest % letters.length] + label
    return label
  })
}

/**
 * Puts a letter or two on every link, button and field in view, in the page's isolated world, and
 * clicks (or focuses) the one whose letters are typed. Escape, a click, a scroll or leaving the
 * page takes them away; running it again does too. The page's own scripts never see the hints.
 */
const SCRIPT = `(() => {
  if (globalThis.__scHints) { globalThis.__scHints.stop(); return -1 }
  const SELECTOR = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,label[for],[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=treeitem],[onclick],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])'
  const width = innerWidth, height = innerHeight
  const found = []
  const seen = new Set()
  const look = (root, depth) => {
    for (const element of root.querySelectorAll(SELECTOR)) {
      if (found.length >= ${MAX_HINTS} || seen.has(element)) continue
      seen.add(element)
      if (element.disabled || element.getAttribute('aria-hidden') === 'true') continue
      const box = element.getClientRects()[0]
      if (!box || box.width < 2 || box.height < 2 || box.bottom < 0 || box.right < 0 || box.top > height || box.left > width) continue
      const style = getComputedStyle(element)
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
      // Something else drawn over its middle (a cookie banner, a menu) means it can't be clicked now.
      const x = Math.min(width - 1, Math.max(0, box.left + Math.min(box.width / 2, 12)))
      const y = Math.min(height - 1, Math.max(0, box.top + box.height / 2))
      const top = (element.getRootNode().elementFromPoint ? element.getRootNode() : document).elementFromPoint(x, y)
      if (top && top !== element && !element.contains(top) && !top.contains(element)) continue
      found.push({ element, left: Math.max(0, box.left), top: Math.max(0, box.top) })
    }
    if (depth < 3) for (const host of root.querySelectorAll('*')) if (host.shadowRoot) look(host.shadowRoot, depth + 1)
  }
  look(document, 0)
  if (!found.length) return 0
  const letters = ${JSON.stringify(HINT_LETTERS)}
  let length = 1
  while (letters.length ** length < found.length) length++
  const label = (index) => { let text = ''; for (let i = 0, rest = index; i < length; i++, rest = Math.floor(rest / letters.length)) text = letters[rest % letters.length] + text; return text }
  const host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none'
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = '.h{position:fixed;transform:translate(-2px,-2px);padding:1px 4px;border-radius:4px;background:#171717;color:#fafafa;font:600 11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;text-transform:uppercase;box-shadow:0 1px 3px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.22)}.h b{color:#8a8a8a;font-weight:600}.h.x{display:none}'
  shadow.append(style)
  const hints = found.map((target, index) => {
    const tag = document.createElement('span')
    tag.className = 'h'
    tag.style.left = target.left + 'px'
    tag.style.top = target.top + 'px'
    tag.textContent = label(index)
    shadow.append(tag)
    return { ...target, label: label(index), tag }
  })
  ;(document.documentElement || document.body).append(host)
  let typed = ''
  const stop = () => {
    host.remove()
    removeEventListener('keydown', onKey, true)
    removeEventListener('mousedown', stop, true)
    removeEventListener('scroll', stop, true)
    removeEventListener('blur', stop, true)
    removeEventListener('resize', stop, true)
    delete globalThis.__scHints
  }
  const choose = (element, background) => {
    stop()
    const field = element.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]),textarea,select,[contenteditable=""],[contenteditable=true]')
    element.focus({ preventScroll: true })
    if (field) return
    if (background && element.closest('a[href]')) {
      element.closest('a[href]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, ctrlKey: true, metaKey: navigator.platform.startsWith('Mac') }))
      return
    }
    element.click()
  }
  const onKey = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return stop()
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') return stop()
    if (event.key === 'Backspace') typed = typed.slice(0, -1)
    else if (event.key.length === 1 && letters.includes(event.key.toLowerCase())) typed += event.key.toLowerCase()
    else return
    let left = 0
    for (const hint of hints) {
      const fits = hint.label.startsWith(typed)
      hint.tag.classList.toggle('x', !fits)
      if (fits) {
        left++
        hint.tag.innerHTML = '<b>' + typed.toUpperCase() + '</b>' + hint.label.slice(typed.length).toUpperCase()
      }
    }
    const exact = hints.find((hint) => hint.label === typed)
    if (exact) return choose(exact.element, event.shiftKey)
    if (!left) stop()
  }
  addEventListener('keydown', onKey, true)
  addEventListener('mousedown', stop, true)
  addEventListener('scroll', stop, true)
  addEventListener('blur', stop, true)
  addEventListener('resize', stop, true)
  globalThis.__scHints = { stop }
  return hints.length
})()`

/** Shows link hints on the page, or takes them away if they're showing. How many it put up, or -1 when it took them away. */
export async function toggleLinkHints(contents: WebContents): Promise<number> {
  if (contents.isDestroyed()) return 0
  contents.focus()
  const shown = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SCRIPT }], true).catch(() => 0)
  return typeof shown === 'number' ? shown : 0
}
