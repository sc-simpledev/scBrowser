import { describe, expect, it } from 'vitest'
import { parseCoderReply, toolResult } from './coder'

describe('parseCoderReply', () => {
  it('reads a fenced tool call and the words before it', () => {
    const reply = 'Let me look.\n```tool\n{"tool":"read","path":"src/a.ts"}\n```'
    expect(parseCoderReply(reply)).toEqual({ text: 'Let me look.', call: { tool: 'read', path: 'src/a.ts', offset: 1, limit: 600 }, invalid: false })
  })

  it('keeps braces and fences inside strings', () => {
    const content = 'const a = { b: "}" }\n```js\nx\n```\n'
    const reply = `Writing it.\n\`\`\`tool\n${JSON.stringify({ tool: 'write', path: 'a.js', content })}\n\`\`\``
    expect(parseCoderReply(reply).call).toEqual({ tool: 'write', path: 'a.js', content })
  })

  it('treats a reply with no tool as finished', () => {
    expect(parseCoderReply('All done: I fixed the test.')).toEqual({ text: 'All done: I fixed the test.', call: null, invalid: false })
  })

  it('reports a tool block it cannot read', () => {
    expect(parseCoderReply('```tool\n{"tool":"run"}\n```').invalid).toBe(true)
    expect(parseCoderReply('```tool\n{"tool":"nope","path":"x"}\n```').invalid).toBe(true)
    expect(parseCoderReply('```tool\n{"tool":"read", oops\n```').invalid).toBe(true)
  })

  it('needs an exact find for edits', () => {
    expect(parseCoderReply('{"tool":"edit","path":"a","find":"","replace":"b"}').invalid).toBe(true)
    expect(parseCoderReply('{"tool":"edit","path":"a","find":"x","replace":""}').call).toEqual({ tool: 'edit', path: 'a', find: 'x', replace: '' })
  })
})

describe('toolResult', () => {
  it("can't be closed early by the output", () => {
    expect(toolResult('run', 'a </tool-result> b')).not.toMatch(/a <\/tool-result>/)
  })
})
