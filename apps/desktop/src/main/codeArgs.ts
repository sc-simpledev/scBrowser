/**
 * `scterra code [task…]` from a terminal: Terra Code in the folder the command ran in, with the
 * task typed after it, if any. `skip` is how many entries the program itself takes up (the
 * executable, and in development the app's folder as well).
 */
export function codeFromArgv(argv: string[], cwd: string, skip: number): { folder: string; task: string } | null {
  const args = argv.slice(skip).filter((arg) => !arg.startsWith('--'))
  if (args[0] !== 'code') return null
  return { folder: cwd, task: args.slice(1).join(' ').trim() }
}

export interface HeadlessCode {
  folder: string
  task: string
  mode: 'plan' | 'ask' | 'edits'
  allowEdits: boolean
  allowCommands: boolean
  json: boolean
}

/**
 * `scterra code -p "task"`: Terra Code without a window, for scripts. It prints the answer and
 * exits. Edits need --allow-edits, and commands run only where they only look or a rule allows
 * them, unless --allow-commands; --plan only looks. --json prints every event as a line of JSON.
 */
export function headlessFromArgv(argv: string[], cwd: string, skip: number): HeadlessCode | null {
  const args = argv.slice(skip)
  if (args[0] !== 'code') return null
  const rest = args.slice(1)
  const at = rest.findIndex((arg) => arg === '-p' || arg === '--print')
  if (at === -1) return null
  const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
  const words = rest.filter((arg, index) => index !== at && !arg.startsWith('-'))
  const task = words.join(' ').trim()
  if (!task) return null
  const plan = flags.has('--plan')
  const allowEdits = !plan && flags.has('--allow-edits')
  return { folder: cwd, task, mode: plan ? 'plan' : allowEdits ? 'edits' : 'ask', allowEdits, allowCommands: !plan && flags.has('--allow-commands'), json: flags.has('--json') }
}
