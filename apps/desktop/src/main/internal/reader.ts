import { randomUUID } from 'node:crypto'
import { READER_PAGE_URL } from '@scbrowser/shared'
import { pageShell } from './shell'

export interface ReaderArticle {
  title: string
  byline: string | null
  /** HTML from Readability. It comes from a website, so the page's CSP forbids scripts. */
  html: string
  url: string
}

const MAX_ARTICLES = 20
const articles = new Map<string, ReaderArticle>()

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function storeArticle(article: ReaderArticle): string {
  const id = randomUUID()
  if (articles.size >= MAX_ARTICLES) articles.delete(articles.keys().next().value!)
  articles.set(id, article)
  return `${READER_PAGE_URL}?${new URLSearchParams({ id, url: article.url })}`
}

export const READER_CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const css = `
body { display: block; font-size: var(--sc-text-md); line-height: 1.7; }
main { display: block; translate: none; max-width: 680px; margin: 0 auto; padding: calc(var(--sc-space) * 12) calc(var(--sc-space) * 6); }
main > h1:first-child { margin-bottom: calc(var(--sc-space) * 2); text-align: left; font-size: var(--sc-text-xl); letter-spacing: -0.025em; }
h1, h2, h3 { line-height: var(--sc-leading-tight); }
p { color: inherit; margin: 0 0 calc(var(--sc-space) * 4); }
.byline { color: var(--sc-text-muted); font-size: var(--sc-text-sm); margin-bottom: calc(var(--sc-space) * 8); }
a { color: var(--sc-accent); }
img, video { max-width: 100%; height: auto; border-radius: var(--sc-radius-md); }
pre { overflow-x: auto; padding: calc(var(--sc-space) * 3); border-radius: var(--sc-radius-md); background: var(--sc-field); }
blockquote { margin-left: 0; padding-left: calc(var(--sc-space) * 4); border-left: 2px solid var(--sc-border-strong); color: var(--sc-text-muted); }`

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Readability often keeps the article's own heading, which would say the title twice. */
export function withoutRepeatedTitle(html: string, title: string): string {
  const first = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html.slice(0, 2000))
  if (!first || plain(first[1]!).toLowerCase() !== plain(title).toLowerCase()) return html
  return html.slice(0, first.index) + html.slice(first.index + first[0].length)
}

export function readerPage(id: string | null): string | null {
  const article = id ? articles.get(id) : undefined
  if (!article) return null
  const host = URL.canParse(article.url) ? new URL(article.url).host.replace(/^www\./, '') : ''
  const words = plain(article.html).split(' ').filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 230))
  const about = [article.byline, host, `${minutes} min read`].filter((part): part is string => !!part && part.trim().length > 0)
  const byline = `<div class="byline">${about.map(escapeHtml).join(' · ')}</div>`
  return pageShell(escapeHtml(article.title), css, `<main><h1>${escapeHtml(article.title)}</h1>${byline}${withoutRepeatedTitle(article.html, article.title)}</main>`)
}
