import type { WebContents } from 'electron'
import readabilitySource from '@mozilla/readability/Readability.js?raw'

/** A private JS world: the page can't see this code or tamper with what it reads. */
const ISOLATED_WORLD = 1001
const MIN_ARTICLE_CHARS = 200

const EXTRACT = `(() => {
  ${readabilitySource}
  try {
    const article = new Readability(document.cloneNode(true)).parse()
    if (article && article.textContent && article.textContent.trim().length > ${MIN_ARTICLE_CHARS}) {
      return { title: article.title || document.title, text: article.textContent.trim() }
    }
  } catch {}
  return { title: document.title, text: document.body ? document.body.innerText : '' }
})()`

export interface PageText {
  title: string
  url: string
  text: string
}

/** Reads the main text of a web page; returns null for pages that aren't web content. */
export async function extractPageText(contents: WebContents): Promise<PageText | null> {
  const url = contents.getURL()
  if (!/^(https?|file):/i.test(url)) return null
  const result = (await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: EXTRACT }])) as {
    title: string
    text: string
  }
  return { url, title: result.title, text: result.text }
}
