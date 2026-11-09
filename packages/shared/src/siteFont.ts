/** A font for one site, kept as a marked block inside that site's custom CSS so it syncs and shows in Page tweaks. */
export type SiteFont = 'default' | 'sans' | 'serif' | 'mono'

const FAMILIES: Record<Exclude<SiteFont, 'default'>, string> = { sans: 'system-ui, sans-serif', serif: 'Georgia, serif', mono: 'ui-monospace, monospace' }
const START = '/* scterra-font:'
const END = '/* end scterra-font */'
const BLOCK = /\/\* scterra-font:(\w+) \*\/[\s\S]*?\/\* end scterra-font \*\/\n?/

/** Text elements only, so sites' icon fonts keep working. */
const TEXT = 'body, p, li, td, th, dd, dt, blockquote, h1, h2, h3, h4, h5, h6, input, textarea, article, section'

export function siteFontOf(css: string): SiteFont {
  const font = BLOCK.exec(css)?.[1]
  return font === 'sans' || font === 'serif' || font === 'mono' ? font : 'default'
}

export function withSiteFont(css: string, font: SiteFont): string {
  const rest = css.replace(BLOCK, '')
  if (font === 'default') return rest
  return `${START}${font} */\n${TEXT} { font-family: ${FAMILIES[font]} !important; }\n${END}\n${rest}`
}

export const isSiteFont = (value: string): value is SiteFont => value === 'default' || value === 'sans' || value === 'serif' || value === 'mono'
