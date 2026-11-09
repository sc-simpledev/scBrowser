import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { AiError, CHANGING_TOOLS, closeToolTurns, CODER_BAD_BLOCK, CODER_BAD_TOOL, CODER_EXPLORE_NATIVE_PROMPT, CODER_EXPLORE_PROMPT, CODER_LOOK_TOOLS, CODER_NATIVE_NUDGE, CODER_NATIVE_PROMPT, CODER_NATIVE_VERIFY_NUDGE, CODER_NUDGE, CODER_PLAN_PROMPT, CODER_PLAN_TOOLS, CODER_PROMPT, CODER_TOOLS, CODER_VERIFY_NUDGE, flattenToolTurns, isDoneMarker, MAX_CALLS_PER_REPLY, nativeCall, parseCoderReply, promisesAction, streamingText, toolResult, type ChatMessage, type CoderCall, type ToolOutput, type ToolSpec, type ToolUse } from '@scbrowser/ai'
import { acceptHunk, CODER_MAX_STEPS, fileHunks, rejectHunk, type AssistantMessage, type CoderAnswer, type CoderChange, type CoderDecision, type CoderEvent, type CoderMode, type CoderReview } from '@scbrowser/shared'
import { asText, MAX_COMMAND_FILES, type CoderCheckpoints, type CoderSnapshots } from './coderStorage'
import { applyEdits, clip, commandEnv, deleteFile, globFiles, inside, lineDiff, listFiles, moveFile, readLines, readText, runCommand, searchFiles, shown, ToolError, writeText } from './coderTools'

/** Older tool output is emptied once the conversation grows past this, keeping recent work whole. */
const MAX_CONTEXT_CHARS = 350_000
/** Files the model is shown at the start, so it knows the project's own rules without asking. */
const INSTRUCTION_FILES = ['TERRA.md', 'AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', '.cursorrules', 'README.md']
const INSTRUCTION_CHARS = 6000
const STREAM_EVERY_MS = 80
/** Times in a row a reply may promise work without doing it before that's taken as the answer. */
const MAX_NUDGES = 2
/** Times in a row every tool block may be unreadable before giving up, rather than spending the step limit. */
const MAX_BAD_REPLIES = 4
/** Waits before asking the model again after it was busy or out of reach. */
const RETRY_SECONDS = [1, 3, 8]
/** The same step this many times with nothing changing in between is refused. */
const MAX_REPEATS = 3
/** Refused repeats in one run before it's clear the model is going round in circles. */
const MAX_REFUSED_REPEATS = 6
const EXPLORE_STEPS = 15
/** Files whose presence means the project has something worth running after a change. */
const CHECK_FILES = ['Cargo.toml', 'go.mod', 'pyproject.toml', 'pytest.ini', 'tox.ini', 'Makefile', 'tsconfig.json', 'pom.xml', 'build.gradle', 'build.gradle.kts']
const READ_ONLY = new Set<CoderCall['tool']>(['list', 'glob', 'read', 'search'])

type Emit = (event: CoderEvent) => void

interface Session {
  messages: ChatMessage[]
  /** Using the provider's own tool calling, rather than tools written as text in replies. */
  native: boolean
  controller: AbortController | null
  /** Commands the person said to always allow, exactly as written, for this session only. */
  allowed: Set<string>
  /** How each file was before this session first changed it (null: it didn't exist), for undo and the changes list. */
  originals: Map<string, string | null>
  folder: string
  /** Whether the first message, with the file list and instruction files, has gone out. */
  introduced: boolean
  /** Messages the person sent while it was working, for its next step. */
  queue: string[]
  /** When each file was last seen by the model, so it can't overwrite something newer than it read. */
  seen: Map<string, number>
  /** Files whose earlier version isn't text, as the snapshot object that holds them. Also listed in `originals`. */
  opaque: Map<string, string>
  /** Set once a snapshot fails, so a folder too big to scan doesn't slow down every command. */
  noSnapshots: boolean
}

interface Reply {
  text: string
  uses: ToolUse[]
}

/** One step a reply asked for. `use` is set when it came through the provider's tool calling. */
interface Step {
  use: ToolUse | null
  call: CoderCall | null
}

export interface CoderDependencies {
  chat: (messages: AssistantMessage[], system: string, signal: AbortSignal, onText?: (text: string) => void) => Promise<string>
  /** Web results as text for the model, or null when web search isn't available. */
  webSearch?: (query: string) => Promise<string>
  /** Seconds to wait before each new try after a failed request. */
  retrySeconds?: number[]
  /** The provider's own tool calling, when the chat model's provider can do it. */
  native?: {
    available: () => boolean
    chat: (messages: ChatMessage[], system: string, tools: ToolSpec[], signal: AbortSignal, onText?: (text: string) => void) => Promise<Reply>
  }
  checkpoints?: CoderCheckpoints
  snapshots?: CoderSnapshots
  /** False when the person has turned saved chats off, so nothing is kept on disk. */
  keepOnDisk?: () => boolean
}

/**
 * Terra Code, agentic coding (beta). The model works in one folder the person chose: it can look at
 * anything inside it, but every change asks first (unless they let edits through) and every command
 * asks first (unless they always allowed that exact command in this session). Plan mode only looks.
 * Nothing outside the folder is reachable through its tools, though a command the person approves
 * runs with their own permissions. Every file it or a command changes is remembered as it was, so
 * the session's changes can be reviewed and undone, including after a restart.
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

  /** Hands a message to a run under way. False if nothing is running, so the page can start one. */
  steer(sessionId: string, text: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session?.controller) return false
    session.queue.push(text)
    return true
  }

  /** Lets go of a session in memory. Its checkpoint stays, so going back to the saved chat still works. */
  reset(sessionId: string): void {
    this.stop(sessionId)
    this.sessions.delete(sessionId)
  }

  /** Forgets a session everywhere, for when its chat is deleted. */
  async forget(sessionId: string): Promise<void> {
    this.reset(sessionId)
    await Promise.all([this.deps.checkpoints?.remove(sessionId), this.deps.snapshots?.remove(sessionId)])
  }

  /** For clearing every saved chat. Sessions that are working carry on in memory. */
  async forgetAll(): Promise<void> {
    await Promise.all([this.deps.checkpoints?.clear(), this.deps.snapshots?.clear()])
  }

  private async persist(sessionId: string, session: Session): Promise<void> {
    if (!this.deps.checkpoints || this.deps.keepOnDisk?.() === false) return
    await this.deps.checkpoints
      .save(sessionId, { version: 1, folder: session.folder, native: session.native, introduced: session.introduced, messages: session.messages, originals: [...session.originals], opaque: [...session.opaque], seen: [...session.seen] })
      .catch(() => undefined)
  }

  /** The session in memory, or picked back up from disk after a restart. */
  private async loaded(sessionId: string): Promise<Session | undefined> {
    const live = this.sessions.get(sessionId)
    if (live) return live
    const saved = await this.deps.checkpoints?.load(sessionId)
    if (!saved) return undefined
    // Another call may have got here first while this one was reading.
    const raced = this.sessions.get(sessionId)
    if (raced) return raced
    const within = ([full]: [string, unknown]) => full.startsWith(saved.folder + sep)
    const session: Session = {
      messages: saved.messages,
      native: saved.native && !!this.deps.native?.available(),
      controller: null,
      allowed: new Set(),
      originals: new Map(saved.originals.filter(within)),
      folder: saved.folder,
      introduced: saved.introduced,
      queue: [],
      seen: new Map((saved.seen ?? []).filter(within)),
      opaque: new Map((saved.opaque ?? []).filter(within)),
      noSnapshots: false
    }
    if (saved.native && !session.native) session.messages = flattenToolTurns(session.messages)
    this.sessions.set(sessionId, session)
    return session
  }

  /** Every file the session changed, against how it was before. */
  async changes(sessionId: string): Promise<CoderChange[]> {
    const session = await this.loaded(sessionId)
    if (!session) return []
    const files: CoderChange[] = []
    for (const [full, before] of session.originals) {
      if (session.opaque.has(full)) {
        const exists = await stat(full).then(() => true, () => false)
        files.push({ path: shown(session.folder, full), status: exists ? 'modified' : 'deleted', added: 0, removed: 0 })
        continue
      }
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
    const session = await this.loaded(sessionId)
    if (!session) return ''
    const full = await inside(session.folder, path)
    if (!session.originals.has(full) || session.opaque.has(full)) return ''
    const before = session.originals.get(full) ?? ''
    const after = await readFile(full, 'utf8').catch(() => '')
    return lineDiff(before, after)
  }

  /** Puts back every file the session changed, or just `path`, and forgets those changes. Only while it isn't working. */
  async undo(sessionId: string, path?: string): Promise<number> {
    const session = await this.loaded(sessionId)
    if (!session) return 0
    if (session.controller) throw new Error('Stop Terra Code before undoing its changes.')
    let restored = 0
    const only = path === undefined ? null : await inside(session.folder, path)
    for (const [full, before] of [...session.originals]) {
      if (only && full !== only) continue
      const object = session.opaque.get(full)
      if (object !== undefined) {
        const bytes = await this.deps.snapshots?.show(sessionId, session.folder, object)
        if (!bytes) continue
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, bytes)
        session.opaque.delete(full)
        restored++
        continue
      }
      const now = await readFile(full, 'utf8').catch(() => null)
      if (now === before) continue
      if (before === null) await unlink(full).catch(() => undefined)
      else await writeText(full, before)
      restored++
    }
    if (only) session.originals.delete(only)
    else {
      for (const full of session.originals.keys()) if (!session.opaque.has(full)) session.originals.delete(full)
    }
    session.seen.clear()
    session.messages.push({ role: 'user', content: only ? `(The person undid your changes to ${path}. It's back as it was before.)` : '(The person undid every change made so far in this session. The files are back as they were before.)' })
    session.messages.push({ role: 'assistant', content: 'Understood: those changes were undone.' })
    await this.persist(sessionId, session)
    return restored
  }

  /** One changed file, split into its separate changes for reviewing. */
  async review(sessionId: string, path: string): Promise<CoderReview | null> {
    const session = await this.loaded(sessionId)
    if (!session) return null
    const full = await inside(session.folder, path)
    if (!session.originals.has(full)) return null
    const name = shown(session.folder, full)
    if (session.opaque.has(full)) return { path: name, status: 'modified', whole: true, binary: true, hunks: [] }
    const before = session.originals.get(full) ?? null
    const after = await readFile(full, 'utf8').catch(() => null)
    const status = before === null ? 'created' : after === null ? 'deleted' : 'modified'
    return { path: name, status, whole: status !== 'modified', binary: false, hunks: fileHunks(before ?? '', after ?? '').map(({ id, line, rows }) => ({ id, line, rows: rows.slice(0, 2000) })) }
  }

  /** Keeps a change for good, or puts it back. With no hunk, it's the whole file. */
  async decide(sessionId: string, path: string, hunk: string | null, decision: CoderDecision): Promise<CoderChange[]> {
    const session = await this.loaded(sessionId)
    if (!session) return []
    if (session.controller) throw new Error('Stop Terra Code before reviewing its changes.')
    const full = await inside(session.folder, path)
    if (!session.originals.has(full)) return this.changes(sessionId)
    if (hunk === null) {
      if (decision === 'reject') await this.undo(sessionId, path)
      session.originals.delete(full)
      session.opaque.delete(full)
    } else {
      const before = session.originals.get(full) ?? ''
      const after = await readFile(full, 'utf8')
      const found = fileHunks(before, after).find((candidate) => candidate.id === hunk)
      if (!found) throw new ToolError('That change has moved on. Look at the file again.')
      if (decision === 'accept') {
        const kept = acceptHunk(before, after, found.range)
        if (kept === after) session.originals.delete(full)
        else session.originals.set(full, kept)
      } else {
        const putBack = rejectHunk(before, after, found.range)
        await writeText(full, putBack)
        if (putBack === before) session.originals.delete(full)
        session.seen.delete(full)
        session.messages.push({ role: 'user', content: `(The person put back one of your changes to ${path}, around line ${found.line}. Read the file again before changing it.)` })
        session.messages.push({ role: 'assistant', content: 'Understood: that change was put back.' })
      }
    }
    await this.persist(sessionId, session)
    return this.changes(sessionId)
  }

  async run(sessionId: string, folder: string, task: string, mode: CoderMode, emit: Emit, resume?: AssistantMessage[]): Promise<void> {
    // Its real path, so names shown to the model and the person match what `inside` resolves.
    folder = await realpath(folder).catch(() => folder)
    let session = await this.loaded(sessionId)
    if (session && session.folder !== folder) {
      this.reset(sessionId)
      session = undefined
    }
    session ??= { messages: resume ?? [], native: !!this.deps.native?.available(), controller: null, allowed: new Set<string>(), originals: new Map(), folder, introduced: false, queue: [], seen: new Map(), opaque: new Map(), noSnapshots: false }
    this.sessions.set(sessionId, session)
    if (session.controller) throw new Error('This session is already working.')
    const controller = new AbortController()
    session.controller = controller
    const { signal } = controller
    const info = await stat(folder).catch(() => null)
    try {
      if (!info?.isDirectory()) throw new ToolError("The project folder can't be found. Choose it again.")
      const first = !session.introduced
      session.introduced = true
      const modeNote = mode === 'plan' ? '\n\n(Plan mode: look and plan only.)' : ''
      session.messages.push({ role: 'user', content: first ? `${await projectContext(folder)}\n\nTask:\n${task}${modeNote}` : `${task}${modeNote}` })
      session.messages = closeToolTurns(session.messages)
      let nudges = 0
      let badReplies = 0
      // Files changed since a command last ran, and whether it's been told to check them this task.
      let unchecked = false
      let verifyAsked = false
      const repeats = new Map<string, number>()
      let refusedRepeats = 0
      for (let step = 1; ; step++) {
        if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
        if (step > CODER_MAX_STEPS) {
          session.messages.push({ role: 'assistant', content: '(Stopped: step limit reached.)' })
        await this.persist(sessionId, session)
          return emit({ sessionId, type: 'done', reason: 'step-limit' })
        }
        emit({ sessionId, type: 'thinking', step })
        for (const text of session.queue.splice(0)) session.messages.push({ role: 'user', content: `(The person added this while you were working:)\n${text}` })
        trimContext(session.messages)
        let lastStream = 0
        const reply = await this.askModel(session, mode, signal, sessionId, emit, (partial) => {
          const now = Date.now()
          if (now - lastStream < STREAM_EVERY_MS) return
          lastStream = now
          const shownSoFar = streamingText(partial)
          if (shownSoFar) emit({ sessionId, type: 'stream', text: shownSoFar })
        })
        if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
        const usedNative = reply.uses.length > 0
        session.messages.push(usedNative ? { role: 'assistant', content: reply.text, toolUses: reply.uses } : { role: 'assistant', content: reply.text })
        // A model given real tools can still write one as text, so that keeps working.
        const parsed = usedNative ? { text: reply.text.trim(), calls: [] as CoderCall[], invalid: false } : parseCoderReply(reply.text)
        const { text, invalid } = parsed
        const steps: Step[] = usedNative ? reply.uses.map((use) => ({ use, call: nativeCall(use) })) : parsed.calls.map((call) => ({ use: null, call }))
        if (text && !isDoneMarker(text)) emit({ sessionId, type: 'text', text })
        if (steps.length === 0 && !invalid) {
          if (session.queue.length > 0) continue
          const promised = !isDoneMarker(text) && nudges < MAX_NUDGES && promisesAction(text)
          if (!promised && unchecked && !verifyAsked && !isDoneMarker(text) && mode !== 'plan' && (await hasChecks(folder))) {
            verifyAsked = true
            session.messages.push({ role: 'user', content: session.native ? CODER_NATIVE_VERIFY_NUDGE : CODER_VERIFY_NUDGE })
            continue
          }
          if (!promised) {
            await this.persist(sessionId, session)
            return emit({ sessionId, type: 'done', reason: 'finished' })
          }
          nudges++
          session.messages.push({ role: 'user', content: session.native ? CODER_NATIVE_NUDGE : CODER_NUDGE })
          continue
        }
        nudges = 0
        const usable = steps.filter((step) => step.call).length
        badReplies = usable === 0 ? badReplies + 1 : 0
        if (badReplies >= MAX_BAD_REPLIES) throw new ToolError('The model keeps sending tool requests that can\'t be read. Try again, or choose a stronger coding model in AI settings.')
        const results: ToolOutput[] = []
        const answerStep = (step: Step, tool: string, output: string) => results.push({ id: step.use?.id ?? '', tool, output })
        let declined = false
        for (let i = 0; i < steps.length; i++) {
          if (signal.aborted) break
          const step = steps[i]!
          const call = step.call
          if (!call) {
            answerStep(step, step.use?.name ?? 'error', CODER_BAD_TOOL)
            continue
          }
          if (i >= MAX_CALLS_PER_REPLY) {
            answerStep(step, call.tool, `Skipped: only ${MAX_CALLS_PER_REPLY} tools run per reply. Send this one again.`)
            continue
          }
          if (declined) {
            answerStep(step, call.tool, 'Skipped, because the person declined an earlier step in this reply.')
            continue
          }
          if (call.tool !== 'todo') {
            const key = JSON.stringify(call)
            const count = (repeats.get(key) ?? 0) + 1
            repeats.set(key, count)
            if (count > MAX_REPEATS) {
              if (++refusedRepeats >= MAX_REFUSED_REPEATS) throw new ToolError('Terra Code kept repeating the same steps without getting anywhere, so it was stopped. Try rewording the task, or a stronger model.')
              answerStep(step, call.tool, `Not run: you've already done exactly this ${count - 1} times and nothing has changed since. Try a different approach, or tell the person what's blocking you.`)
              continue
            }
          }
          // Steps that only look don't depend on each other, so a run of them goes at once.
          let end = i + 1
          const looks = (candidate: Step | undefined) => !!candidate?.call && READ_ONLY.has(candidate.call.tool)
          if (READ_ONLY.has(call.tool)) while (end < steps.length && end < MAX_CALLS_PER_REPLY && looks(steps[end])) end++
          const batch = steps.slice(i, end)
          const outcomes = await Promise.all(batch.map((one) => this.use(sessionId, folder, one.call!, mode, session, signal, emit)))
          outcomes.forEach((outcome, index) => {
            const used = batch[index]!
            declined ||= outcome.declined
            answerStep(used, used.call!.tool, outcome.output)
            if (outcome.changed) {
              // Something changed, so the same step could now turn out differently.
              repeats.clear()
              if (used.call!.tool === 'run') unchecked = false
              else unchecked = true
            }
          })
          i = end - 1
        }
        if (usedNative) session.messages.push({ role: 'user', content: '', toolResults: results })
        else {
          const lines = results.map(({ tool, output }) => toolResult(tool, output))
          if (invalid) lines.push(toolResult('error', CODER_BAD_BLOCK))
          session.messages.push({ role: 'user', content: lines.join('\n') })
        }
        await this.persist(sessionId, session)
      }
    } catch (error) {
      if (signal.aborted) return emit({ sessionId, type: 'done', reason: 'stopped' })
      const network = isNetwork(error)
      emit({ sessionId, type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.', ...(network ? { network: true } : {}) })
    } finally {
      session.controller = null
      await this.persist(sessionId, session)
    }
  }

  /** Asks the model, trying again a few times if it's busy or a connection drops. */
  private async askModel(session: Session, mode: CoderMode, signal: AbortSignal, sessionId: string, emit: Emit, onText?: (text: string) => void): Promise<Reply> {
    const waits = this.deps.retrySeconds ?? RETRY_SECONDS
    for (let attempt = 0; ; ) {
      try {
        const plan = mode === 'plan'
        if (session.native && this.deps.native) return await this.deps.native.chat(session.messages, plan ? CODER_NATIVE_PROMPT + CODER_PLAN_PROMPT : CODER_NATIVE_PROMPT, plan ? CODER_PLAN_TOOLS : CODER_TOOLS, signal, onText)
        return { text: await this.deps.chat(session.messages, plan ? CODER_PROMPT + CODER_PLAN_PROMPT : CODER_PROMPT, signal, onText), uses: [] }
      } catch (error) {
        if (session.native && !signal.aborted && error instanceof AiError && error.kind === 'bad-request') {
          // Most likely a model or gateway without tool calling. The text protocol works with anything.
          session.native = false
          session.messages = flattenToolTurns(session.messages)
          continue
        }
        const seconds = waits[attempt++]
        if (signal.aborted || seconds === undefined || !isTemporary(error)) throw error
        emit({ sessionId, type: 'retrying', seconds })
        await new Promise<void>((done) => {
          const timer = setTimeout(done, seconds * 1000)
          signal.addEventListener('abort', () => (clearTimeout(timer), done()), { once: true })
        })
        if (signal.aborted) throw error
      }
    }
  }

  /** A helper with its own short conversation, which can only look, and reports what it found. */
  private async explore(root: string, question: string, signal: AbortSignal, native: boolean): Promise<string> {
    const messages: ChatMessage[] = [{ role: 'user', content: `Project folder: ${root}\n\nQuestion:\n${question}` }]
    const ask = async (): Promise<Reply> =>
      native && this.deps.native ? this.deps.native.chat(messages, CODER_EXPLORE_NATIVE_PROMPT, CODER_LOOK_TOOLS, signal) : { text: await this.deps.chat(messages, CODER_EXPLORE_PROMPT, signal), uses: [] }
    const look = async (call: CoderCall | null) => (call ? lookOnly(root, call).catch((error: Error) => (error instanceof ToolError ? error.message : 'Failed.')) : CODER_BAD_TOOL)
    for (let step = 1; step <= EXPLORE_STEPS; step++) {
      if (signal.aborted) throw new Error('Stopped')
      const reply = await ask()
      if (reply.uses.length > 0) {
        messages.push({ role: 'assistant', content: reply.text, toolUses: reply.uses })
        const toolResults = await Promise.all(reply.uses.map(async (use) => ({ id: use.id, tool: use.name, output: await look(nativeCall(use)) })))
        messages.push({ role: 'user', content: '', toolResults })
      } else {
        messages.push({ role: 'assistant', content: reply.text })
        const { text, calls } = parseCoderReply(reply.text)
        if (calls.length === 0) return text || 'The helper found nothing to report.'
        const results = await Promise.all(calls.map(async (call) => toolResult(call.tool, await look(call))))
        messages.push({ role: 'user', content: results.join('\n') })
      }
      trimContext(messages, 120_000)
    }
    messages.push({ role: 'user', content: native ? 'That was your last step. Report what you found now, without calling a tool.' : 'That was your last step. Report what you found now, without a tool block.' })
    const last = await ask()
    return (last.uses.length > 0 ? last.text : parseCoderReply(last.text).text) || 'The helper ran out of steps.'
  }

  /** Records everything a command changed, so it can be reviewed and undone. Returns a note for the model. */
  private async trackCommand(sessionId: string, session: Session, before: string | null, emit: Emit): Promise<string> {
    const { snapshots } = this.deps
    if (!snapshots || before === null) return ''
    const after = await snapshots.take(sessionId, session.folder)
    if (after === null) {
      session.noSnapshots = true
      return ''
    }
    const found = await snapshots.changed(sessionId, session.folder, before, after)
    if (found.length === 0) return ''
    for (const { path, status } of found.slice(0, MAX_COMMAND_FILES)) {
      const full = join(session.folder, path)
      if (session.originals.has(full)) continue
      if (status === 'added') {
        session.originals.set(full, null)
        continue
      }
      const object = `${before}:${path}`
      const bytes = await snapshots.show(sessionId, session.folder, object)
      if (!bytes) continue
      const text = asText(bytes)
      session.originals.set(full, text ?? '')
      if (text === null) session.opaque.set(full, object)
    }
    await this.publishChanges(sessionId, emit)
    const names = found.slice(0, 20).map((file) => file.path).join(', ')
    return `\n\n(This command changed ${found.length} ${found.length === 1 ? 'file' : 'files'}: ${names}${found.length > 20 ? ', …' : ''})`
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
  private async use(sessionId: string, root: string, call: CoderCall, mode: CoderMode, session: Session, signal: AbortSignal, emit: Emit): Promise<{ output: string; declined: boolean; changed: boolean }> {
    const id = randomUUID()
    const report = (ok: boolean, output: string, declined = false, changed = false) => {
      emit({ sessionId, type: 'tool-result', id, ok, output })
      return { output, declined, changed }
    }
    const noteSeen = async (full: string) => session.seen.set(full, (await stat(full)).mtimeMs)
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
          {
            const output = await readLines(root, call.path, call.offset, call.limit)
            await noteSeen(await inside(root, call.path))
            return report(true, output)
          }
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
        case 'explore':
          announce(`Explore ${call.task}`)
          return report(true, clip(await this.explore(root, call.task, signal, session.native), 16_000))
        case 'write':
        case 'edit': {
          announce(`${call.tool === 'write' ? 'Write' : 'Edit'} ${call.path}`)
          const full = await inside(root, call.path)
          const name = shown(root, full)
          const exists = await stat(full).then((info) => info.isFile(), () => false)
          const before = exists ? await readText(full) : ''
          const lastSeen = session.seen.get(full)
          if (exists && lastSeen !== undefined && (await stat(full)).mtimeMs !== lastSeen) throw new ToolError('That file changed since you read it. Read it again, then redo this change.')
          if (call.tool === 'edit' && !exists) throw new ToolError("That file doesn't exist. Use write to create it.")
          const after = call.tool === 'write' ? call.content : applyEdits(before, call.edits)
          if (exists && after === before) return report(true, 'No change: the file already has that text.')
          const summary = call.tool === 'write' ? `${exists ? 'Replace' : 'Create'} ${name}` : `Edit ${name}`
          const detail = exists ? lineDiff(before, after) : lineDiff('', after, 0).replace(/^@@.*\n/, '')
          if (!(await approve('change', summary, detail))) return report(false, 'The person declined this change. Ask what they want instead, or try another way.', true)
          await this.remember(session, full)
          await writeText(full, after)
          await noteSeen(full)
          await this.publishChanges(sessionId, emit)
          const { added, removed } = countLines(before, after)
          return report(true, `${exists ? 'Updated' : 'Created'} ${name} (+${added} −${removed}).`, false, true)
        }
        case 'delete': {
          announce(`Delete ${call.path}`)
          const full = await inside(root, call.path)
          const name = shown(root, full)
          const before = await readText(full)
          if (!(await approve('change', `Delete ${name}`, lineDiff(before, '', 0)))) return report(false, 'The person declined deleting this file.', true)
          await this.remember(session, full)
          await deleteFile(full)
          session.seen.delete(full)
          await this.publishChanges(sessionId, emit)
          return report(true, `Deleted ${name}.`, false, true)
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
          session.seen.delete(from)
          await this.publishChanges(sessionId, emit)
          return report(true, `${summary}.`, false, true)
        }
        case 'run': {
          announce(`Run ${call.command}`)
          if (!session.allowed.has(call.command) && !(await approve('command', `Run a command in ${root}`, call.command))) {
            return report(false, 'The person declined to run this command.', true)
          }
          const before = session.noSnapshots ? null : ((await this.deps.snapshots?.take(sessionId, root)) ?? null)
          if (before === null && this.deps.snapshots) session.noSnapshots = true
          let result: { ok: boolean; output: string }
          let note = ''
          try {
            result = await runCommand(root, call.command, signal, call.timeout ? call.timeout * 1000 : undefined)
          } finally {
            // Also when it was stopped halfway, as it may have changed things by then.
            note = await this.trackCommand(sessionId, session, before, emit).catch(() => '')
            session.seen.clear()
          }
          return report(result.ok, result.output + note, false, true)
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

/** Only what going again could fix: not a bad key, and not a daily limit that lasts until tomorrow. */
function isTemporary(error: unknown): boolean {
  if (isNetwork(error)) return true
  const message = error instanceof Error ? error.message : ''
  if (/per day|daily|quota|billing|credit/i.test(message)) return false
  return /\b(429|500|502|503|504|529)\b|overloaded|rate.?limit|too many requests|try again|temporarily/i.test(message)
}

/** The tools the explore helper may use. */
async function lookOnly(root: string, call: CoderCall): Promise<string> {
  switch (call.tool) {
    case 'list':
      return listFiles(root, call.path)
    case 'glob':
      return globFiles(root, call.pattern)
    case 'read':
      return readLines(root, call.path, call.offset, call.limit)
    case 'search':
      return searchFiles(root, call.path, call.pattern, call.glob)
    default:
      return 'This helper can only look: list, glob, read and search.'
  }
}

/** Whether the project has tests, a type checker, a linter or a build to run after a change. */
async function hasChecks(folder: string): Promise<boolean> {
  const script = await readFile(join(folder, 'package.json'), 'utf8').then((text) => Object.keys((JSON.parse(text) as { scripts?: object }).scripts ?? {}).some((name) => /test|check|lint|build/.test(name)), () => false)
  if (script) return true
  const found = await Promise.all(CHECK_FILES.map((name) => stat(join(folder, name)).then(() => true, () => false)))
  return found.includes(true)
}

function git(folder: string, args: string[]): Promise<string | null> {
  return new Promise((done) => execFile('git', args, { cwd: folder, timeout: 3000, env: commandEnv(), windowsHide: true, maxBuffer: 200_000 }, (error, stdout) => done(error ? null : stdout.trim())))
}

/** The screen of a saved chat as a conversation, so it can carry on after a restart. */
export function transcriptOf(items: unknown): AssistantMessage[] {
  if (!Array.isArray(items)) return []
  const messages: AssistantMessage[] = []
  const add = (role: AssistantMessage['role'], content: string) => {
    const last = messages.at(-1)
    if (last?.role === role) last.content += `\n\n${content}`
    else messages.push({ role, content })
  }
  let steps: string[] = []
  const flush = () => {
    if (steps.length > 0) add('assistant', `(Steps I took: ${steps.join('; ')}.)`)
    steps = []
  }
  for (const item of items as { kind?: unknown; text?: unknown; summary?: unknown; ok?: unknown }[]) {
    if (item?.kind === 'tool' && typeof item.summary === 'string') steps.push(`${item.summary}${item.ok === false ? ' (failed)' : ''}`.slice(0, 300))
    else if ((item?.kind === 'task' || item?.kind === 'text') && typeof item.text === 'string') {
      flush()
      if (messages.length > 0 || item.kind === 'task') add(item.kind === 'task' ? 'user' : 'assistant', item.text)
    }
  }
  flush()
  return messages
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
  const branch = await git(folder, ['branch', '--show-current'])
  if (branch !== null) {
    const changed = await git(folder, ['status', '--short'])
    parts.push(`Git branch: ${branch || '(detached)'}\nUncommitted changes:\n${clip(changed || '(none)', 3000)}`)
  }
  for (const name of INSTRUCTION_FILES) {
    const text = await readText(join(folder, name)).catch(() => null)
    if (text?.trim()) parts.push(toolResult(`file ${name}`, text.length > INSTRUCTION_CHARS ? `${text.slice(0, INSTRUCTION_CHARS)}\n… (cut; read the file for the rest)` : text))
  }
  return parts.join('\n\n')
}

const sizeOf = (message: ChatMessage) => message.content.length + (message.toolResults ?? []).reduce((sum, result) => sum + result.output.length, 0) + (message.toolUses ?? []).reduce((sum, use) => sum + JSON.stringify(use.input ?? '').length, 0)

/** Empties the oldest tool output first, so long sessions keep fitting the model's context. */
export function trimContext(messages: ChatMessage[], max = MAX_CONTEXT_CHARS): void {
  let total = messages.reduce((sum, message) => sum + sizeOf(message), 0)
  const REMOVED = '(Older output removed to save space. Run the tool again if you need it.)'
  for (let i = 1; i < messages.length - 6 && total > max; i++) {
    const message = messages[i]!
    if (message.toolResults) {
      const before = sizeOf(message)
      if (before < 400) continue
      messages[i] = { ...message, toolResults: message.toolResults.map((result) => ({ ...result, output: result.output.length > 200 ? REMOVED : result.output })) }
      total -= before - sizeOf(messages[i]!)
      continue
    }
    if (message.role !== 'user' || !message.content.startsWith('<tool-result') || message.content.length < 400) continue
    const tool = /tool="(\w+)"/.exec(message.content)?.[1] ?? 'tool'
    const short = toolResult(tool, REMOVED)
    total -= message.content.length - short.length
    messages[i] = { role: 'user', content: short }
  }
}
