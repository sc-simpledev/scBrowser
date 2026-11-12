import type { WebContents } from 'electron'
import { aiTweaksOf, cleanAiCss, SITE_TWEAK_PROMPT, siteOf, siteTweakMessage, withAiTweak, withoutLastAiTweak, type Settings } from '@scbrowser/shared'

const WORLD = 1014

/**
 * The page's bones for the model to pick selectors from: landmarks and anything with an id or
 * class that's big enough to see, with its size and first words. No attribute values, links or
 * form contents, so nothing private on the page goes along.
 */
const OUTLINE = `(() => {
  const lines = []
  const okName = (name) => /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/.test(name)
  const walk = (el, depth) => {
    if (lines.length >= 160 || depth > 7) return
    for (const child of el.children) {
      if (lines.length >= 160) return
      const tag = child.tagName.toLowerCase()
      if (['script', 'style', 'noscript', 'svg', 'template', 'link', 'meta', 'br'].includes(tag)) continue
      const rect = child.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 16) continue
      const classes = [...child.classList].filter(okName).slice(0, 3)
      const id = okName(child.id) ? '#' + child.id : ''
      const landmark = ['header', 'nav', 'main', 'aside', 'footer', 'article', 'section', 'form', 'h1', 'h2', 'dialog'].includes(tag) || child.hasAttribute('role')
      const named = id || classes.length > 0
      if (landmark || named) {
        const role = child.getAttribute('role')
        const words = (child.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40)
        lines.push('  '.repeat(depth) + tag + id + classes.map((name) => '.' + name).join('') + (role && okName(role) ? '[role=' + role + ']' : '') + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + (words ? ' "' + words + '"' : ''))
        walk(child, depth + 1)
      } else walk(child, depth)
    }
  }
  walk(document.body, 0)
  return lines.join('\\n')
})()`

export interface SiteTweakDeps {
  settings: { get: () => Settings; set: (patch: Partial<Settings>) => void }
  ready: () => boolean
  isSiteOff: (host: string) => boolean
  complete: (system: string, user: string) => Promise<string>
}

/**
 * Changes how the page's site looks from a plain request, by asking the AI for CSS and adding it
 * to the site's own CSS. "undo" (or nothing) takes the newest change back out. Returns what to
 * tell the person.
 */
export async function tweakSite(contents: WebContents | undefined, request: string, deps: SiteTweakDeps): Promise<string> {
  const url = contents && !contents.isDestroyed() ? contents.getURL() : ''
  const site = siteOf(url)
  if (!contents || !site) return 'Only websites can be changed. Open the site first, then try again.'
  const { siteCss } = deps.settings.get()
  const existing = siteCss[site] ?? ''
  const save = (css: string) => {
    const { [site]: _old, ...others } = deps.settings.get().siteCss
    deps.settings.set({ siteCss: css.trim() ? { ...others, [site]: css } : others })
  }
  if (!request || /^(undo|remove|reset)$/i.test(request)) {
    const made = aiTweaksOf(existing)
    if (made.length === 0) return request ? `There are no AI changes on ${site} to undo.` : 'Say what to change, like: /tweak hide the sidebar and make the text bigger'
    save(withoutLastAiTweak(existing))
    return `Took back “${made.at(-1)}” on ${site}.`
  }
  if (!deps.ready()) return 'Choose a model in AI settings first.'
  if (deps.isSiteOff(new URL(url).host)) return 'AI is off for this site.'
  const outline = String((await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: OUTLINE }]).catch(() => '')) ?? '').slice(0, 12_000)
  if (!outline) return "This page can't be read, so nothing was changed."
  const css = cleanAiCss(await deps.complete(SITE_TWEAK_PROMPT, siteTweakMessage(site, request, outline, existing)))
  if (!css) return "That couldn't be done with a style change. Try describing the part of the page differently."
  const next = withAiTweak(existing, request, css)
  if (!next) return `${site} already has as much custom CSS as it can hold. Remove some in Settings, under Appearance.`
  save(next)
  return `Done: “${request}” on ${site}. It applies whenever you visit. Type /tweak undo to take it back, or edit it in Settings under Appearance, Page tweaks.`
}
