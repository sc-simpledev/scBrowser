import { CODER_MAX_STEPS, type CoderAgentRun, type CoderAnswer, type CoderCloudRun, type CoderQuestion, type CoderQuestionAnswer, type CoderApprovalKind, type CoderChange, type CoderEvent, type CoderJob, type CoderTodo, type CoderToolName, type CoderRunMode } from '@scbrowser/shared'

export type Item =
  /** What the person sent. `turnId` names the turn it started, for rewinding to before it. */
  | { kind: 'task'; text: string; turnId?: string; pictures?: number; shown?: string; mode?: CoderRunMode }
  | { kind: 'text'; text: string }
  /** The model's reasoning before a step, where it gives it. */
  | { kind: 'reasoning'; text: string }
  /** `agent` names the helper run that took this step, which shows it inside its card instead. */
  | { kind: 'tool'; id: string; tool: CoderToolName; summary: string; ok: boolean | null; output: string; live?: string; agent?: string; undoable?: boolean; undone?: boolean }
  | { kind: 'approval'; id: string; type: CoderApprovalKind; summary: string; detail: string; answer: CoderAnswer | null; rule?: string; always?: string }
  | { kind: 'note'; text: string; error: boolean; network?: boolean }
  /** Questions the model asked. `answers` is undefined while it waits, null if they were closed unanswered. */
  | { kind: 'question'; id: string; questions: CoderQuestion[]; answers?: CoderQuestionAnswer[] | null }
  /** A task sent to the cloud, and what it did once read back (not saved: it's fetched again when asked). */
  | { kind: 'cloud'; run: CoderCloudRun; events?: CoderEvent[] | null }

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
  /** Helpers sent off this session, by the id of the step that started them. */
  agents: CoderAgentRun[]
  context: ContextUse | null
  streaming: string
  /** Reasoning still arriving for this step. */
  reasoning: string
  step: number | null
  working: boolean
  retrySeconds: number | null
  /** When the run under way started, and how long the last one took. */
  runStartedAt: number | null
  lastRunMs: number | null
}

export const emptyState = (): CodeState => ({ items: [], todo: [], changes: [], jobs: [], agents: [], context: null, streaming: '', reasoning: '', step: null, working: false, retrySeconds: null, runStartedAt: null, lastRunMs: null })

const DONE_NOTES: Record<string, string | null> = { finished: null, stopped: 'Stopped.', 'step-limit': `Stopped after ${CODER_MAX_STEPS} steps. Send a message to carry on.` }

/** Live output kept per running command: the end is what matters. */
const LIVE_CHARS = 6000

/** Reasoning that was still arriving, kept in the conversation once something else comes. */
function settleReasoning(state: CodeState): CodeState {
  if (!state.reasoning.trim()) return state.reasoning ? { ...state, reasoning: '' } : state
  return { ...state, reasoning: '', items: [...state.items, { kind: 'reasoning', text: state.reasoning.trim() }] }
}

const ended = (state: CodeState): Pick<CodeState, 'runStartedAt' | 'lastRunMs'> => ({ runStartedAt: null, lastRunMs: state.runStartedAt ? Date.now() - state.runStartedAt : state.lastRunMs })

/** One event applied to the screen. The same for a run as it happens and for one caught up on later. */
export function applyEvent(state: CodeState, event: CoderEvent): CodeState {
  let next: CodeState = { ...state }
  if (event.type === 'retrying') return { ...next, retrySeconds: event.seconds }
  next.retrySeconds = null
  if (event.type === 'thinking') next.step = event.step
  else if (event.type !== 'stream' && event.type !== 'output' && event.type !== 'context' && event.type !== 'jobs' && event.type !== 'reasoning' && event.type !== 'agent') next.step = null
  // Anything else the model sends means its reasoning for this step is over. Its reply arriving
  // doesn't: the reasoning's final event follows that, and settles it whole.
  if (event.type !== 'reasoning' && event.type !== 'stream' && event.type !== 'context' && event.type !== 'output' && event.type !== 'jobs' && event.type !== 'agent') next = settleReasoning(next)
  switch (event.type) {
    case 'stream':
      return { ...next, streaming: event.text }
    case 'reasoning':
      return event.final ? settleReasoning({ ...next, reasoning: event.text }) : { ...next, reasoning: event.text }
    case 'agent': {
      const known = next.agents.some((run) => run.id === event.run.id)
      return { ...next, agents: known ? next.agents.map((run) => (run.id === event.run.id ? event.run : run)) : [...next.agents, event.run] }
    }
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
      return { ...next, items: [...next.items, { kind: 'tool', id: event.id, tool: event.tool, summary: event.summary, ok: null, output: '', ...(event.agent ? { agent: event.agent } : {}) }] }
    case 'output':
      return { ...next, items: next.items.map((item) => (item.kind === 'tool' && item.id === event.id ? { ...item, live: ((item.live ?? '') + event.text).slice(-LIVE_CHARS) } : item)) }
    case 'tool-result':
      return { ...next, items: next.items.map((item) => (item.kind === 'tool' && item.id === event.id ? { ...item, ok: event.ok, output: event.output, live: undefined, ...(event.undoable ? { undoable: true } : {}) } : item)) }
    case 'question':
      return { ...next, items: [...next.items, { kind: 'question', id: event.id, questions: event.questions }] }
    case 'approval':
      return { ...next, items: [...next.items, { kind: 'approval', id: event.id, type: event.kind, summary: event.summary, detail: event.detail, answer: null, ...(event.rule ? { rule: event.rule } : {}), ...(event.always ? { always: event.always } : {}) }] }
    case 'note':
      return { ...next, items: [...next.items, { kind: 'note', text: event.text, error: false }] }
    case 'compacted':
      return { ...next, items: [...next.items.filter((item) => !(item.kind === 'note' && item.text.startsWith('Summarising'))), { kind: 'note', text: `Summarised the conversation so far to make room (about ${shortTokens(event.before)} down to ${shortTokens(event.after)}).`, error: false }] }
    case 'done': {
      const note = DONE_NOTES[event.reason]
      return { ...next, ...ended(next), working: false, streaming: '', agents: stopAgents(next.agents), items: note ? [...next.items, { kind: 'note', text: note, error: false }] : next.items }
    }
    case 'error':
      return { ...next, ...ended(next), working: false, streaming: '', agents: stopAgents(next.agents), items: [...next.items, { kind: 'note', text: event.message, error: true, network: event.network }] }
  }
}

/** A run that ended can't leave a helper looking busy. */
const stopAgents = (runs: CoderAgentRun[]) => runs.map((run) => (run.state === 'running' ? { ...run, state: 'failed' as const, endedAt: Date.now(), report: run.report ?? 'Stopped.' } : run))

/** 12k, 1.2M: token counts in a few characters. */
export function shortTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

/** 45 s, 3 min 10 s, 1 h 2 min. */
export function shortDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** What a session has done, counted from what's on screen. */
export function sessionStats(items: Item[]) {
  let messages = 0
  let tools = 0
  let commands = 0
  let reads = 0
  let edits = 0
  let failed = 0
  for (const item of items) {
    if (item.kind === 'task') messages++
    if (item.kind !== 'tool' || item.tool === 'todo') continue
    tools++
    if (item.ok === false) failed++
    if (item.tool === 'run' || item.tool === 'diagnostics') commands++
    else if (item.tool === 'read' || item.tool === 'search' || item.tool === 'glob' || item.tool === 'list') reads++
    else if (item.tool === 'write' || item.tool === 'edit' || item.tool === 'patch' || item.tool === 'delete' || item.tool === 'move') edits++
  }
  return { messages, tools, commands, reads, edits, failed }
}

/** What's kept of a chat: long output is cut, and nothing can still be waiting for an answer. */
export function savedItems(items: Item[]): Item[] {
  return items.map((item) => {
    if (item.kind === 'tool') {
      const { live: _live, ...rest } = item
      return { ...rest, ok: item.ok ?? false, output: item.output.slice(0, 4000) }
    }
    if (item.kind === 'approval') return { ...item, answer: item.answer ?? 'deny', detail: item.detail.slice(0, 4000) }
    if (item.kind === 'reasoning') return { ...item, text: item.text.slice(0, 8000) }
    if (item.kind === 'question' && item.answers === undefined) return { ...item, answers: null }
    // One still being set up when the page went away never got a run of its own.
    if (item.kind === 'cloud') return { kind: 'cloud', run: item.run.id.startsWith('pending-') ? { ...item.run, state: 'failed', endedAt: item.run.endedAt ?? Date.now(), error: item.run.error ?? 'It didn’t finish starting. Send the task again.' } : item.run }
    return item
  })
}

/** The screen of a session as Markdown, for saving. */
export function sessionMarkdown(title: string, items: Item[], todo: CoderTodo[]): string {
  const lines = [`# ${title}`, '']
  for (const item of items) {
    if (item.kind === 'task') lines.push(`## ${item.shown ?? item.text}`.replace(/\n/g, ' '), '')
    else if (item.kind === 'text') lines.push(item.text, '')
    else if (item.kind === 'reasoning') lines.push(...item.text.split('\n').map((line) => `> *${line || ' '}*`), '')
    else if (item.kind === 'tool') lines.push(`- ${item.ok === false ? '✗' : '✓'} ${item.summary}`)
    else if (item.kind === 'approval' && item.answer === 'deny') lines.push(`- Declined: ${item.summary}`)
    else if (item.kind === 'note') lines.push(`> ${item.text}`, '')
    else if (item.kind === 'cloud') lines.push(`> Cloud run on ${item.run.branch}: ${item.run.state}${item.run.prUrl ? ` (${item.run.prUrl})` : ''}`, '', ...(item.run.summary ? [item.run.summary, ''] : []))
    else if (item.kind === 'question') lines.push(...item.questions.map((question, index) => `- **${question.question}** ${item.answers ? (item.answers[index] ?? []).join(', ') || '(skipped)' : '(not answered)'}`), '')
  }
  if (todo.length) lines.push('', '## Checklist', '', ...todo.map((step) => `- [${step.done ? 'x' : ' '}] ${step.text}`))
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
