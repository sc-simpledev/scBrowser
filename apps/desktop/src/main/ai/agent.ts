import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { AGENT_PROMPT, neutralise, parseAgentAction, type AgentAction } from '@scbrowser/ai'
import type { AssistantEvent, AssistantMessage } from '@scbrowser/shared'

const WORLD = 1003
const MAX_STEPS = 20
const SETTLE_MS = 900

const SNAPSHOT = `(() => {
  const visible = (element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const sensitive = (element) =>
    element.type === 'password' ||
    /cc-|password|one-time-code/.test(element.autocomplete || '') ||
    /pass|card|cvv|cvc|ssn|secret/i.test((element.name || '') + ' ' + (element.id || ''))
  const elements = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[onclick]')]
    .filter(visible)
    .slice(0, 150)
  window.__scbElements = elements
  return {
    title: document.title,
    url: location.href,
    text: (document.body ? document.body.innerText : '').slice(0, 6000),
    elements: elements.map((element, index) => ({
      ref: index + 1,
      tag: element.tagName.toLowerCase(),
      type: element.type || '',
      // Never the contents of a field, which could be private.
      name: (element.getAttribute('aria-label') || element.innerText || element.placeholder || element.name ||
        (['submit', 'button'].includes(element.type) ? element.value : '') || '').trim().slice(0, 80),
      sensitive: sensitive(element)
    }))
  }
})()`

const ACT = (action: Extract<AgentAction, { action: 'click' | 'type' | 'scroll' }>) => `((action) => {
  if (action.action === 'scroll') {
    window.scrollBy({ top: (action.direction === 'up' ? -0.8 : 0.8) * innerHeight })
    return true
  }
  const element = window.__scbElements?.[action.ref - 1]
  if (!element || !element.isConnected) return false
  element.scrollIntoView({ block: 'center' })
  if (action.action === 'click') {
    element.click()
    return true
  }
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, action.text)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})(${JSON.stringify(action)})`

interface Snapshot {
  title: string
  url: string
  text: string
  elements: { ref: number; tag: string; type: string; name: string; sensitive: boolean }[]
}

const observe = (snapshot: Snapshot) =>
  `<page title="${neutralise(snapshot.title).replaceAll('"', '&quot;')}" url="${snapshot.url.replaceAll('"', '%22')}">
Elements:
${snapshot.elements.map((e) => `[${e.ref}] ${e.tag}${e.type ? ` ${e.type}` : ''} "${neutralise(e.name)}"${e.sensitive ? ' (private field, do not use)' : ''}`).join('\n')}

Text:
${neutralise(snapshot.text)}
</page>`

interface AgentDependencies {
  chat: (messages: AssistantMessage[], system: string, signal: AbortSignal) => Promise<string>
  isSiteOff: (url: string) => boolean
}

/**
 * Works towards a goal in one tab. Looking and scrolling happen freely; every click, entry
 * and navigation waits for the person's approval, and private fields are never touched.
 */
export class Agent {
  private readonly pending = new Map<string, (allow: boolean) => void>()

  constructor(private readonly deps: AgentDependencies) {}

  answer(approvalId: string, allow: boolean): void {
    this.pending.get(approvalId)?.(allow)
    this.pending.delete(approvalId)
  }

  private approve(streamId: string, text: string, reason: string, emit: (event: AssistantEvent) => void, signal: AbortSignal) {
    const approvalId = randomUUID()
    return new Promise<boolean>((resolve) => {
      this.pending.set(approvalId, resolve)
      signal.addEventListener('abort', () => this.answer(approvalId, false), { once: true })
      emit({ streamId, type: 'approval', approvalId, text, reason })
    })
  }

  async run(streamId: string, goal: string, contents: WebContents, emit: (event: AssistantEvent) => void, signal: AbortSignal): Promise<void> {
    const see = () => contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SNAPSHOT }]) as Promise<Snapshot>
    const act = (action: Parameters<typeof ACT>[0]) =>
      contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: ACT(action) }], true) as Promise<boolean>

    let snapshot = await see()
    const messages: AssistantMessage[] = [{ role: 'user', content: `My goal: ${goal}\n\n${observe(snapshot)}` }]

    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted || contents.isDestroyed()) return
      if (this.deps.isSiteOff(contents.getURL())) {
        emit({ streamId, type: 'text', text: 'Stopped: AI is turned off for this site.' })
        return
      }
      const reply = await this.deps.chat(messages, AGENT_PROMPT, signal)
      messages.push({ role: 'assistant', content: reply })
      const action = parseAgentAction(reply)

      let result: string
      if (!action) {
        result = 'That reply was not a valid action. Reply with one JSON object.'
      } else if (action.action === 'done') {
        emit({ streamId, type: 'text', text: action.summary })
        return
      } else if (action.action === 'scroll') {
        await act(action)
        emit({ streamId, type: 'step', text: `Scrolled ${action.direction}` })
        result = 'Scrolled.'
      } else if (action.action === 'navigate') {
        const allowed = await this.approve(streamId, `Go to ${action.url}`, action.reason, emit, signal)
        if (allowed) {
          await contents.loadURL(action.url).catch(() => undefined)
          emit({ streamId, type: 'step', text: `Went to ${action.url}` })
        }
        result = allowed ? 'Navigated.' : 'The person declined this.'
      } else {
        const element = snapshot.elements.find((e) => e.ref === action.ref)
        if (!element) {
          result = `There is no element ${action.ref}.`
        } else if (element.sensitive) {
          // Decided here rather than left to the model, which a page could mislead.
          emit({ streamId, type: 'step', text: `Skipped private field "${element.name}"` })
          result = 'That field is private and can only be filled in by the person.'
        } else {
          const label = element.name || element.tag
          const text = action.action === 'click' ? `Click "${label}"` : `Enter "${action.text}" into "${label}"`
          const allowed = await this.approve(streamId, text, action.reason, emit, signal)
          if (allowed && (await act(action))) {
            emit({ streamId, type: 'step', text })
            result = 'Done.'
          } else {
            result = allowed ? 'That element has gone.' : 'The person declined this.'
          }
        }
      }

      if (signal.aborted) return
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      if (contents.isDestroyed()) return
      snapshot = await see()
      messages.push({ role: 'user', content: `Result: ${result}\n\n${observe(snapshot)}` })
    }
    emit({ streamId, type: 'text', text: `Stopped after ${MAX_STEPS} steps without finishing.` })
  }
}
