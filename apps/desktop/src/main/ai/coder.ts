import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { CODER_PROMPT, parseCoderReply, toolResult, type CoderCall } from '@scbrowser/ai'
import type { AssistantMessage, CoderAnswer, CoderEvent, CoderMode } from '@scbrowser/shared'
import { applyEdit, inside, lineDiff, listFiles, readLines, readText, runCommand, searchFiles, shown, ToolError, writeText } from './coderTools'

const MAX_STEPS = 60
/** Older tool output is emptied once the conversation grows past this, keeping recent work whole. */
const MAX_CONTEXT_CHARS = 350_000

type Emit = (event: CoderEvent) => void

interface Session {
  messages: AssistantMessage[]
  controller: AbortController | null
  /** Commands the person said to always allow, exactly as written, for this session only. */
  allowed: Set<string>
}

export interface CoderDependencies {
  chat: (messages: AssistantMessage[], system: string, signal: AbortSignal) => Promise<string>
}

/**
 * Agentic coding, in beta. The model works in one folder the person chose: it can look at anything
 * inside it, but every change asks first (unless they let edits through) and every command asks first
 * (unless they always allowed that exact command in this session). Nothing outside the folder is reachable
 * through its tools, though a command the person approves runs with their own permissions.
 */
export class Coder {
  private readonly sessions = new Map<string, Session>()
  private readonly approvals = new Map<string, (answer: CoderAnswer) => void>()

  constructor(private readonly deps: CoderDependencies) {}

  get running(): boolean {
    return [...this.sessions.values()].some((session) => session.controller !== null)
  }

  answer(id: string, answer: CoderAnswer): void {
    this.approvals.get(id)?.(answer)
  }

  stop(sessionId: string): void {
    this.sessions.get(sessionId)?.controller?.abort()
  }

  reset(sessionId: string): void {
    this.stop(sessionId)
    this.sessions.delete(sessionId)
  }

  async run(sessionId: string, folder: string, task: string, mode: CoderMode, emit: Emit): Promise<void> {
    const session = this.sessions.get(sessionId) ?? { messages: [], controller: null, allowed: new Set<string>() }
    this.sessions.set(sessionId, session)
    if (session.controller) throw new Error('This session is already working.')
    const controller = new AbortController()
    session.controller = controller
    const { signal } = controller
    // Its real path, so names shown to the model and the person match what `inside` resolves.
    folder = await realpath(folder).catch(() => folder)
    const info = await stat(folder).catch(() => null)
    try {
      if (!info?.isDirectory()) throw new ToolError("The project folder can't be found. Choose it again.")
      session.messages.push({ role: 'user', content: session.messages.length === 0 ? `Project folder: ${folder}\n\nTask:\n${task}` : task })
      for (let step = 1; ; step++) {
        if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
        if (step > MAX_STEPS) {
          session.messages.push({ role: 'assistant', content: '(Stopped: step limit reached.)' })
          return emit({ sessionId, type: 'done', reason: 'step-limit' })
        }
        emit({ sessionId, type: 'thinking', step })
        trimContext(session.messages)
        const reply = await this.deps.chat(session.messages, CODER_PROMPT, signal)
        if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
        session.messages.push({ role: 'assistant', content: reply })
        const { text, call, invalid } = parseCoderReply(reply)
        if (text) emit({ sessionId, type: 'text', text })
        if (invalid) {
          session.messages.push({ role: 'user', content: toolResult('error', 'That tool block could not be read. Use exactly one JSON object in the format shown, with all required fields.') })
          continue
        }
        if (!call) return emit({ sessionId, type: 'done', reason: 'finished' })
        const result = await this.use(sessionId, folder, call, mode, session, signal, emit)
        session.messages.push({ role: 'user', content: toolResult(call.tool, result) })
      }
    } catch (error) {
      if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
      emit({ sessionId, type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' })
    } finally {
      session.controller = null
    }
  }

  /** Runs one tool, asking first when it changes something. Returns what the model is told. */
  private async use(sessionId: string, root: string, call: CoderCall, mode: CoderMode, session: Session, signal: AbortSignal, emit: Emit): Promise<string> {
    const id = randomUUID()
    const report = (ok: boolean, output: string) => {
      emit({ sessionId, type: 'tool-result', id, ok, output })
      return output
    }
    try {
      switch (call.tool) {
        case 'list':
          emit({ sessionId, type: 'tool', id, tool: 'list', summary: `List ${call.path}` })
          return report(true, await listFiles(root, call.path))
        case 'read':
          emit({ sessionId, type: 'tool', id, tool: 'read', summary: `Read ${call.path}${call.offset > 1 ? ` from line ${call.offset}` : ''}` })
          return report(true, await readLines(root, call.path, call.offset, call.limit))
        case 'search':
          emit({ sessionId, type: 'tool', id, tool: 'search', summary: `Search for ${call.pattern}${call.path === '.' ? '' : ` in ${call.path}`}` })
          return report(true, await searchFiles(root, call.path, call.pattern))
        case 'write':
        case 'edit': {
          emit({ sessionId, type: 'tool', id, tool: call.tool, summary: `${call.tool === 'write' ? 'Write' : 'Edit'} ${call.path}` })
          const full = await inside(root, call.path)
          const name = shown(root, full)
          const exists = await stat(full).then((info) => info.isFile(), () => false)
          const before = exists ? await readText(full) : ''
          const after = call.tool === 'write' ? call.content : applyEdit(before, call.find, call.replace)
          if (exists && after === before) return report(true, 'No change: the file already has that text.')
          const summary = call.tool === 'write' ? `${exists ? 'Replace' : 'Create'} ${name}` : `Edit ${name}`
          if (mode === 'ask') {
            const answer = await this.ask(sessionId, 'change', summary, exists ? lineDiff(before, after) : lineDiff('', after, 0).replace(/^@@.*\n/, ''), signal, emit)
            if (answer === 'deny') return report(false, 'The person declined this change. Ask what they want instead, or try another way.')
          }
          await writeText(full, after)
          return report(true, `${exists ? 'Updated' : 'Created'} ${name}.`)
        }
        case 'run': {
          emit({ sessionId, type: 'tool', id, tool: 'run', summary: `Run ${call.command}` })
          if (!session.allowed.has(call.command)) {
            const answer = await this.ask(sessionId, 'command', `Run a command in ${root}`, call.command, signal, emit)
            if (answer === 'deny') return report(false, 'The person declined to run this command.')
            if (answer === 'always') session.allowed.add(call.command)
          }
          const { ok, output } = await runCommand(root, call.command, signal)
          return report(ok, output)
        }
      }
    } catch (error) {
      if (signal.aborted) throw error
      const message = error instanceof ToolError ? error.message : error instanceof Error ? `Failed: ${error.message}` : 'Failed.'
      return report(false, message)
    }
  }

  private ask(sessionId: string, kind: 'change' | 'command', summary: string, detail: string, signal: AbortSignal, emit: Emit): Promise<CoderAnswer> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.approvals.delete(id)
        reject(new Error('Stopped'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.approvals.set(id, (answer) => {
        this.approvals.delete(id)
        signal.removeEventListener('abort', onAbort)
        resolve(answer)
      })
      emit({ sessionId, type: 'approval', id, kind, summary, detail })
    })
  }
}

/** Empties the oldest tool output first, so long sessions keep fitting the model's context. */
export function trimContext(messages: AssistantMessage[], max = MAX_CONTEXT_CHARS): void {
  let total = messages.reduce((sum, message) => sum + message.content.length, 0)
  for (let i = 1; i < messages.length - 6 && total > max; i++) {
    const message = messages[i]!
    if (message.role !== 'user' || !message.content.startsWith('<tool-result') || message.content.length < 400) continue
    const tool = /tool="(\w+)"/.exec(message.content)?.[1] ?? 'tool'
    const short = toolResult(tool, '(Older output removed to save space. Run the tool again if you need it.)')
    total -= message.content.length - short.length
    messages[i] = { role: 'user', content: short }
  }
}
