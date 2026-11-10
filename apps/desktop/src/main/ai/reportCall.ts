/**
 * Turns a report written as a tool call back into the fenced block the conversation keeps, piece
 * by piece as its arguments arrive, so it fills in on screen like one written as text.
 */
export function reportCallText(): { delta(index: number, text: string): string; whole(input: unknown): string; end(): string } {
  let open: number | null = null
  let streamed = false
  const close = () => {
    const text = open === null ? '' : '\n```'
    open = null
    return text
  }
  return {
    delta(index, text) {
      streamed = true
      if (open === index) return text
      const before = close()
      open = index
      return `${before}\n\n\`\`\`scterra-report\n${text}`
    },
    // Providers that don't send the arguments in pieces give the whole call at the end.
    whole: (input) => (streamed || typeof input !== 'object' || input === null ? '' : `\n\n\`\`\`scterra-report\n${JSON.stringify(input)}\n\`\`\``),
    end: close
  }
}
