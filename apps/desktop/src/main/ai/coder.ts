import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { CHANGING_TOOLS, CODER_PLAN_PROMPT, CODER_PROMPT, parseCoderReply, streamingText, toolResult, type CoderCall } from '@scbrowser/ai'
import { CODER_MAX_STEPS, type AssistantMessage, type CoderAnswer, type CoderChange, type CoderEvent, type CoderMode } from '@scbrowser/shared'
import { applyEdits, clip, deleteFile, globFiles, inside, lineDiff, listFiles, moveFile, readLines, readText, runCommand, searchFiles, shown, ToolError, writeText } from './coderTools'

/** Older tool output is emptied once the conversation grows past this, keeping recent work whole. */
const MAX_CONTEXT_CHARS = 350_000
/** Files the model is shown at the start, so it knows the project's own rules without asking. */
const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', '.cursorrules', 'README.md']
const INSTRUCTION_CHARS = 6000
const STREAM_EVERY_MS = 80

type Emit = (event: CoderEvent) => void

interface Session {
  messages: AssistantMessage[]
  controller: AbortController | null
  /** Commands the person said to always allow, exactly as written, for this session only. */
  allowed: Set<string>
  /** How each file was before this session first changed it (null: it didn't exist), for undo and the changes list. */
  originals: Map<string, string | null>
  folder: string
}

export interface CoderDependencies {
  chat: (messages: AssistantMessage[], system: string, signal: AbortSignal, onText?: (text: string) => void) => Promise<string>
  /** Web results as text for the model, or null when web search isn't available. */
  webSearch?: (query: string) => Promise<string>
}

/**
 * Terra Code, agentic coding (beta). The model works in one folder the person chose: it can look at
 * anything inside it, but every change asks first (unless they let edits through) and every command
 * asks first (unless they always allowed that exact command in this session). Plan mode only looks.
 * Nothing outside the folder is reachable through its tools, though a command the person approves
 * runs with their own permissions. Every file it changes is remembered as it was, so the session's
 * changes can be undone.
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

  /** Every file the session changed, against how it was before. */
  async changes(sessionId: string): Promise<CoderChange[]> {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    const files: CoderChange[] = []
    for (const [full, before] of session.originals) {
      const after = await readFile(full, 'utf8').catch(() => null)
      if (after === before) continue
      const status = before === null ? 'created' : after === null ? 'deleted' : 'modified'
      const { added, removed } = countLines(before ?? '', after ?? '')
      files.push({ path: shown(session.folder, full), status, added, removed })
    }
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  /** A diff of one changed file against how it was before the session. */
  async diff(sessionId: string, path: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) return ''
    const full = await inside(session.folder, path)
    if (!session.originals.has(full)) return ''
    const before = session.originals.get(full) ?? ''
    const after = await readFile(full, 'utf8').catch(() => '')
    return lineDiff(before, after)
  }

  /** Puts back every file the session changed, and forgets the changes. Only while it isn't working. */
  async undo(sessionId: string): Promise<number> {
    const session = this.sessions.get(sessionId)
    if (!session) return 0
    if (session.controller) throw new Error('Stop Terra Code before undoing its changes.')
    let restored = 0
    for (const [full, before] of session.originals) {
      const now = await readFile(full, 'utf8').catch(() => null)
      if (now === before) continue
      if (before === null) await unlink(full).catch(() => undefined)
      else await writeText(full, before)
      restored++
    }
    session.originals.clear()
    session.messages.push({ role: 'user', content: '(The person undid every change made so far in this session. The files are back as they were before.)' })
    session.messages.push({ role: 'assistant', content: 'Understood: all my changes were undone.' })
    return restored
  }

  async run(sessionId: string, folder: string, task: string, mode: CoderMode, emit: Emit): Promise<void> {
    // Its real path, so names shown to the model and the person match what `inside` resolves.
    folder = await realpath(folder).catch(() => folder)
    let session = this.sessions.get(sessionId)
    if (session && session.folder !== folder) {
      this.reset(sessionId)
      session = undefined
    }
    session ??= { messages: [], controller: null, allowed: new Set<string>(), originals: new Map(), folder }
    this.sessions.set(sessionId, session)
    if (session.controller) throw new Error('This session is already working.')
    const controller = new AbortController()
    session.controller = controller
    const { signal } = controller
    const info = await stat(folder).catch(() => null)
    try {
      if (!info?.isDirectory()) throw new ToolError("The project folder can't be found. Choose it again.")
      const first = session.messages.length === 0
      const modeNote = mode === 'plan' ? '\n\n(Plan mode: look and plan only.)' : ''
      session.messages.push({ role: 'user', content: first ? `${await projectContext(folder)}\n\nTask:\n${task}${modeNote}` : `${task}${modeNote}` })
      const system = mode === 'plan' ? CODER_PROMPT + CODER_PLAN_PROMPT : CODER_PROMPT
      for (let step = 1; ; step++) {
        if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
        if (step > CODER_MAX_STEPS) {
          session.messages.push({ role: 'assistant', content: '(Stopped: step limit reached.)' })
          return emit({ sessionId, type: 'done', reason: 'step-limit' })
        }
        emit({ sessionId, type: 'thinking', step })
        trimContext(session.messages)
        let lastStream = 0
        const reply = await this.deps.chat(session.messages, system, signal, (partial) => {
          const now = Date.now()
          if (now - lastStream < STREAM_EVERY_MS) return
          lastStream = now
          const text = streamingText(partial)
          if (text) emit({ sessionId, type: 'stream', text })
        })
        if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
        session.messages.push({ role: 'assistant', content: reply })
        const { text, calls, invalid } = parseCoderReply(reply)
        if (text) emit({ sessionId, type: 'text', text })
        if (calls.length === 0 && !invalid) return emit({ sessionId, type: 'done', reason: 'finished' })
        const results: string[] = []
        let declined = false
        for (const call of calls) {
          if (signal.aborted) break
          if (declined) {
            results.push(toolResult(call.tool, 'Skipped, because the person declined an earlier step in this reply.'))
            continue
          }
          const outcome = await this.use(sessionId, folder, call, mode, session, signal, emit)
          declined = outcome.declined
          results.push(toolResult(call.tool, outcome.output))
        }
        if (invalid) results.push(toolResult('error', 'A tool block could not be read. Use one JSON object per block in the format shown, with all required fields.'))
        session.messages.push({ role: 'user', content: results.join('\n') })
      }
    } catch (error) {
      if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
      const network = isNetwork(error)
      emit({ sessionId, type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.', ...(network ? { network: true } : {}) })
    } finally {
      session.controller = null
    }
  }

  /** Remembers a file as it was before the session first changed it. */
  private async remember(session: Session, full: string): Promise<void> {
    if (session.originals.has(full)) return
    session.originals.set(full, await readFile(full, 'utf8').catch(() => null))
  }

  private async publishChanges(sessionId: string, emit: Emit): Promise<void> {
    emit({ sessionId, type: 'changes', files: await this.changes(sessionId) })
  }

  /** Runs one tool, asking first when it changes something. Returns what the model is told. */
  private async use(sessionId: string, root: string, call: CoderCall, mode: CoderMode, session: Session, signal: AbortSignal, emit: Emit): Promise<{ output: string; declined: boolean }> {
    const id = randomUUID()
    const report = (ok: boolean, output: string, declined = false) => {
      emit({ sessionId, type: 'tool-result', id, ok, output })
      return { output, declined }
    }
    const announce = (summary: string) => emit({ sessionId, type: 'tool', id, tool: call.tool, summary })
    const approve = async (kind: 'change' | 'command', summary: string, detail: string) => {
      if (kind === 'change' && mode === 'edits') return true
      const answer = await this.ask(sessionId, kind, summary, detail, signal, emit)
      if (answer === 'always' && call.tool === 'run') session.allowed.add(call.command)
      return answer !== 'deny'
    }
    try {
      if (mode === 'plan' && CHANGING_TOOLS.has(call.tool)) {
        announce(call.tool === 'run' ? `Run ${call.command}` : `${call.tool} (not in plan mode)`)
        return report(false, 'Plan mode: no changes or commands. Describe this step in your plan instead.')
      }
      switch (call.tool) {
        case 'list':
          announce(`List ${call.path}`)
          return report(true, await listFiles(root, call.path))
        case 'glob':
          announce(`Find ${call.pattern}`)
          return report(true, await globFiles(root, call.pattern))
        case 'read':
          announce(`Read ${call.path}${call.offset > 1 ? ` from line ${call.offset}` : ''}`)
          return report(true, await readLines(root, call.path, call.offset, call.limit))
        case 'search':
          announce(`Search for ${call.pattern}${call.path === '.' ? '' : ` in ${call.path}`}${call.glob ? ` (${call.glob})` : ''}`)
          return report(true, await searchFiles(root, call.path, call.pattern, call.glob))
        case 'todo':
          announce(`Plan: ${call.items.filter((item) => item.done).length} of ${call.items.length} done`)
          emit({ sessionId, type: 'todo', items: call.items })
          return report(true, 'Checklist shown to the person.')
        case 'web': {
          announce(`Search the web for ${call.query}`)
          if (!this.deps.webSearch) return report(false, 'Web search is not available here.')
          return report(true, clip(await this.deps.webSearch(call.query), 24_000))
        }
        case 'write':
        case 'edit': {
          announce(`${call.tool === 'write' ? 'Write' : 'Edit'} ${call.path}`)
          const full = await inside(root, call.path)
          const name = shown(root, full)
          const exists = await stat(full).then((info) => info.isFile(), () => false)
          const before = exists ? await readText(full) : ''
          if (call.tool === 'edit' && !exists) throw new ToolError("That file doesn't exist. Use write to create it.")
          const after = call.tool === 'write' ? call.content : applyEdits(before, call.edits)
          if (exists && after === before) return report(true, 'No change: the file already has that text.')
          const summary = call.tool === 'write' ? `${exists ? 'Replace' : 'Create'} ${name}` : `Edit ${name}`
          const detail = exists ? lineDiff(before, after) : lineDiff('', after, 0).replace(/^@@.*\n/, '')
          if (!(await approve('change', summary, detail))) return report(false, 'The person declined this change. Ask what they want instead, or try another way.', true)
          await this.remember(session, full)
          await writeText(full, after)
          await this.publishChanges(sessionId, emit)
          const { added, removed } = countLines(before, after)
          return report(true, `${exists ? 'Updated' : 'Created'} ${name} (+${added} −${removed}).`)
        }
        case 'delete': {
          announce(`Delete ${call.path}`)
          const full = await inside(root, call.path)
          const name = shown(root, full)
          const before = await readText(full)
          if (!(await approve('change', `Delete ${name}`, lineDiff(before, '', 0)))) return report(false, 'The person declined deleting this file.', true)
          await this.remember(session, full)
          await deleteFile(full)
          await this.publishChanges(sessionId, emit)
          return report(true, `Deleted ${name}.`)
        }
        case 'move': {
          announce(`Move ${call.from} to ${call.to}`)
          const from = await inside(root, call.from)
          const to = await inside(root, call.to)
          const summary = `Move ${shown(root, from)} to ${shown(root, to)}`
          if (!(await approve('change', summary, `${shown(root, from)}\n→ ${shown(root, to)}`))) return report(false, 'The person declined this move.', true)
          await this.remember(session, from)
          await this.remember(session, to)
          await moveFile(from, to)
          await this.publishChanges(sessionId, emit)
          return report(true, `${summary}.`)
        }
        case 'run': {
          announce(`Run ${call.command}`)
          if (!session.allowed.has(call.command) && !(await approve('command', `Run a command in ${root}`, call.command))) {
            return report(false, 'The person declined to run this command.', true)
          }
          const { ok, output } = await runCommand(root, call.command, signal)
          // A command can change files too, but those aren't tracked: only Terra Code's own edits can be undone.
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

const isNetwork = (error: unknown) =>
  (error instanceof Error && 'kind' in error && (error as { kind: unknown }).kind === 'network') ||
  (error instanceof Error && /net::ERR_|fetch failed|Failed to fetch|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(error.message))

/** Lines added and removed, by a plain multiset comparison: close enough for a summary. */
export function countLines(before: string, after: string): { added: number; removed: number } {
  const count = (text: string) => {
    const lines = new Map<string, number>()
    if (text) for (const line of text.split('\n')) lines.set(line, (lines.get(line) ?? 0) + 1)
    return lines
  }
  const a = count(before)
  const b = count(after)
  let added = 0
  let removed = 0
  for (const [line, n] of b) added += Math.max(0, n - (a.get(line) ?? 0))
  for (const [line, n] of a) removed += Math.max(0, n - (b.get(line) ?? 0))
  return { added, removed }
}

/** The file list and any instruction files, so the first step can start on the task. */
export async function projectContext(folder: string): Promise<string> {
  const parts = [`Project folder: ${folder}`]
  const listing = await listFiles(folder, '.').catch(() => null)
  if (listing) parts.push(`Files:\n${clip(listing, 8000)}`)
  for (const name of INSTRUCTION_FILES) {
    const text = await readText(join(folder, name)).catch(() => null)
    if (text?.trim()) parts.push(toolResult(`file ${name}`, text.length > INSTRUCTION_CHARS ? `${text.slice(0, INSTRUCTION_CHARS)}\n… (cut; read the file for the rest)` : text))
  }
  return parts.join('\n\n')
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
