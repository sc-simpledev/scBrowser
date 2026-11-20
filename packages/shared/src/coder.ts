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
  | 'ask'
  | 'github'
  | 'lsp'

export interface CoderTodo {
  text: string
  done: boolean
  /** The step it's on now. At most one is. */
  active?: boolean
}

/** A question the model asks the person, with choices to pick from. They can always write their own answer instead. */
export interface CoderQuestion {
  question: string
  /** A word or two for its tab, such as "Database". */
  header: string
  options: { label: string; description: string }[]
  /** More than one choice may be picked. */
  multiSelect: boolean
}

/** What the person picked for each question, in order, or their own words. Empty: they skipped it. */
export type CoderQuestionAnswer = string[]

export const CODER_MAX_QUESTIONS = 4
export const CODER_MAX_OPTIONS = 6

/** The person's answers to questions, as the model reads them. */
export function questionAnswerText(questions: CoderQuestion[], answers: CoderQuestionAnswer[] | null): string {
  if (!answers) return 'The person closed the questions without answering. Decide sensibly yourself, and say what you assumed.'
  return questions
    .map((question, index) => {
      const picked = answers[index] ?? []
      return `${question.question}\n→ ${picked.length ? picked.join('; ') : '(skipped: decide yourself, and say what you assumed)'}`
    })
    .join('\n\n')
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
  /** `undoable`: the step changed files and can be undone (and redone) on its own. */
  | { sessionId: string; type: 'tool-result'; id: string; ok: boolean; output: string; undoable?: boolean }
  /**
   * A step waiting for the person. `detail` is a diff, the command itself, or the tool's input.
   * `rule` is what "Always allow" would save for this project, such as `npm test*`; `always` is the
   * button's words where there's no rule, such as allowing a tool for the rest of the session.
   */
  | { sessionId: string; type: 'approval'; id: string; kind: CoderApprovalKind; summary: string; detail: string; rule?: string; always?: string }
  | { sessionId: string; type: 'thinking'; step: number }
  /** The model couldn't be reached or was busy, and it's trying again shortly. */
  | { sessionId: string; type: 'retrying'; seconds: number }
  /** The model's plan, as a checklist. `by: 'person'` when the person ticked, added or changed steps. */
  | { sessionId: string; type: 'todo'; items: CoderTodo[]; by?: 'person' }
  /** The model asks the person something and waits. Answered with `coder:answer-question`. */
  | { sessionId: string; type: 'question'; id: string; questions: CoderQuestion[] }
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
  /** Linux with bubblewrap installed, or a Mac, so commands can be fenced in. */
  sandboxAvailable: boolean
  /** The project has a dev container and the devcontainer CLI is installed. */
  devContainer?: boolean
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
  /** `signin`: a remote server waiting for the person to sign in to it. */
  state: 'off' | 'starting' | 'ready' | 'error' | 'signin'
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

/** What /review #12 asks for: a GitHub pull request, read and reviewed, with comments posted only on the person's yes. */
export const reviewPrTask = (number: number) => `Review pull request #${number} on GitHub as a careful senior reviewer. Read it with the github tool: GET /repos/{owner}/{repo}/pulls/${number} for what it's for, and GET /repos/{owner}/{repo}/pulls/${number}/files for the changes (the patch of each file). Read the changed files here too where you need more around them.

Report what's wrong, most serious first, each as **file:line** what's wrong, why it matters, and how to fix it. Look for bugs, missed cases, broken error handling, security problems and tests that don't test what they claim; leave out style nitpicks.

Then post your findings as one review: POST /repos/{owner}/{repo}/pulls/${number}/reviews with "event": "COMMENT", a short "body", and "comments" (each with "path", "line" on the new side, "side": "RIGHT" and "body"). It asks the person first, and if they decline, just leave the report here. Don't change any files.`

/** What /fix-ci asks for: the failing checks of a branch on GitHub, found, fixed and checked here. */
export const fixCiTask = (branch: string | null) => `The checks on GitHub are failing${branch ? ` for the branch ${branch}` : ''}. Find out why and fix it:
1. With the github tool, list the latest workflow runs${branch ? ` for this branch (GET /repos/{owner}/{repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5)` : ' (GET /repos/{owner}/{repo}/actions/runs?per_page=5)'}, then the jobs of the newest failed one (GET /repos/{owner}/{repo}/actions/runs/RUN_ID/jobs).
2. Read the failed jobs' logs (GET /repos/{owner}/{repo}/actions/jobs/JOB_ID/logs) and find the first real error.
3. Fix the cause here, then run the same check locally to confirm it passes.
Tell me what failed and why, and what you changed. If GitHub isn't connected, say so, and try the checks locally instead.`

/** Built-in slash commands, handled by the page or turned into a task. */
export const CODER_BUILTIN_COMMANDS: { name: string; description: string; args?: string }[] = [
  { name: 'init', description: 'Look around and write TERRA.md, the project’s notes for Terra Code' },
  { name: 'review', description: 'Review uncommitted changes, a branch, or a pull request (#12)', args: '[branch or #PR]' },
  { name: 'fix-ci', description: 'Read why the checks fail on GitHub, and fix it here' },
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
  { name: 'todo', description: 'Add a step to the checklist', args: '<step>' },
  { name: 'cloud', description: 'Run this task in the cloud, on GitHub Actions', args: '<task>' },
  { name: 'help', description: 'What Terra Code can do' }
]

export const CODER_MAX_TODO = 40
export const CODER_MAX_TODO_CHARS = 300

/** The person's changes to a checklist, as the model reads them. */
export function todoChangeText(items: CoderTodo[]): string {
  if (items.length === 0) return 'The person cleared your checklist. Carry on without one, or make a new one if it helps.'
  const lines = items.map((item) => `- [${item.done ? 'x' : item.active ? '~' : ' '}] ${item.text}`)
  return `The person changed your checklist. This is it now ([x] done, [~] under way). Follow it: do the steps they added, skip the ones they removed, and don't redo what they ticked off. Send it back with todo when you next update it.\n${lines.join('\n')}`
}

/** A checklist from the page, checked item by item. */
export function cleanTodo(value: unknown): CoderTodo[] | null {
  if (!Array.isArray(value) || value.length > CODER_MAX_TODO) return null
  const items: CoderTodo[] = []
  let active = false
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const { text, done, active: on } = item as Record<string, unknown>
    if (typeof text !== 'string' || typeof done !== 'boolean') return null
    const trimmed = text.trim().slice(0, CODER_MAX_TODO_CHARS)
    if (!trimmed) continue
    const isActive: boolean = on === true && !done && !active
    active ||= isActive
    items.push({ text: trimmed, done, ...(isActive ? { active: true } : {}) })
  }
  return items
}

/** How much the model may do on GitHub: nothing, look only, or look and act (asking each time). */
export type CoderGithubAccess = 'off' | 'read' | 'write'

/** Where Terra Code's GitHub sign-in comes from, as the page sees it: never the token itself. */
export interface CoderGithubStatus {
  /** `cli`: the GitHub CLI's own sign-in, read when needed and never stored. `token`: one pasted in, kept encrypted. */
  source: 'cli' | 'token' | null
  login: string | null
  /** The GitHub CLI is installed and signed in, so it can be used in one click. */
  cliReady: boolean
  /** The token's scopes, where GitHub says (classic tokens and the CLI's). */
  scopes: string[] | null
  /** The project's repository on GitHub, from its git remote. */
  repo: string | null
  error: string | null
  /** "Sign in with GitHub" is available: scTerra has an OAuth app to sign in with. */
  deviceFlow: boolean
}

/**
 * The OAuth app scTerra signs in to GitHub with, by GitHub's device flow (no secret needed). Empty
 * until the owner registers one at github.com/settings/applications/new with "Enable Device Flow"
 * ticked; "Sign in with GitHub" only shows once it's set. SCTERRA_GITHUB_CLIENT_ID overrides it.
 */
export const GITHUB_CLIENT_ID = ''

/** A repository the person can reach, for cloning. */
export interface GithubRepo {
  fullName: string
  description: string
  private: boolean
  pushedAt: string
}

/** What a newly chosen folder looks like, for the first-run card. */
export interface CoderProjectSetup {
  stack: string[]
  /** It already has notes for coding agents (TERRA.md, AGENTS.md or CLAUDE.md). */
  instructions: boolean
  /** Commands worth letting through without asking, not already allowed. */
  rules: string[]
  /** MCP_DIRECTORY ids that fit the project. */
  mcp: string[]
}

/** A run of Terra Code on GitHub Actions, which carries on with this computer off. */
export interface CoderCloudRun {
  id: string
  /** owner/name */
  repo: string
  /** The branch it started from, on GitHub. */
  base: string
  /** The branch that starts the run, holding the workflow, removed once it's done. */
  trigger: string
  /** Where its work is pushed. */
  branch: string
  task: string
  /** Open a pull request when it's done. */
  pr: boolean
  state: 'starting' | 'queued' | 'working' | 'done' | 'failed' | 'cancelled'
  runId: number | null
  runUrl: string | null
  prUrl: string | null
  /** What it said it did, once done. */
  summary: string | null
  startedAt: number
  endedAt: number | null
  error: string | null
  /** What the cloud copy doesn't have, such as commits not pushed yet. */
  warning: string | null
  /** Its latest steps while it works, read from its check run on GitHub. */
  live?: string[]
}

/** A task Terra Code runs on GitHub on a timetable. `cron` is in UTC, as GitHub reads it. */
export interface CoderSchedule {
  cron: string
  task: string
  /** Open a pull request if anything changed. */
  pr: boolean
  /** How it was picked, in words, such as "Every Monday at 9:00". */
  label: string
}

/** Terra Code installed on a GitHub repository: runs started by @terra comments, and scheduled tasks. */
export interface CoderAutomations {
  comments: boolean
  schedules: CoderSchedule[]
}

/** A timetable in the person's own time as a UTC cron line, and in words. */
export function scheduleCron(every: 'day' | 'weekday' | 'week' | 'month', hour: number, offsetMinutes: number): { cron: string; label: string } {
  // getTimezoneOffset is minutes behind UTC: Sydney is -600.
  const utc = (((hour * 60 + offsetMinutes) % 1440) + 1440) % 1440
  const shift = Math.floor((hour * 60 + offsetMinutes) / 1440)
  const minute = utc % 60
  const at = `${minute} ${Math.floor(utc / 60)}`
  const time = `${hour}:00`
  if (every === 'day') return { cron: `${at} * * *`, label: `Every day at ${time}` }
  if (every === 'weekday') {
    // Monday to Friday where the person is, which can be Sunday to Thursday or Tuesday to Saturday in UTC.
    const days = shift < 0 ? '0-4' : shift > 0 ? '2-6' : '1-5'
    return { cron: `${at} * * ${days}`, label: `Every weekday at ${time}` }
  }
  if (every === 'week') return { cron: `${at} * * ${(((1 + shift) % 7) + 7) % 7}`, label: `Every Monday at ${time}` }
  // A month's first day can't move with the time zone in cron, so it stays the 1st in UTC.
  return { cron: `${at} 1 * *`, label: shift === 0 ? `On the 1st of each month at ${time}` : `On the 1st of each month (UTC) near ${time}` }
}

export const AUTOMATIONS_WORKFLOW_PATH = '.github/workflows/terra-code.yml'
/** Where installed workflows download the runner: each scTerra release carries it. */
export const RUNNER_DOWNLOAD_URL = 'https://github.com/sc-simpledev/scTerra/releases/latest/download/terra-code-runner.mjs'

/** Model settings for a cloud run: only where it can reach, never a key (that goes to GitHub as a secret). */
export interface CoderCloudModel {
  protocol: 'anthropic' | 'openai'
  baseUrl: string
  model: string
  /** The provider needs a key, sent to the repository as the secret SCTERRA_AI_KEY. */
  needsKey: boolean
  firstParty: boolean
}

/** The workflow a cloud run starts, kept in the trigger branch only. */
export const CLOUD_WORKFLOW_PATH = '.github/workflows/scterra-cloud.yml'
export const CLOUD_FILES_DIR = '.scterra-cloud'
export const CLOUD_SECRET = 'SCTERRA_AI_KEY'
export const CLOUD_BRANCH_PREFIX = 'scterra/'
export const CLOUD_TRIGGER_PREFIX = 'scterra-cloud/'
/** Lines the runner prints for the app to read back from the job's log. */
export const CLOUD_EVENT_MARK = '[scterra-event] '

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

/** A well-known MCP server, to add in one click. `keys` are values the person fills in (tokens and the like). */
export interface McpDirectoryEntry {
  id: string
  name: string
  description: string
  config: { type: 'stdio'; command: string; args: string[] } | { type: 'http'; url: string }
  /** Environment variables (for a command) or headers (for an address) it needs, with what goes in them. */
  keys: { name: string; hint: string }[]
  /** Signs in with an account through the browser rather than a key. */
  signIn?: boolean
}

/**
 * Servers people commonly add, as their makers publish them. Commands fetch the server with npx
 * or uvx the first time it starts; addresses belong to the service named.
 */
export const MCP_DIRECTORY: McpDirectoryEntry[] = [
  { id: 'playwright', name: 'playwright', description: 'Drives a real browser: open pages, click, fill forms, take screenshots', config: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] }, keys: [] },
  { id: 'filesystem', name: 'filesystem', description: 'Reads and writes files in folders you name', config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] }, keys: [] },
  { id: 'memory', name: 'memory', description: 'A knowledge graph Terra Code can remember things in across sessions', config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }, keys: [] },
  { id: 'sequential-thinking', name: 'sequential-thinking', description: 'Step-by-step thinking for hard problems', config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] }, keys: [] },
  { id: 'fetch', name: 'fetch', description: 'Fetches web pages as Markdown (needs uv)', config: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] }, keys: [] },
  { id: 'git', name: 'git', description: 'Reads and searches git history (needs uv)', config: { type: 'stdio', command: 'uvx', args: ['mcp-server-git'] }, keys: [] },
  { id: 'github', name: 'github', description: 'Issues, pull requests, code search and Actions on GitHub', config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' }, keys: [{ name: 'Authorization', hint: 'Bearer, then a GitHub personal access token' }] },
  { id: 'context7', name: 'context7', description: 'Up-to-date documentation for libraries and frameworks', config: { type: 'http', url: 'https://mcp.context7.com/mcp' }, keys: [] },
  { id: 'linear', name: 'linear', description: 'Issues and projects in Linear', config: { type: 'http', url: 'https://mcp.linear.app/mcp' }, keys: [], signIn: true },
  { id: 'notion', name: 'notion', description: 'Pages and databases in Notion', config: { type: 'http', url: 'https://mcp.notion.com/mcp' }, keys: [], signIn: true },
  { id: 'sentry', name: 'sentry', description: 'Errors and performance issues from Sentry', config: { type: 'http', url: 'https://mcp.sentry.dev/mcp' }, keys: [], signIn: true },
  { id: 'huggingface', name: 'huggingface', description: 'Models, datasets and Spaces on Hugging Face', config: { type: 'http', url: 'https://huggingface.co/mcp' }, keys: [] }
]
