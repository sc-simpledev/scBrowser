import { MAX_SITE_CSS } from './siteTweaks'

/**
 * Changes to a site's look that the AI wrote from a plain request ("hide the sidebar"). Each is a
 * marked block inside that site's own CSS, so it syncs, shows in Page tweaks and can be taken out.
 */
const BLOCK = /\/\* scterra-ai: ([^*]*?) \*\/\n[\s\S]*?\/\* end scterra-ai \*\/\n?/g

export const MAX_TWEAK_REQUEST = 300
export const MAX_AI_TWEAK_CSS = 4_000

/** The request in "/tweak hide the sidebar", "undo" for "/tweak undo", or null for any other message. */
export function tweakCommand(text: string): string | null {
  const match = /^\/tweak(?:\s+([\s\S]+))?$/i.exec(text.trim())
  return match ? (match[1]?.trim() ?? '') : null
}

export const SITE_TWEAK_PROMPT = `You write CSS that changes how one website looks for the person using it, from their request and an outline of the page.

Reply with only CSS: no explanation, no Markdown fence. Rules:
- Use selectors from the outline (tags, ids, classes). Prefer ids and stable-looking class names; avoid names that look generated.
- Put !important on every declaration, as the site's own styles would otherwise win.
- To hide something use display: none !important.
- Only plain rules and @media. No @import, no url(), no fonts or images from anywhere, no content with links.
- Keep it short: only what the request needs.
If the request can't be done with CSS, reply with exactly: CANNOT`

export function siteTweakMessage(site: string, request: string, outline: string, existing: string): string {
  return `Site: ${site}\nRequest: ${request.slice(0, MAX_TWEAK_REQUEST)}\n\n${existing.trim() ? `CSS already added for this site:\n${existing.slice(0, 3_000)}\n\n` : ''}Page outline (indented by nesting; size in pixels; then the start of its text):\n${outline}`
}

/**
 * The CSS out of a reply, or null if there's none worth keeping. Anything that could load from
 * elsewhere or leave the stylesheet is refused rather than mended.
 */
export function cleanAiCss(reply: string): string | null {
  const css = reply
    .replace(/^\s*```(?:css)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
  if (!css || /^CANNOT\b/i.test(css) || css.length > MAX_AI_TWEAK_CSS) return null
  if (/@import|@font-face|@charset|@namespace|url\s*\(|expression\s*\(|javascript:|<\/?style|\\[0-9a-f]/i.test(css)) return null
  if (!/\{[^{}]*\}/.test(css)) return null
  // Balanced braces, so the block can't close early and swallow what follows.
  let depth = 0
  for (const char of css) {
    if (char === '{') depth++
    if (char === '}' && --depth < 0) return null
  }
  return depth === 0 ? css : null
}

/** Adds a block for this request. Null if the site's CSS would grow past its limit. */
export function withAiTweak(css: string, request: string, block: string): string | null {
  const label = request.replace(/[*/\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TWEAK_REQUEST)
  const next = `${css.trimEnd()}${css.trim() ? '\n' : ''}/* scterra-ai: ${label} */\n${block}\n/* end scterra-ai */\n`
  return next.length <= MAX_SITE_CSS ? next : null
}

/** The requests behind a site's AI tweaks, oldest first. */
export function aiTweaksOf(css: string): string[] {
  return [...css.matchAll(BLOCK)].map((match) => match[1]!)
}

/** Takes the newest AI tweak back out. */
export function withoutLastAiTweak(css: string): string {
  const blocks = [...css.matchAll(BLOCK)]
  const last = blocks.at(-1)
  return last ? css.slice(0, last.index) + css.slice(last.index + last[0].length) : css
}
