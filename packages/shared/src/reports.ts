/** A crash, with nothing from pages: no addresses, titles or messages, only where it happened. */
export interface CrashEntry {
  at: number
  kind: 'browser' | 'page' | 'gpu' | 'utility' | 'exception'
  reason: string
  /** Function names and file names only. */
  stack?: string
}

export interface ReportEnvironment {
  version: string
  electron: string
  platform: string
  arch: string
}

/** Removes the message and folder paths from a stack, as either could hold personal details. */
export function scrubStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined
  const frames = stack
    .split('\n')
    .filter((line) => /^\s*at /.test(line))
    .slice(0, 8)
    .map((line) => line.trim().replace(/(?:file:\/\/)?(?:[A-Za-z]:)?[\\/][^\s()]*[\\/]/g, ''))
  return frames.join('\n') || undefined
}
