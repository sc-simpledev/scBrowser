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
