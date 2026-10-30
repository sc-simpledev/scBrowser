/** Yields the `data:` payload of each server-sent event in a byte stream. */
export async function* readServerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  let data: string[] = []

  const takeLine = (line: string): string | null => {
    if (line === '') {
      const event = data.length > 0 ? data.join('\n') : null
      data = []
      return event
    }
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    return null
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r\n|\n|\r/)
      // The last piece may be half a line, unless the stream has ended.
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of done ? [...lines, ''] : lines) {
        const event = takeLine(line)
        if (event !== null) yield event
      }
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}
