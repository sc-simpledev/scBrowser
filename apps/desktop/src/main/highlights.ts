import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { highlightPage, MAX_HIGHLIGHT_CHARS, MAX_HIGHLIGHTS, MAX_NOTE_CHARS, type Highlight } from '@scbrowser/shared'
import { FIND_RANGE_JS } from './citations'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'highlights'
/** Its own world, so the page's scripts can't see what's marked. */
const WORLD = 1015

const MARK_CSS = '::highlight(scterra-mark) { background-color: oklch(0.88 0.14 95 / 0.6); color: inherit; }'

const PAINT = (texts: string[]) => `(() => {
  ${FIND_RANGE_JS}
  if (typeof Highlight !== 'function' || !CSS.highlights) return 0
  const ranges = ${JSON.stringify(texts)}.map(scterraFind).filter(Boolean)
  if (ranges.length > 0) CSS.highlights.set('scterra-mark', new Highlight(...ranges))
  else CSS.highlights.delete('scterra-mark')
  return ranges.length
})()`

/** Highlights by page. Kept on this computer, never synced, and none in private windows. */
export class HighlightStore {
  constructor(private readonly kv: KeyValueRepo) {}

  list(): Highlight[] {
    const saved = this.kv.get(KEY)
    return Array.isArray(saved) ? (saved as Highlight[]) : []
  }

  forPage(url: string): Highlight[] {
    const page = highlightPage(url)
    return this.list().filter((highlight) => highlight.url === page)
  }

  add(url: string, title: string, text: string): Highlight {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_HIGHLIGHT_CHARS)
    if (!clean) throw new Error('Select some words to highlight.')
    const page = highlightPage(url)
    const all = this.list()
    const existing = all.find((highlight) => highlight.url === page && highlight.text === clean)
    if (existing) return existing
    const highlight: Highlight = { id: randomUUID(), url: page, title: title.slice(0, 300), text: clean, note: '', createdAt: Date.now() }
    this.kv.set(KEY, [highlight, ...all].slice(0, MAX_HIGHLIGHTS))
    return highlight
  }

  setNote(id: string, note: string): void {
    this.kv.set(KEY, this.list().map((highlight) => (highlight.id === id ? { ...highlight, note: note.slice(0, MAX_NOTE_CHARS) } : highlight)))
  }

  remove(id: string): void {
    this.kv.set(KEY, this.list().filter((highlight) => highlight.id !== id))
  }

  /** Marks this page's highlights again. Words no longer on the page are simply not marked. */
  async paint(contents: WebContents): Promise<void> {
    const url = contents.getURL()
    if (contents.isDestroyed() || !/^(https?|file):/i.test(url)) return
    const texts = this.forPage(url).map((highlight) => highlight.text)
    if (texts.length === 0) return
    await contents.insertCSS(MARK_CSS, { cssOrigin: 'user' }).catch(() => undefined)
    await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: PAINT(texts) }]).catch(() => undefined)
  }
}
