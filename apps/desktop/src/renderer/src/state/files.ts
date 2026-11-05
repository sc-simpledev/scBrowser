import { conversationFiles, type FileVersion } from '@scbrowser/shared'

/** A reply that writes or changes a file opens it, like a new draft of a report does. */
export function newestFile(turns: { role: string; content: string }[]): { file: FileVersion; report: null } | Record<string, never> {
  const made = conversationFiles(turns).changes.get(turns.length - 1)
  const file = made?.findLast((change) => change.version)?.version
  return file ? { file, report: null } : {}
}
