import type { WebContents } from 'electron'
import { parseTranslation, rewritePrompt, translatePrompt, type RewriteStyle } from '@scbrowser/ai'
import type { TranslateLanguage } from '@scbrowser/shared'
import { translateWithGoogle } from './googleTranslate'
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

interface BatchLimits {
  chars: number
  items: number
  batches: number
}
/** A model's replies cost credit and take time, so it's kept to the start of long pages. */
const AI_LIMITS: BatchLimits = { chars: MAX_BATCH_CHARS, items: Number.POSITIVE_INFINITY, batches: MAX_BATCHES }
/** Enough for most long articles, without looking like a flood of requests. */
const GOOGLE_LIMITS: BatchLimits = { chars: 4500, items: 120, batches: 25 }

function batches(texts: string[], limits: BatchLimits): { start: number; texts: string[] }[] {
  const result: { start: number; texts: string[] }[] = []
  let current: string[] = []
  let size = 0
  let start = 0
  texts.forEach((text, index) => {
    if ((size + text.length > limits.chars || current.length >= limits.items) && current.length > 0) {
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
async function translatePage(contents: WebContents, limits: BatchLimits, translate: (texts: string[]) => Promise<string[] | null>): Promise<TranslateOutcome> {
  const texts = await run<string[] | null>(contents, COLLECT)
  if (texts === null) return 'restored'
  const all = batches(texts, limits)
  const chosen = all.slice(0, limits.batches)
  let done = 0
  for (const batch of chosen) {
    const translated = await translate(batch.texts).catch(() => null)
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

export const togglePageTranslation = (contents: WebContents, ai: AiService, language: string) =>
  translatePage(contents, AI_LIMITS, async (texts) => parseTranslation(await ai.complete(translatePrompt(language), JSON.stringify(texts)), texts.length))

export const togglePageGoogleTranslation = (contents: WebContents, language: TranslateLanguage) =>
  translatePage(contents, GOOGLE_LIMITS, (texts) => translateWithGoogle(texts, language))

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
