import type { WebContents } from 'electron'
import { MAX_TAB_TEXT_QUERY, MIN_TAB_TEXT_QUERY, type TabId, type TabTextMatch } from '@scbrowser/shared'

const WORLD = 1021
/** A page that takes longer than this to answer is left out rather than holding up the list. */
const READ_MS = 800
const MAX_TABS = 60
/** How long a page's words are kept in its isolated world between searches. */
const TEXT_KEPT_MS = 15_000

/** Reads the page's visible words in an isolated world and finds the first place the words are. */
const findScript = (query: string) => `((q) => {
  // Reading the words lays the page out, so they're kept a little while for the next key typed.
  const kept = globalThis.__scTabText
  const fresh = kept && kept.url === location.href && Date.now() - kept.at < ${TEXT_KEPT_MS}
  const text = fresh ? kept.text : document.body ? document.body.innerText : ''
  if (!fresh) globalThis.__scTabText = { url: location.href, at: Date.now(), text }
  const lower = text.toLowerCase()
  const at = lower.indexOf(q)
  if (at === -1) return null
  let count = 0
  for (let i = at; i !== -1 && count < 99; i = lower.indexOf(q, i + q.length)) count++
  const start = Math.max(0, at - 48)
  const end = Math.min(text.length, at + q.length + 72)
  const tidy = (part) => part.replace(/\\s+/g, ' ')
  return {
    before: (start > 0 ? '…' : '') + tidy(text.slice(start, at)).trimStart(),
    match: tidy(text.slice(at, at + q.length)),
    after: tidy(text.slice(at + q.length, end)).trimEnd() + (end < text.length ? '…' : ''),
    count
  }
})(${JSON.stringify(query)})`

/**
 * Tabs whose pages hold the words, for Tab search. Only tabs that are awake have words to read;
 * nothing leaves the computer, and pages never see the search.
 */
export async function tabTextMatches(query: string, tabs: { id: TabId; contents: WebContents | undefined; url: string }[]): Promise<TabTextMatch[]> {
  const words = query.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_TAB_TEXT_QUERY)
  if (words.length < MIN_TAB_TEXT_QUERY) return []
  const readable = tabs.filter((tab) => tab.contents && !tab.contents.isDestroyed() && /^(https?|file):/i.test(tab.url)).slice(0, MAX_TABS)
  const found = await Promise.all(
    readable.map(async ({ id, contents }) => {
      const read = contents!.executeJavaScriptInIsolatedWorld(WORLD, [{ code: findScript(words) }]).catch(() => null)
      const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_MS))
      const match = (await Promise.race([read, late])) as Omit<TabTextMatch, 'id'> | null
      return match && typeof match.match === 'string' ? { id, ...match } : null
    })
  )
  return found.filter((match): match is TabTextMatch => match !== null)
}
