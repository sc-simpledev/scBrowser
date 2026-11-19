/** Terra Code, agentic coding (beta): the assistant works on files in a folder the person picks, in sc://assistant. */

/** Terra Code's chats share the assistant's list, and are told apart by this start to their id. */
export const CODE_CHAT_PREFIX = 'code-'
export const isCodeChat = (id: string) => id.startsWith(CODE_CHAT_PREFIX)

/**
 * `plan` only looks and plans; `ask` asks before every change and command; `edits` changes files
 * without asking, and still asks before commands. `review` is plan mode with a reviewer's brief.
 */
export type CoderMode = 'plan' | 'ask' | 'edits'
export type CoderRunMode = CoderMode | 'review'

export type CoderToolName =
  | 'list'
  | 'glob'
  | 'read'
  | 'search'
  | 'write'
  | 'edit'
  | 'patch'
  | 'delete'
  | 'move'
  | 'run'
  | 'output'
  | 'kill'
  | 'todo'
  | 'web'
  | 'fetch'
  | 'explore'
  | 'agent'
  | 'skill'
  | 'diagnostics'
  | 'preview'
  | 'tabs'
  | 'mcp'
  | 'hook'

export interface CoderTodo {
  text: string
  done: boolean
  /** The step it's on now. At most one is. */
  active?: boolean
}

/** A helper Terra Code sent off with a task of its own: the built-in explorer, the general agent, or one of the project's. */
export interface CoderAgentRun {
  /** The id of the tool step that started it. */
  id: string
  name: string
  task: string
  state: 'running' | 'done' | 'failed'
  /** Tools it has used so far. */
  steps: number
  /** What it did last, in a few words. */
  last: string | null
  /** What it reported back, once done. */
  report: string | null
  startedAt: number
  endedAt: number | null
}

/** A file changed in this session, compared with how it was before the session first touched it. */
export interface CoderChange {
  path: string
  status: 'created' | 'modified' | 'deleted'
  added: number
  removed: number
}

/** One separate change within a file, as `lineDiff`-style rows: two spaces, or "- ", or "+ ", before each line. */
export interface CoderHunk {
  /** Names this exact change, so a decision can't land on a different one if the file has moved on. */
  id: string
  line: number
  rows: string[]
}

export interface CoderReview {
  path: string
  status: CoderChange['status']
  /** Whole-file decisions only: the file was created or deleted, or isn't text. */
  whole: boolean
  binary: boolean
  hunks: CoderHunk[]
}

export type CoderDecision = 'accept' | 'reject'

/** A command started to keep running, such as a dev server, which the model reads from later. */
export interface CoderJob {
  id: number
  command: string
  running: boolean
  exitCode: number | null
  /** The last few lines it printed. */
  tail: string
}

/** What an approval is about: a file change, a shell command, or another tool (MCP, the preview tab, tabs). */
export type CoderApprovalKind = 'change' | 'command' | 'tool'

export type CoderEvent =
  /** What the model said this step, before any tool it uses. */
  | { sessionId: string; type: 'text'; text: string }
  /** The words of a reply still arriving, so far. Replaced by `text` once it's complete. */
  | { sessionId: string; type: 'stream'; text: string }
  /** `agent` names the helper run (`CoderAgentRun.id`) that took this step, when it wasn't the main agent. */
  | { sessionId: string; type: 'tool'; id: string; tool: CoderToolName; summary: string; agent?: string }
  /** The model's reasoning for this step so far. `final` once the reply is complete. */
  | { sessionId: string; type: 'reasoning'; text: string; final?: boolean }
  /** A helper's progress, sent as it starts, after each of its steps, and when it reports. */
  | { sessionId: string; type: 'agent'; run: CoderAgentRun }
  /** More of what a running command prints, to add to what's shown. */
  | { sessionId: string; type: 'output'; id: string; text: string }
  | { sessionId: string; type: 'tool-result'; id: string; ok: boolean; output: string }
  /**
   * A step waiting for the person. `detail` is a diff, the command itself, or the tool's input.
   * `rule` is what "Always allow" would save for this project, such as `npm test*`; `always` is the
   * button's words where there's no rule, such as allowing a tool for the rest of the session.
   */
  | { sessionId: string; type: 'approval'; id: string; kind: CoderApprovalKind; summary: string; detail: string; rule?: string; always?: string }
  | { sessionId: string; type: 'thinking'; step: number }
  /** The model couldn't be reached or was busy, and it's trying again shortly. */
  | { sessionId: string; type: 'retrying'; seconds: number }
  /** The model's plan, as a checklist. */
  | { sessionId: string; type: 'todo'; items: CoderTodo[] }
  /** Every file this session has changed so far. */
  | { sessionId: string; type: 'changes'; files: CoderChange[] }
  /** Commands left running in the background. */
  | { sessionId: string; type: 'jobs'; jobs: CoderJob[] }
  /** How full the model's memory is, in estimated tokens, and what this session has used in all. */
  | { sessionId: string; type: 'context'; used: number; limit: number; inputTokens: number; outputTokens: number }
  /** Earlier steps were summarised to make room. */
  | { sessionId: string; type: 'compacted'; before: number; after: number }
  /** A short note for the conversation, such as a hook's output or a skipped step. */
  | { sessionId: string; type: 'note'; text: string }
  | { sessionId: string; type: 'done'; reason: 'finished' | 'stopped' | 'step-limit' }
  | { sessionId: string; type: 'error'; message: string; network?: boolean }

/** A model to use for one session, from a provider that's set up. */
export interface CoderModelChoice {
  providerId: string
  providerName: string
  model: string
}

/** How hard the model thinks, where it can be told. */
export type CoderEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const CODER_EFFORTS: { id: CoderEffort; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'Quick answers and small edits' },
  { id: 'medium', label: 'Medium', hint: 'A balance of speed and care' },
  { id: 'high', label: 'High', hint: 'Thinks harder on tricky changes' },
  { id: 'xhigh', label: 'Extra high', hint: 'Deep work on hard problems. Slower, uses more' },
  { id: 'max', label: 'Max', hint: 'As much thought as it takes. Slowest' }
]

export const isCoderEffort = (value: unknown): value is CoderEffort => CODER_EFFORTS.some((effort) => effort.id === value)

/** A separate git worktree a session works in, so sessions running at once don't trip over each other. */
export interface CoderWorktree {
  path: string
  branch: string
  /** The branch it was made from, to merge back into. */
  base: string
}

export interface CoderStatus {
  folder: string | null
  ready: boolean
  model: string | null
  providerName: string | null
  /** The free hosted model, which has tight limits: coding is better with a key of one's own. */
  hosted: boolean
  running: boolean
  /** Whether the folder is a git repository, for commits and separate copies. */
  git: boolean
  /** The branch checked out, when it's a git repository. */
  branch?: string | null
  /** Linux with bubblewrap installed, so commands can be fenced in. */
  sandboxAvailable: boolean
}

export type CoderAnswer = 'allow' | 'always' | 'deny'

/** Sent with a task: which turn it starts, and what the person attached. */
export interface CoderRunOptions {
  /** Names this turn, so the conversation and files can be put back to just before it. */
  turnId?: string
  /** Pictures pasted or dropped in, as data addresses. */
  images?: string[]
  /** Files and tabs picked with @. */
  mentions?: CoderMention[]
  /** A model for this session instead of the assistant's. */
  model?: { providerId: string; model: string } | null
  effort?: CoderEffort | null
  /** For this run only, such as a review that mustn't change anything. */
  mode?: CoderRunMode
}

export type CoderMention = { kind: 'file'; path: string } | { kind: 'tab'; tabId: number }

/** Where an extension came from: this project's folder, or the person's own for every project. */
export type CoderSource = 'project' | 'global'

/** A slash command, agent or skill found in `.terra/` (or `.claude/`) or the person's own folder. */
export interface CoderExtension {
  name: string
  description: string
  source: CoderSource
}

export type McpServerConfig =
  | { name: string; type: 'stdio'; command: string; args: string[]; env: Record<string, string>; enabled: boolean }
  | { name: string; type: 'http'; url: string; headers: Record<string, string>; enabled: boolean }

/** An MCP server as the page sees it: no secret values, only the names of its variables and headers. */
export interface McpServerView {
  name: string
  type: 'stdio' | 'http'
  /** The command line, or the address. */
  target: string
  envKeys: string[]
  source: CoderSource
  enabled: boolean
  /** A project's server runs only once the person allows it, and again if it changes. */
  trusted: boolean
  state: 'off' | 'starting' | 'ready' | 'error'
  error: string | null
  tools: string[]
}

/** Hooks a project or the person set: commands run around Terra Code's steps. */
export interface CoderHooksView {
  source: CoderSource
  trusted: boolean
  hooks: { event: CoderHookEvent; command: string }[]
}

export type CoderHookEvent = 'afterEdit' | 'beforeCommand' | 'afterTurn'

/** Everything the settings panel shows for the open folder. */
export interface CoderSetup {
  folder: string | null
  /** The person's own Terra Code folder, for commands, agents, skills and hooks in every project. */
  home: string
  rules: { allow: string[]; deny: string[] }
  /** Deny rules the project itself sets, in `.terra/settings.json`. */
  projectDeny: string[]
  commands: CoderExtension[]
  agents: CoderExtension[]
  skills: CoderExtension[]
  mcp: McpServerView[]
  hooks: CoderHooksView[]
  /** The command `diagnostics` runs, found or set in `.terra/settings.json`. */
  diagnostics: string | null
}

export const CODER_MAX_TASK_CHARS = 20_000
export const CODER_MAX_STEPS = 150
export const CODER_MAX_IMAGES = 4
/** A data address for a picture, about 6 MB of image once decoded. */
export const CODER_MAX_IMAGE_CHARS = 8_000_000
export const CODER_MAX_MENTIONS = 8

/** What /init asks for. */
export const CODER_INIT_TASK = `Look around this project and write TERRA.md at its root: the notes you'd want before working here. Keep it short and specific to this project:
- what it is, and the main parts and where they live
- how to install, run, build, test, type check and lint (the exact commands)
- the conventions to follow (style, patterns, libraries), and anything surprising
If TERRA.md (or AGENTS.md or CLAUDE.md) already exists, improve it rather than starting over. Read the build files and a few key sources first.`

/** What /review asks for: the uncommitted changes, or a branch against another. */
export const reviewTask = (base: string | null) => `Review ${base ? `the changes on this branch compared with ${base} (git diff ${base}...HEAD, plus anything uncommitted)` : 'the uncommitted changes (git diff, and git diff --staged)'} as a careful senior reviewer. Don't change anything.

Read the changed code and enough around it to judge it. Report what's wrong, most serious first, each as:
- **file:line** what's wrong, why it matters, and how to fix it
Look for bugs, missed cases, broken error handling, security problems, races, and tests that don't test what they claim. Leave out style nitpicks. If it all looks right, say so briefly.`

/** Built-in slash commands, handled by the page or turned into a task. */
export const CODER_BUILTIN_COMMANDS: { name: string; description: string; args?: string }[] = [
  { name: 'init', description: 'Look around and write TERRA.md, the project’s notes for Terra Code' },
  { name: 'review', description: 'Review uncommitted changes, or a branch, without changing anything', args: '[branch]' },
  { name: 'compact', description: 'Summarise the conversation so far, to make room' },
  { name: 'undo', description: 'Put files and the conversation back to before the last message' },
  { name: 'remember', description: 'Add a line to TERRA.md', args: '<note>' },
  { name: 'model', description: 'Choose the model for this session' },
  { name: 'clear', description: 'Start a new session' },
  { name: 'fork', description: 'Carry on in a copy of this session' },
  { name: 'export', description: 'Save this session as Markdown' },
  { name: 'effort', description: 'How hard the model thinks: low, medium, high, xhigh or max', args: '[level]' },
  { name: 'agents', description: 'Show the helpers this session sent off' },
  { name: 'stats', description: 'Show the session panel: context, usage and activity' },
  { name: 'settings', description: 'Permissions, MCP servers, agents, skills and hooks' },
  { name: 'help', description: 'What Terra Code can do' }
]

const OPERATORS = /[;&|<>`\n\r]|\$\(|\$\{/

/** Commands that only look, which never need asking about. Anything with an operator or redirect is out. */
const SAFE_COMMANDS: RegExp[] = [
  /^(ls|pwd|tree|wc|head|tail|cat|file|stat|du|df|which|whoami|date|uname|printenv)(\s|$)/,
  /^git (status|diff|log|show|branch|remote -v|rev-parse|blame|ls-files|describe|shortlog)(\s|$)/,
  /^(grep|egrep|fgrep)\s/,
  /^(node|npm|pnpm|yarn|bun|deno|python3?|pip3?|cargo|rustc|go|java|ruby|php|dotnet|gcc|clang|make|tsc)\s+(-v|--version|version)$/,
  /^(npm|pnpm|yarn) (ls|list|outdated|why)(\s|$)/
]

/** Arguments that turn a looking command into one that writes or runs something. */
const UNSAFE_ARGUMENTS = /(^|\s)(--output|-o\b|--exec|--ext-diff|--textconv|-f\s|--files-from)/

/** Whether a command only reads, so it can run without asking (and in plan mode). */
export function isSafeCommand(command: string): boolean {
  const text = command.trim()
  if (!text || OPERATORS.test(text) || UNSAFE_ARGUMENTS.test(text)) return false
  return SAFE_COMMANDS.some((pattern) => pattern.test(text))
}

/**
 * Whether a saved rule covers a command. A rule is the exact command, or a start followed by `*`
 * (`npm test*`). A rule with a `*` never covers a command with an operator in it, so allowing
 * `npm test*` can't let `npm test; rm -rf ~` through.
 */
export function ruleCovers(rule: string, command: string): boolean {
  const pattern = rule.trim()
  const text = command.trim()
  if (!pattern) return false
  if (!pattern.endsWith('*')) return pattern === text
  if (OPERATORS.test(text)) return false
  const start = pattern.slice(0, -1)
  // `npm test *` wants a word break after `npm test`; `npm test*` takes anything that starts that way.
  if (start.endsWith(' ')) return text === start.trimEnd() || text.startsWith(start)
  return text.startsWith(start)
}

const SUBCOMMAND_TOOLS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx', 'cargo', 'go', 'git', 'make', 'deno', 'dotnet', 'mvn', 'gradle', './gradlew', 'uv', 'poetry', 'pip', 'pip3', 'docker', 'kubectl', 'just'])

/** What "Always allow" saves for a command: the program and, for tools with subcommands, the subcommand. */
export function suggestRule(command: string): string {
  const text = command.trim()
  if (OPERATORS.test(text)) return text
  const words = text.split(/\s+/)
  const [program, second, third] = words
  if (!program) return text
  if ((program === 'python' || program === 'python3') && second === '-m' && third) return `${program} -m ${third}*`
  if (SUBCOMMAND_TOOLS.has(program) && second && !second.startsWith('-')) {
    // `npm run test` and `pnpm run build` keep the script's name.
    if ((second === 'run' || second === 'exec') && third) return `${program} ${second} ${third}*`
    return `${program} ${second}*`
  }
  return words.length === 1 ? text : `${program}*`
}

/** MCP tools go by `mcp__server__tool`, as other agents name them. */
export const mcpToolName = (server: string, tool: string) => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__${tool.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64)

export const isMcpServerName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name)
