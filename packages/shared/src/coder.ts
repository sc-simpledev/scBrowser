/** Terra Code, agentic coding (beta): the assistant works on files in a folder the person picks, on sc://code and in sc://assistant. */

/**
 * `plan` only looks and plans; `ask` asks before every change and command; `edits` changes files
 * without asking, and still asks before commands.
 */
export type CoderMode = 'plan' | 'ask' | 'edits'

export type CoderToolName = 'list' | 'glob' | 'read' | 'search' | 'write' | 'edit' | 'delete' | 'move' | 'run' | 'todo' | 'web'

export interface CoderTodo {
  text: string
  done: boolean
}

/** A file changed in this session, compared with how it was before the session first touched it. */
export interface CoderChange {
  path: string
  status: 'created' | 'modified' | 'deleted'
  added: number
  removed: number
}

export type CoderEvent =
  /** What the model said this step, before any tool it uses. */
  | { sessionId: string; type: 'text'; text: string }
  /** The words of a reply still arriving, so far. Replaced by `text` once it's complete. */
  | { sessionId: string; type: 'stream'; text: string }
  | { sessionId: string; type: 'tool'; id: string; tool: CoderToolName; summary: string }
  | { sessionId: string; type: 'tool-result'; id: string; ok: boolean; output: string }
  /** A change or command waiting for the person. `detail` is a diff or the command itself. */
  | { sessionId: string; type: 'approval'; id: string; kind: 'change' | 'command'; summary: string; detail: string }
  | { sessionId: string; type: 'thinking'; step: number }
  /** The model's plan, as a checklist. */
  | { sessionId: string; type: 'todo'; items: CoderTodo[] }
  /** Every file this session has changed so far. */
  | { sessionId: string; type: 'changes'; files: CoderChange[] }
  | { sessionId: string; type: 'done'; reason: 'finished' | 'stopped' | 'step-limit' }
  | { sessionId: string; type: 'error'; message: string; network?: boolean }

export interface CoderStatus {
  folder: string | null
  ready: boolean
  model: string | null
  providerName: string | null
  /** The free hosted model, which has tight limits: coding is better with a key of one's own. */
  hosted: boolean
  running: boolean
}

export type CoderAnswer = 'allow' | 'always' | 'deny'

export const CODER_MAX_TASK_CHARS = 20_000
export const CODER_MAX_STEPS = 80
