import { CODER_MAX_STEPS, type CoderAnswer, type CoderApprovalKind, type CoderChange, type CoderEvent, type CoderJob, type CoderTodo, type CoderToolName } from '@scbrowser/shared'

export type Item =
  /** What the person sent. `turnId` names the turn it started, for rewinding to before it. */
  | { kind: 'task'; text: string; turnId?: string; pictures?: number; shown?: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; tool: CoderToolName; summary: string; ok: boolean | null; output: string; live?: string }
  | { kind: 'approval'; id: string; type: CoderApprovalKind; summary: string; detail: string; answer: CoderAnswer | null; rule?: string; always?: string }
  | { kind: 'note'; text: string; error: boolean; network?: boolean }

export interface ContextUse {
  used: number
  limit: number
  inputTokens: number
  outputTokens: number
}

/** Everything the screen shows for a session, which events change. */
export interface CodeState {
  items: Item[]
  todo: CoderTodo[]
  changes: CoderChange[]
  jobs: CoderJob[]
  context: ContextUse | null
  streaming: string
  step: number | null
  working: boolean
  retrySeconds: number | null
}

export const emptyState = (): CodeState => ({ items: [], todo: [], changes: [], jobs: [], context: null, streaming: '', step: null, working: false, retrySeconds: null })

const DONE_NOTES: Record<string, string | null> = { finished: null, stopped: 'Stopped.', 'step-limit': `Stopped after ${CODER_MAX_STEPS} steps. Send a message to carry on.` }

/** Live output kept per running command: the end is what matters. */
const LIVE_CHARS = 6000

/** One event applied to the screen. The same for a run as it happens and for one caught up on later. */
export function applyEvent(state: CodeState, event: CoderEvent): CodeState {
  const next: CodeState = { ...state }
  if (event.type === 'retrying') return { ...next, retrySeconds: event.seconds }
  next.retrySeconds = null
  if (event.type === 'thinking') next.step = event.step
  else if (event.type !== 'stream' && event.type !== 'output' && event.type !== 'context' && event.type !== 'jobs') next.step = null
  switch (event.type) {
    case 'stream':
      return { ...next, streaming: event.text }
    case 'todo':
      return { ...next, todo: event.items }
    case 'changes':
      return { ...next, changes: event.files }
    case 'jobs':
      return { ...next, jobs: event.jobs }
    case 'context':
      return { ...next, context: { used: event.used, limit: event.limit, inputTokens: event.inputTokens, outputTokens: event.outputTokens } }
    case 'thinking':
      return next
    case 'text':
      return { ...next, streaming: '', items: [...next.items, { kind: 'text', text: event.text }] }
    case 'tool':
      return { ...next, items: [...next.items, { kind: 'tool', id: event.id, tool: event.tool, summary: event.summary, ok: null, output: '' }] }
    case 'output':
      return { ...next, items: next.items.map((item) => (item.kind === 'tool' && item.id === event.id ? { ...item, live: ((item.live ?? '') + event.text).slice(-LIVE_CHARS) } : item)) }
    case 'tool-result':
      return { ...next, items: next.items.map((item) => (item.kind === 'tool' && item.id === event.id ? { ...item, ok: event.ok, output: event.output, live: undefined } : item)) }
    case 'approval':
      return { ...next, items: [...next.items, { kind: 'approval', id: event.id, type: event.kind, summary: event.summary, detail: event.detail, answer: null, ...(event.rule ? { rule: event.rule } : {}), ...(event.always ? { always: event.always } : {}) }] }
    case 'note':
      return { ...next, items: [...next.items, { kind: 'note', text: event.text, error: false }] }
    case 'compacted':
      return { ...next, items: [...next.items.filter((item) => !(item.kind === 'note' && item.text.startsWith('Summarising'))), { kind: 'note', text: `Summarised the conversation so far to make room (about ${shortTokens(event.before)} down to ${shortTokens(event.after)}).`, error: false }] }
    case 'done': {
      const note = DONE_NOTES[event.reason]
      return { ...next, working: false, streaming: '', items: note ? [...next.items, { kind: 'note', text: note, error: false }] : next.items }
    }
    case 'error':
      return { ...next, working: false, streaming: '', items: [...next.items, { kind: 'note', text: event.message, error: true, network: event.network }] }
  }
}

/** 12k, 1.2M: token counts in a few characters. */
export function shortTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

/** What's kept of a chat: long output is cut, and nothing can still be waiting for an answer. */
export function savedItems(items: Item[]): Item[] {
  return items.map((item) => {
    if (item.kind === 'tool') {
      const { live: _live, ...rest } = item
      return { ...rest, ok: item.ok ?? false, output: item.output.slice(0, 4000) }
    }
    if (item.kind === 'approval') return { ...item, answer: item.answer ?? 'deny', detail: item.detail.slice(0, 4000) }
    return item
  })
}

/** The screen of a session as Markdown, for saving. */
export function sessionMarkdown(title: string, items: Item[], todo: CoderTodo[]): string {
  const lines = [`# ${title}`, '']
  for (const item of items) {
    if (item.kind === 'task') lines.push(`## ${item.shown ?? item.text}`.replace(/\n/g, ' '), '')
    else if (item.kind === 'text') lines.push(item.text, '')
    else if (item.kind === 'tool') lines.push(`- ${item.ok === false ? '✗' : '✓'} ${item.summary}`)
    else if (item.kind === 'approval' && item.answer === 'deny') lines.push(`- Declined: ${item.summary}`)
    else if (item.kind === 'note') lines.push(`> ${item.text}`, '')
  }
  if (todo.length) lines.push('', '## Plan', '', ...todo.map((step) => `- [${step.done ? 'x' : ' '}] ${step.text}`))
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
