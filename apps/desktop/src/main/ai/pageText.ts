import type { WebContents } from 'electron'
import readabilitySource from '@mozilla/readability/Readability.js?raw'
import { formatTranscript } from '@scbrowser/ai'
import { effectiveUrl, PDF_PAGE_URL, type ContextSource } from '@scbrowser/shared'
import type { ReaderArticle } from '../internal/reader'
import { readPdf } from './pdfText'

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

  const article = await run<{ title: string; text: string }>(contents, ARTICLE)
  return { url, ...article, source: 'page' }
}
