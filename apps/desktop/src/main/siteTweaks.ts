import type { WebContents } from 'electron'
import { isSafeSelector, siteTweakCss, type Settings } from '@scbrowser/shared'

/** Its own world, so the page's scripts can't see or change the picker. */
const WORLD = 1012

const inserted = new WeakMap<WebContents, string>()
/** One update at a time per page, or two at once could each add CSS and only one be taken away. */
const queues = new WeakMap<WebContents, Promise<void>>()

/** Hides what the person picked on this site and adds their own CSS. Replaces whatever it added before. */
export function applySiteTweaks(contents: WebContents, settings: Pick<Settings, 'hiddenElements' | 'siteCss'>): Promise<void> {
  const next = (queues.get(contents) ?? Promise.resolve()).then(() => applyNow(contents, settings)).catch(() => undefined)
  queues.set(contents, next)
  return next
}

async function applyNow(contents: WebContents, settings: Pick<Settings, 'hiddenElements' | 'siteCss'>): Promise<void> {
  if (contents.isDestroyed()) return
  const old = inserted.get(contents)
  inserted.delete(contents)
  if (old) await contents.removeInsertedCSS(old).catch(() => undefined)
  const url = contents.getURL()
  if (!/^https?:/i.test(url) || contents.isDestroyed()) return
  const css = siteTweakCss(new URL(url).hostname, settings.hiddenElements, settings.siteCss)
  if (!css) return
  // Page level, not user level: Electron 45 says it removes user-level CSS, but the page keeps it.
  const key = await contents.insertCSS(css, { cssOrigin: 'author' }).catch(() => null)
  if (key) inserted.set(contents, key)
}

/**
 * A full-page shield in a closed shadow root, so the page never gets the clicks while picking.
 * It outlines what's under the pointer; the wheel or arrow keys pick a bigger or smaller part.
 * Settles with a selector for the part, or null if the person backed out.
 */
const PICKER = (tip: string) => String.raw`new Promise((resolve) => {
  if (window.__scterraPicking) return resolve(null)
  window.__scterraPicking = true
  const ACCENT = 'oklch(0.65 0.105 200)'
  const host = document.createElement('scterra-picker')
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; display: block;'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = '<style>' +
    '.box { position: fixed; pointer-events: none; border: 2px solid ' + ACCENT + '; background: oklch(0.65 0.105 200 / 0.14); border-radius: 4px; display: none; }' +
    '.tag { position: fixed; pointer-events: none; font: 500 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace; color: #fff; background: ' + ACCENT + '; padding: 0 6px; border-radius: 4px; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: none; }' +
    '.tip { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); font: 12px/18px system-ui, sans-serif; color: #f4f4f5; background: rgb(24 24 27 / 0.94); border: 1px solid rgb(255 255 255 / 0.12); padding: 6px 10px; border-radius: 6px; pointer-events: none; white-space: nowrap; }' +
    '</style><div class="box"></div><div class="tag"></div><div class="tip">' + ${JSON.stringify(tip)} + '</div>'
  const box = root.querySelector('.box')
  const tag = root.querySelector('.tag')
  let chain = []
  let depth = 0
  // Names a build tool made up, like css-1x2y3z, change between visits, so they're left out.
  const okName = (name) => {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,60}$/.test(name) || /\d{4,}/.test(name)) return false
    const core = name.replace(/^[a-z]+[-_]/i, '')
    return !(core.length >= 5 && !/[-_]/.test(core) && /[a-z]/i.test(core) && (core.match(/\d/g) || []).length >= 2)
  }
  const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1 } catch { return false } }
  const selectorFor = (el) => {
    if (el.id && okName(el.id) && unique('#' + el.id)) return '#' + el.id
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 8) {
      if (node === document.body) { parts.unshift('body'); break }
      if (node.id && okName(node.id) && unique('#' + node.id)) { parts.unshift('#' + node.id); break }
      let part = /^[a-z][a-z0-9-]*$/.test(node.localName) ? node.localName : '*'
      const classes = [...node.classList].filter(okName).slice(0, 2)
      part += classes.map((name) => '.' + name).join('')
      const parent = node.parentElement
      if (parent) {
        const same = [...parent.children].filter((child) => child.localName === node.localName && classes.every((name) => child.classList.contains(name)))
        if (same.length > 1) part += ':nth-of-type(' + ([...parent.children].filter((child) => child.localName === node.localName).indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      const selector = parts.join(' > ')
      if (unique(selector)) return selector
      node = parent
    }
    return parts.join(' > ')
  }
  const show = () => {
    const el = chain[depth]
    if (!el) { box.style.display = 'none'; tag.style.display = 'none'; return }
    const rect = el.getBoundingClientRect()
    Object.assign(box.style, { display: 'block', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' })
    tag.textContent = el.localName + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 2).map((name) => '.' + name).join('') + '  ' + Math.round(rect.width) + ' × ' + Math.round(rect.height)
    Object.assign(tag.style, { display: 'block', left: Math.max(4, rect.left) + 'px', top: (rect.top > 22 ? rect.top - 20 : rect.bottom + 4) + 'px' })
  }
  const pointAt = (x, y) => {
    const el = document.elementsFromPoint(x, y).find((candidate) => candidate !== host && candidate !== document.documentElement && candidate !== document.body)
    if (!el || el === chain[0]) return
    chain = []
    for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) chain.push(node)
    depth = 0
    show()
  }
  const finish = (result) => {
    host.remove()
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('scroll', show, true)
    window.__scterraPicking = false
    resolve(result)
  }
  const onKey = (event) => {
    if (event.key === 'Escape') finish(null)
    else if (event.key === 'ArrowUp') depth = Math.min(chain.length - 1, depth + 1)
    else if (event.key === 'ArrowDown') depth = Math.max(0, depth - 1)
    else if (event.key === 'Enter' && chain[depth]) return finish(selectorFor(chain[depth]))
    else return
    event.preventDefault()
    event.stopImmediatePropagation()
    show()
  }
  host.addEventListener('pointermove', (event) => pointAt(event.clientX, event.clientY))
  host.addEventListener('wheel', (event) => {
    event.preventDefault()
    depth = event.deltaY < 0 ? Math.min(chain.length - 1, depth + 1) : Math.max(0, depth - 1)
    show()
  }, { passive: false })
  host.addEventListener('contextmenu', (event) => { event.preventDefault(); finish(null) })
  host.addEventListener('click', (event) => {
    event.preventDefault()
    pointAt(event.clientX, event.clientY)
    finish(chain[depth] ? selectorFor(chain[depth]) : null)
  })
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('scroll', show, true)
  document.documentElement.appendChild(host)
})`

/** Lets the person click the part of the page to hide. Null if they backed out or the page moved on. */
const TIPS = {
  hide: 'Click the part to hide. Scroll or use the arrow keys for a bigger or smaller part. Esc cancels.',
  watch: 'Click the part to watch for changes. Scroll or use the arrow keys for a bigger or smaller part. Esc cancels.'
}

export async function pickElement(contents: WebContents, purpose: keyof typeof TIPS = 'hide'): Promise<string | null> {
  if (contents.isDestroyed() || !/^https?:/i.test(contents.getURL())) return null
  contents.focus()
  const picked = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: PICKER(TIPS[purpose]) }], true).catch(() => null)) as unknown
  return isSafeSelector(picked) ? picked : null
}
