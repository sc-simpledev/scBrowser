import { BrowserWindow, type WebContents } from 'electron'
import type { CoderCall } from '@scbrowser/ai'
import type { TabId, TabState } from '@scbrowser/shared'
import type { CoderBrowserHost } from './coder'
import { extractContext } from './pageText'

/** Its own isolated world, so page scripts never see what Terra Code runs. */
const WORLD = 1005
const LOAD_MS = 20_000
const SETTLE_MS = 600
const MAX_CONSOLE = 60
const SHOT_WIDTH = 1280

interface PreviewTab {
  id: TabId
  /** Warnings and errors the page logged since Terra Code last read it. */
  console: string[]
}

export interface BrowserDeps {
  create: (url: string) => TabId
  contentsFor: (id: TabId) => WebContents | undefined
  tabs: () => TabState[]
  isSiteOff: (url: string) => boolean
}

/** Gives up on a step that never answers, such as a capture of a page that draws nothing. */
const within = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<null>((done) => setTimeout(() => done(null), ms))])

/**
 * A picture of a tab. One on screen is captured as it is. A hidden one draws nothing, so its
 * address is loaded again in a hidden offscreen window with the same session, captured and closed:
 * that shows the page as it loads, not what clicks changed since.
 */
async function screenshot(contents: WebContents): Promise<{ url: string; width: number; height: number; fresh: boolean } | null> {
  const encode = (image: Electron.NativeImage, fresh: boolean) => {
    const shot = image.getSize().width > SHOT_WIDTH ? image.resize({ width: SHOT_WIDTH }) : image
    return { url: `data:image/jpeg;base64,${shot.toJPEG(75).toString('base64')}`, ...shot.getSize(), fresh }
  }
  const shown = await within(contents.capturePage(), 2000).catch(() => null)
  if (shown && !shown.isEmpty()) return encode(shown, false)
  const offscreen = new BrowserWindow({ show: false, width: SHOT_WIDTH, height: 800, webPreferences: { offscreen: true, session: contents.session, sandbox: true, javascript: true } })
  try {
    const loaded = new Promise<void>((done) => offscreen.webContents.once('did-stop-loading', () => done()))
    void offscreen.webContents.loadURL(contents.getURL()).catch(() => undefined)
    await within(loaded, LOAD_MS)
    await new Promise((done) => setTimeout(done, SETTLE_MS))
    const image = await within(offscreen.webContents.capturePage(), 5000)
    return image && !image.isEmpty() ? encode(image, true) : null
  } finally {
    offscreen.destroy()
  }
}

/** The computer itself, which the project's own dev server runs on. Anything else asks first. */
export function isLocalAddress(url: string): boolean {
  if (!URL.canParse(url)) return false
  const { protocol, hostname } = new URL(url)
  if (protocol !== 'http:' && protocol !== 'https:') return false
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(hostname)
}

/** Finds an element by CSS selector, or failing that by its visible text or label. Never a private field when typing. */
const FIND = `(target, typing) => {
  const visible = (element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  let found = null
  try { found = [...document.querySelectorAll(target)].find(visible) || null } catch {}
  if (!found) {
    const wanted = target.trim().toLowerCase()
    const pool = [...document.querySelectorAll(typing ? 'input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable=true]' : 'a,button,input[type=submit],input[type=button],input[type=checkbox],input[type=radio],label,summary,select,[role=button],[role=link],[role=tab],[role=menuitem],[onclick]')].filter(visible)
    const words = (element) => [element.getAttribute('aria-label'), element.innerText, element.value, element.placeholder, element.title, element.name, element.id, element.labels && [...element.labels].map((label) => label.innerText).join(' ')].filter(Boolean).join(' ').trim().toLowerCase()
    found = pool.find((element) => words(element) === wanted) || pool.find((element) => words(element).includes(wanted)) || null
  }
  return found
}`

const SENSITIVE = `(element) => element.type === 'password' || /cc-|password|one-time-code/.test(element.autocomplete || '') || /pass|card|cvv|cvc|ssn|secret/i.test((element.name || '') + ' ' + (element.id || ''))`

const describe = `(element) => (element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + ' ' + ((element.getAttribute('aria-label') || element.innerText || element.value || element.placeholder || '').trim().slice(0, 60))).trim()`

/**
 * The browser Terra Code lives in. Each session gets a preview tab of its own, opened beside the
 * person's tabs without taking their place. Reading the person's own tabs, and opening anything
 * but the computer's own addresses, is asked about by the agent loop before it gets here.
 */
export function coderBrowser(deps: BrowserDeps): CoderBrowserHost {
  const previews = new Map<string, PreviewTab>()

  const live = (sessionId: string): { tab: PreviewTab; contents: WebContents } | null => {
    const tab = previews.get(sessionId)
    const contents = tab && deps.contentsFor(tab.id)
    return tab && contents && !contents.isDestroyed() ? { tab, contents } : null
  }

  const watch = (tab: PreviewTab, contents: WebContents) => {
    contents.setBackgroundThrottling(false)
    contents.on('console-message', (...args: unknown[]) => {
      // Newer Electron passes one details object; older ones pass the level and message as arguments.
      const details = args[0] as { level?: unknown; message?: unknown; lineNumber?: unknown; sourceId?: unknown }
      const level = typeof details?.level === 'string' ? details.level : ['debug', 'info', 'warning', 'error'][Number(args[1])] ?? 'info'
      const message = typeof details?.message === 'string' ? details.message : String(args[2] ?? '')
      if (level !== 'warning' && level !== 'error') return
      tab.console.push(`[${level}] ${message.slice(0, 500)}`)
      if (tab.console.length > MAX_CONSOLE) tab.console.splice(0, tab.console.length - MAX_CONSOLE)
    })
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (code !== -3) tab.console.push(`[error] ${isMainFrame ? 'The page' : 'Part of the page'} failed to load (${description}): ${url}`)
    })
  }

  const loaded = (contents: WebContents, signal: AbortSignal) =>
    new Promise<void>((done) => {
      const finish = () => {
        clearTimeout(timer)
        contents.off('did-stop-loading', finish)
        done()
      }
      const timer = setTimeout(finish, LOAD_MS)
      contents.on('did-stop-loading', finish)
      signal.addEventListener('abort', finish, { once: true })
    })

  const consoleNote = (tab: PreviewTab) => {
    const lines = tab.console.splice(0)
    return lines.length ? `\n\nConsole and loading problems since you last looked:\n${lines.join('\n')}` : '\n\nNo console errors or warnings since you last looked.'
  }

  const settle = () => new Promise((done) => setTimeout(done, SETTLE_MS))

  return {
    isLocal: isLocalAddress,

    async preview(sessionId, call: Extract<CoderCall, { tool: 'preview' }>, signal) {
      if (call.action === 'open') {
        const url = call.url!
        if (deps.isSiteOff(url)) return { output: 'AI is turned off for that site, so Terra Code leaves it alone.' }
        let found = live(sessionId)
        if (found) {
          found.tab.console = []
          const waiting = loaded(found.contents, signal)
          void found.contents.loadURL(url).catch(() => undefined)
          await waiting
        } else {
          const tab: PreviewTab = { id: deps.create(url), console: [] }
          previews.set(sessionId, tab)
          const contents = deps.contentsFor(tab.id)
          if (!contents) return { output: "The preview tab couldn't be opened." }
          watch(tab, contents)
          await loaded(contents, signal)
          found = { tab, contents }
        }
        await settle()
        return { output: `Opened ${found.contents.getURL()} in a tab beside the person's: “${found.contents.getTitle()}”.${consoleNote(found.tab)}` }
      }
      const found = live(sessionId)
      if (!found) return { output: 'No preview is open. Open one first with {"tool":"preview","action":"open","url":"…"}.' }
      const { tab, contents } = found
      if (deps.isSiteOff(contents.getURL())) return { output: 'AI is turned off for that site, so Terra Code leaves it alone.' }
      if (call.action === 'read') {
        const page = await extractContext(contents).catch(() => null)
        return { output: `${contents.getTitle()}\n${contents.getURL()}\n\n${page?.text ?? '(No readable text.)'}${consoleNote(tab)}` }
      }
      if (call.action === 'screenshot') {
        const shot = await screenshot(contents)
        if (!shot) return { output: "The page couldn't be captured. Read it instead." }
        const note = shot.fresh ? ' The tab is out of sight, so this is the page freshly loaded: anything clicks or typing changed since isn’t in it.' : ''
        return { output: `A screenshot of ${contents.getURL()} (${shot.width}×${shot.height}) is attached.${note}${consoleNote(tab)}`, images: [shot.url] }
      }
      const typing = call.action === 'type'
      const script = `((target, text, typing) => {
        const element = (${FIND})(target, typing)
        if (!element) return { ok: false, said: 'Nothing on the page matches ' + JSON.stringify(target) + '. Read the page to see what is there.' }
        if (typing && (${SENSITIVE})(element)) return { ok: false, said: 'That is a password, card or other private field, which Terra Code never types into.' }
        element.scrollIntoView({ block: 'center' })
        if (!typing) {
          element.click()
          return { ok: true, said: 'Clicked ' + (${describe})(element) + '.' }
        }
        element.focus()
        if (element.isContentEditable) element.textContent = text
        else {
          const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, text)
        }
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        return { ok: true, said: 'Typed into ' + (${describe})(element) + '.' }
      })(${JSON.stringify(call.target)}, ${JSON.stringify(call.text ?? '')}, ${typing})`
      const result = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: script }], true).catch((error: Error) => ({ ok: false, said: `It didn't work: ${error.message}` }))) as { ok: boolean; said: string }
      await settle()
      if (contents.isLoading()) await loaded(contents, signal)
      return { output: `${result.said}\nNow at ${contents.getURL()}: “${contents.getTitle()}”.${consoleNote(tab)}` }
    },

    async tabs() {
      return deps
        .tabs()
        .filter((tab) => /^(https?|file):/i.test(tab.url) && ![...previews.values()].some((preview) => preview.id === tab.id))
        .map((tab) => ({ id: tab.id, title: tab.title, url: tab.url }))
    },

    async readTab(id) {
      const tab = deps.tabs().find((candidate) => candidate.id === id)
      const contents = deps.contentsFor(id)
      if (!tab || !contents || deps.isSiteOff(tab.url)) return null
      const page = await extractContext(contents).catch(() => null)
      return page ? { title: page.title, url: page.url, text: page.text } : null
    }
  }
}
