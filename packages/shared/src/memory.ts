/** Notes the person writes for the assistant. The model never adds to these itself. */
export interface MemoryNote {
  id: string
  text: string
  createdAt: number
}

export const MAX_MEMORY_NOTES = 100
export const MAX_MEMORY_CHARS = 500

/** What's added to the system prompt. Empty when there's nothing to say. */
export function memoryPrompt(notes: Pick<MemoryNote, 'text'>[]): string {
  if (notes.length === 0) return ''
  return `\n\nThe person asked you to remember these notes. Use them when they're relevant, and don't mention them otherwise:\n${notes.map((note) => `- ${note.text.replace(/\s+/g, ' ')}`).join('\n')}`
}

/** The text of "/remember something", or null for any other message. */
export function rememberCommand(text: string): string | null {
  const match = /^\/remember\s+([\s\S]+)$/i.exec(text.trim())
  return match ? match[1]!.trim() : null
}
