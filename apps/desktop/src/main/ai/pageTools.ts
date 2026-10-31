import type { WebContents } from 'electron'
import { parseTranslation, rewritePrompt, translatePrompt, type RewriteStyle } from '@scbrowser/ai'
import type { AiService } from './service'

const TRANSLATE_WORLD = 1004
const MAX_BATCH_CHARS = 4000
const MAX_BATCHES = 5

const COLLECT = `(() => {
  if (window.__scbOriginal) {
    for (const [node, text] of window.__scbOriginal) node.textContent = text
    window.__scbOriginal = null
    return null
  }
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA'])
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode() && nodes.length < 2000) {
    const node = walker.currentNode
    if (node.textContent.trim().length > 1 && /\\p{L}/u.test(node.textContent) && !skip.has(node.parentElement?.tagName)) nodes.push(node)
  }
  window.__scbNodes = nodes
  window.__scbOriginal = new Map()
  return nodes.map((node) => node.textContent.trim())
})()`

const apply = (start: number, texts: string[]) => `((start, texts) => {
  texts.forEach((text, index) => {
    const node = window.__scbNodes[start + index]
    window.__scbOriginal.set(node, node.textContent)
    node.textContent = text
  })
})(${start}, ${JSON.stringify(texts)})`

const run = <T>(contents: WebContents, code: string) =>
  contents.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD, [{ code }]) as Promise<T>

function batches(texts: string[]): { start: number; texts: string[] }[] {
  const result: { start: number; texts: string[] }[] = []
  let current: string[] = []
  let size = 0
  let start = 0
  texts.forEach((text, index) => {
    if (size + text.length > MAX_BATCH_CHARS && current.length > 0) {
      result.push({ start, texts: current })
      current = []
      size = 0
      start = index
    }
    current.push(text)
    size += text.length
  })
  if (current.length > 0) result.push({ start, texts: current })
  return result
}

export type TranslateOutcome = 'restored' | 'translated' | 'partly' | 'failed'

/** Translates the page in place, or restores it if it's already translated. */
export async function togglePageTranslation(contents: WebContents, ai: AiService, language: string): Promise<TranslateOutcome> {
  const texts = await run<string[] | null>(contents, COLLECT)
  if (texts === null) return 'restored'
  const all = batches(texts)
  const chosen = all.slice(0, MAX_BATCHES)
  let done = 0
  for (const batch of chosen) {
    const reply = await ai.complete(translatePrompt(language), JSON.stringify(batch.texts))
    const translated = parseTranslation(reply, batch.texts.length)
    if (!translated) continue
    await run(contents, apply(batch.start, translated))
    done++
  }
  if (done === 0) {
    await run(contents, 'window.__scbOriginal = null')
    return 'failed'
  }
  return done === all.length ? 'translated' : 'partly'
}

/** What's selected now, in a field or the page, so a slow reply can't overwrite something else. */
const SELECTED = `(() => {
  const element = document.activeElement
  if (element && typeof element.selectionStart === 'number') return element.value.slice(element.selectionStart, element.selectionEnd)
  return String(window.getSelection())
})()`

/** Replaces the selected text with a rewrite, as typing would, so undo works. */
export async function rewriteSelection(contents: WebContents, ai: AiService, text: string, style: RewriteStyle): Promise<boolean> {
  const rewritten = (await ai.complete(rewritePrompt(style), text)).trim()
  if (!rewritten || contents.isDestroyed()) return false
  const current = await contents.executeJavaScript(SELECTED)
  if (current !== text) return false
  await contents.insertText(rewritten)
  return true
}
