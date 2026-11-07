import type { WebContents } from 'electron'
import type { CitationTarget } from '@scbrowser/shared'

/** Its own world, so the page's scripts can't see or change what's marked. */
const WORLD = 1014

/**
 * Finds words in the page, ignoring spacing and case, as a Range, or null. Defines `scterraFind`
 * for the script that follows it. Only the page's text is read; its markup is left alone.
 */
export const FIND_RANGE_JS = `const scterraFind = (quote) => {
  const wanted = quote.replace(/\\s+/g, ' ').trim().toLowerCase()
  if (!wanted || !document.body) return null
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement && !node.parentElement.closest('script, style, noscript') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  })
  const nodes = []
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: text.length })
    text += node.data
  }
  // One pass to squash spaces, keeping where each character came from.
  let flat = ''
  const from = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    if (/\\s/.test(text[i])) {
      if (space) continue
      space = true
      flat += ' '
    } else {
      space = false
      flat += text[i].toLowerCase()
    }
    from.push(i)
  }
  const at = flat.indexOf(wanted)
  if (at < 0) return null
  const locate = (index) => {
    let low = 0
    for (let i = 0; i < nodes.length; i++) if (nodes[i].start <= index) low = i
    return { node: nodes[low].node, offset: index - nodes[low].start }
  }
  const start = locate(from[at])
  const end = locate(from[at + wanted.length - 1])
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, Math.min(end.node.data.length, end.offset + 1))
  return range
}`

/** Scrolls to the words and marks them with a CSS highlight. True if they were found. */
const REVEAL = (quote: string) => `(() => {
  ${FIND_RANGE_JS}
  const range = scterraFind(${JSON.stringify(quote)})
  if (!range) return false
  if (typeof Highlight === 'function' && CSS.highlights) CSS.highlights.set('scterra-cite', new Highlight(range))
  const box = range.getBoundingClientRect()
  scrollBy({ top: box.top - innerHeight / 3, behavior: 'smooth' })
  return true
})()`

const SEEK = (seconds: number) => `(() => {
  const video = document.querySelector('video')
  if (!video) return false
  video.currentTime = ${seconds}
  void video.play().catch(() => undefined)
  return true
})()`

const MARK_CSS = '::highlight(scterra-cite) { background-color: oklch(0.85 0.16 95 / 0.55); color: inherit; }'

/** Waits for a tab that's just woken or changed page to finish loading. */
const loaded = (contents: WebContents) =>
  contents.isLoading() ? new Promise<void>((resolve) => contents.once('did-stop-loading', () => resolve())) : Promise.resolve()

/** Goes to the words or moment a citation points at, in a tab that's already showing the page. */
export async function goToTarget(contents: WebContents, target: CitationTarget): Promise<boolean> {
  await loaded(contents)
  if (contents.isDestroyed()) return false
  if (target.seconds !== null) return (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SEEK(target.seconds) }]).catch(() => false)) === true
  if (!target.quote) return true
  await contents.insertCSS(MARK_CSS, { cssOrigin: 'user' }).catch(() => undefined)
  return (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: REVEAL(target.quote) }]).catch(() => false)) === true
}

/** The same page, ignoring the fragment, as a citation's tab may have scrolled to an anchor. */
export function samePage(a: string, b: string): boolean {
  if (!URL.canParse(a) || !URL.canParse(b)) return false
  const x = new URL(a)
  const y = new URL(b)
  const video = (url: URL) => url.searchParams.get('v')
  return x.origin === y.origin && x.pathname === y.pathname && video(x) === video(y)
}
