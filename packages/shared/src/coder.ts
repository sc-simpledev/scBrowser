/** Agentic coding (beta): the assistant works on files in a folder the person picks, on sc://code. */

/** `ask` asks before every change and command; `edits` changes files without asking, and still asks before commands. */
export type CoderMode = 'ask' | 'edits'

export type CoderToolName = 'list' | 'read' | 'search' | 'write' | 'edit' | 'run'

export type CoderEvent =
  /** What the model said this step, before any tool it uses. */
  | { sessionId: string; type: 'text'; text: string }
  | { sessionId: string; type: 'tool'; id: string; tool: CoderToolName; summary: string }
  | { sessionId: string; type: 'tool-result'; id: string; ok: boolean; output: string }
  /** A change or command waiting for the person. `detail` is a diff or the command itself. */
  | { sessionId: string; type: 'approval'; id: string; kind: 'change' | 'command'; summary: string; detail: string }
  | { sessionId: string; type: 'thinking'; step: number }
  | { sessionId: string; type: 'done'; reason: 'finished' | 'stopped' | 'step-limit' }
  | { sessionId: string; type: 'error'; message: string }

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
