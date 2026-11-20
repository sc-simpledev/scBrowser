import type { WebContents } from 'electron'
import readabilitySource from '@mozilla/readability/Readability.js?raw'
import { formatTranscript } from '@scbrowser/ai'
import { effectiveUrl, PDF_PAGE_URL, type ContextSource } from '@scbrowser/shared'
import type { ReaderArticle } from '../internal/reader'
import { readPdf } from './pdfText'
import { pageText, type PageView } from './pageView'

/** A private JS world: the page can't see this code or tamper with what it reads. */
const ISOLATED_WORLD = 1001
const MIN_ARTICLE_CHARS = 200
const TRANSCRIPT_WAIT_MS = 6000
const SCAN_WAIT_MS = 180_000

const ARTICLE = `(() => {
  ${readabilitySource}
  try {
    const article = new Readability(document.cloneNode(true)).parse()
    if (article && article.textContent && article.textContent.trim().length > ${MIN_ARTICLE_CHARS}) {
      return { title: article.title || document.title, text: article.textContent.trim() }
    }
  } catch {}
  return { title: document.title, text: document.body ? document.body.innerText : '' }
})()`

// YouTube has no public transcript API and its caption URLs now need a token only its
// player can make, so this does what a person would: press "Show transcript" and read it.
const YOUTUBE_TRANSCRIPT = `(async () => {
  const SEGMENTS = 'ytd-transcript-segment-renderer, transcript-segment-view-model'
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const read = () => [...document.querySelectorAll(SEGMENTS)].map((segment) => segment.innerText)
  const title = document.querySelector('ytd-watch-metadata h1')?.innerText || document.title
  let segments = read()
  if (segments.length === 0) {
    document.querySelector('#description-inline-expander #expand')?.click()
    await sleep(300)
    const button = document.querySelector('ytd-video-description-transcript-section-renderer button')
    if (!button) return null
    button.click()
    for (let waited = 0; waited < ${TRANSCRIPT_WAIT_MS} && segments.length === 0; waited += 200) {
      await sleep(200)
      segments = read()
    }
  }
  return segments.length > 0 ? { title, segments } : null
})()`

/**
 * The whole page as structured text, for pages that aren't one article: headings, paragraphs, lists,
 * tables, links, buttons, form fields and image descriptions, in reading order, through open shadow
 * roots and same-site frames. What's on screen now comes first, as that's usually what "this" means.
 * Private fields (passwords, card numbers, one-time codes) never have their values read.
 */
const PAGE_VIEW = `(() => {
  const MAX = 150000
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'META', 'LINK', 'HEAD'])
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'LI', 'TR', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION', 'DD', 'DT', 'FORM', 'FIELDSET', 'DETAILS', 'SUMMARY', 'TD', 'TH'])
  const private_ = (el) => el.type === 'password' || /cc-|password|one-time-code/.test(el.autocomplete || '') || /pass|card|cvv|cvc|ssn|secret|otp|pin\\b/i.test((el.name || '') + ' ' + (el.id || ''))
  const hidden = (el) => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true
    const style = getComputedStyle(el)
    return style.display === 'none' || style.visibility === 'hidden'
  }
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim()
  const labelOf = (el) => {
    const id = el.id && el.ownerDocument.querySelector('label[for="' + CSS.escape(el.id) + '"]')
    return clean(el.getAttribute('aria-label') || (id && id.innerText) || el.closest('label')?.innerText || el.placeholder || el.name || el.title || '')
  }
  const out = []
  let size = 0
  let line = ''
  const flush = () => {
    const text = clean(line)
    if (text && size < MAX) {
      out.push(text)
      size += text.length + 1
    }
    line = ''
  }
  const add = (text) => (line += ' ' + text)
  const links = new Map()
  const walk = (node, depth) => {
    if (size >= MAX || depth > 60) return
    if (node.nodeType === 3) return add(node.textContent)
    if (node.nodeType !== 1) return
    const el = node
    const tag = el.tagName
    if (SKIP.has(tag) || hidden(el)) return
    if (/^H[1-6]$/.test(tag)) {
      flush()
      line = '#'.repeat(Number(tag[1])) + ' ' + clean(el.innerText)
      return flush()
    }
    if (tag === 'IMG') {
      const alt = clean(el.alt || el.title)
      if (alt) add('[image: ' + alt + ']')
      return
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const kind = tag === 'INPUT' ? (el.type || 'text') : tag.toLowerCase()
      if (kind === 'hidden') return
      const name = labelOf(el)
      if (kind === 'checkbox' || kind === 'radio') return add('[' + (el.checked ? 'x' : ' ') + '] ' + name)
      if (kind === 'submit' || kind === 'button') return add('[button: ' + clean(el.value || name) + ']')
      const value = private_(el) ? '(private, not read)' : tag === 'SELECT' ? clean(el.selectedOptions[0]?.innerText) : clean(el.value).slice(0, 300)
      return add('[' + kind + ' field' + (name ? ' "' + name + '"' : '') + (value ? ': ' + value : '') + ']')
    }
    if (tag === 'BUTTON' || el.getAttribute('role') === 'button') {
      const name = clean(el.getAttribute('aria-label') || el.innerText)
      if (name) add('[button: ' + name.slice(0, 80) + ']')
      return
    }
    if (tag === 'IFRAME') {
      try {
        if (el.contentDocument?.body) {
          flush()
          walk(el.contentDocument.body, depth + 1)
          flush()
        }
      } catch {}
      return
    }
    if (tag === 'TABLE') {
      flush()
      let rows = 0
      for (const row of el.rows) {
        if (rows++ >= 40) {
          out.push('| … ' + (el.rows.length - 40) + ' more rows |')
          break
        }
        out.push('| ' + [...row.cells].map((cell) => clean(cell.innerText).slice(0, 120)).join(' | ') + ' |')
      }
      return
    }
    const block = BLOCK.has(tag)
    if (block) flush()
    if (tag === 'LI') line = '- '
    if (tag === 'A' && el.href && /^https?:/.test(el.href)) {
      const text = clean(el.innerText)
      if (text) {
        add(text)
        if (!links.has(el.href) && links.size < 150) links.set(el.href, text.slice(0, 80))
        return
      }
    }
    if (el.shadowRoot) for (const child of el.shadowRoot.childNodes) walk(child, depth + 1)
    for (const child of el.childNodes) walk(child, depth + 1)
    if (block) flush()
  }
  if (document.body) walk(document.body, 0)
  flush()
  // What's on screen right now, so "this" and "here" have something to point at.
  const seen = []
  let seenSize = 0
  const blocks = document.body ? document.body.querySelectorAll('h1,h2,h3,h4,p,li,td,th,button,a,label,figcaption,blockquote,pre,[role=heading]') : []
  for (const el of blocks) {
    if (seenSize > 3000) break
    const box = el.getBoundingClientRect()
    if (box.bottom < 0 || box.top > innerHeight || box.width === 0 || hidden(el)) continue
    if (el.parentElement?.closest('p,li,td,th,button,a,label,blockquote,pre')) continue
    const text = clean(el.innerText).slice(0, 300)
    if (!text) continue
    seen.push(text)
    seenSize += text.length
  }
  const description = document.querySelector('meta[name="description"],meta[property="og:description"]')?.content
  return {
    title: document.title,
    description: clean(description || ''),
    text: out.join('\\n'),
    visible: seen.join('\\n'),
    links: [...links].map(([href, text]) => '- ' + text + ': ' + href).join('\\n'),
    bodyChars: (document.body?.innerText || '').length,
    scrolled: Math.round((scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)) * 100)
  }
})()`

const READER = `(() => {
  ${readabilitySource}
  const article = new Readability(document.cloneNode(true)).parse()
  return article && article.content
    ? { title: article.title || document.title, byline: article.byline, html: article.content }
    : null
})()`

/** The article on a page for reader view, or null if there isn't one. */
export async function extractArticle(contents: WebContents): Promise<ReaderArticle | null> {
  const article = await run<Omit<ReaderArticle, 'url'> | null>(contents, READER).catch(() => null)
  return article && { ...article, url: contents.getURL() }
}

export class UnreadablePdfError extends Error {}

export interface PageText {
  title: string
  url: string
  text: string
  source: ContextSource
}

const isYouTubeWatch = (url: string) => {
  const { hostname, pathname } = new URL(url)
  return ['www.youtube.com', 'm.youtube.com', 'youtube.com'].includes(hostname) && pathname === '/watch'
}

const run = <T>(contents: WebContents, code: string) =>
  contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code }]) as Promise<T>

/** A scan has only pictures, so scTerra's PDF page recognises the text itself, on this computer. */
function readScan(contents: WebContents): Promise<string> {
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), SCAN_WAIT_MS))
  const reading = contents.executeJavaScript('window.scbReadScan?.() ?? ""').then((text: unknown) => (typeof text === 'string' ? text : ''))
  return Promise.race([reading.catch(() => ''), timeout])
}

/** Reads what the tab is showing: a video transcript, a PDF, or the page's main text. */
export async function extractContext(contents: WebContents): Promise<PageText | null> {
  const page = contents.getURL()
  const url = page.startsWith(PDF_PAGE_URL) ? effectiveUrl(page) : page
  if (!/^(https?|file):/i.test(url)) return null

  if (isYouTubeWatch(url)) {
    const video = await run<{ title: string; segments: string[] } | null>(contents, YOUTUBE_TRANSCRIPT).catch(() => null)
    if (video) return { url, title: video.title, text: formatTranscript(video.segments), source: 'transcript' }
  }

  if (page !== url || (await run<string>(contents, 'document.contentType')) === 'application/pdf') {
    const pdf = await readPdf(contents, url)
    if (!pdf) throw new UnreadablePdfError("This PDF couldn't be read. It may be locked, or too large.")
    const text = pdf.text || (page !== url ? await readScan(contents) : '')
    if (!text) throw new UnreadablePdfError("This PDF has no text to read, and nothing could be made out from its pictures.")
    return { url, title: pdf.title || contents.getTitle(), text, source: 'pdf' }
  }

  const [article, view] = await Promise.all([run<{ title: string; text: string }>(contents, ARTICLE), run<PageView>(contents, PAGE_VIEW).catch(() => null)])
  return { url, title: article.title, text: view ? pageText(article, view) : article.text, source: 'page' }
}
