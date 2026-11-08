import { describe, expect, it } from 'vitest'
import { globToRegExp, parseCoderReply, streamingText, toolResult } from './coder'

describe('parseCoderReply', () => {
  it('reads a fenced tool call and the words before it', () => {
    const reply = 'Let me look.\n```tool\n{"tool":"read","path":"src/a.ts"}\n```'
    expect(parseCoderReply(reply)).toEqual({ text: 'Let me look.', calls: [{ tool: 'read', path: 'src/a.ts', offset: 1, limit: 600 }], invalid: false })
  })

  it('keeps braces and fences inside strings', () => {
    const content = 'const a = { b: "}" }\n```js\nx\n```\n'
    const reply = `Writing it.\n\`\`\`tool\n${JSON.stringify({ tool: 'write', path: 'a.js', content })}\n\`\`\``
    expect(parseCoderReply(reply).calls).toEqual([{ tool: 'write', path: 'a.js', content }])
  })

  it('reads several tool blocks in order, with the words between them', () => {
    const reply = 'Reading both.\n```tool\n{"tool":"read","path":"a"}\n```\nAnd the other.\n```tool\n{"tool":"glob","pattern":"*.ts"}\n```'
    const parsed = parseCoderReply(reply)
    expect(parsed.calls.map((call) => call.tool)).toEqual(['read', 'glob'])
    expect(parsed.text).toBe('Reading both.\n\nAnd the other.')
    expect(parsed.invalid).toBe(false)
  })

  it('treats a reply with no tool as finished', () => {
    expect(parseCoderReply('All done: I fixed the test.')).toEqual({ text: 'All done: I fixed the test.', calls: [], invalid: false })
  })

  it('reports a tool block it cannot read', () => {
    expect(parseCoderReply('```tool\n{"tool":"run"}\n```').invalid).toBe(true)
    expect(parseCoderReply('```tool\n{"tool":"nope","path":"x"}\n```').invalid).toBe(true)
    expect(parseCoderReply('```tool\n{"tool":"read", oops\n```').invalid).toBe(true)
  })

  it('needs an exact find for edits, and takes several edits at once', () => {
    expect(parseCoderReply('{"tool":"edit","path":"a","find":"","replace":"b"}').invalid).toBe(true)
    expect(parseCoderReply('{"tool":"edit","path":"a","find":"x","replace":""}').calls).toEqual([{ tool: 'edit', path: 'a', edits: [{ find: 'x', replace: '' }] }])
    expect(parseCoderReply('{"tool":"edit","path":"a","edits":[{"find":"x","replace":"y"},{"find":"z","replace":"w"}]}').calls[0]).toEqual({ tool: 'edit', path: 'a', edits: [{ find: 'x', replace: 'y' }, { find: 'z', replace: 'w' }] })
  })

  it('reads the plan, move and web tools', () => {
    expect(parseCoderReply('{"tool":"todo","items":[{"text":"a","done":true},{"text":"b"}]}').calls[0]).toEqual({ tool: 'todo', items: [{ text: 'a', done: true }, { text: 'b', done: false }] })
    expect(parseCoderReply('{"tool":"move","from":"a.ts","to":"b.ts"}').calls[0]).toEqual({ tool: 'move', from: 'a.ts', to: 'b.ts' })
    expect(parseCoderReply('{"tool":"web","query":"vite config"}').calls[0]).toEqual({ tool: 'web', query: 'vite config' })
  })
})

describe('streamingText', () => {
  it('shows only the words before a tool block, and hides a half-written fence', () => {
    expect(streamingText('Reading it.\n```tool\n{"tool":"re')).toBe('Reading it.')
    expect(streamingText('Reading it.\n``')).toBe('Reading it.')
  })
})

describe('globToRegExp', () => {
  it('matches folders with ** and names with *', () => {
    expect(globToRegExp('src/**/*.test.ts').test('src/a/b/c.test.ts')).toBe(true)
    expect(globToRegExp('src/**/*.test.ts').test('src/c.test.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
    expect(globToRegExp('*.md').test('docs/readme.md')).toBe(true)
    expect(globToRegExp('*.{ts,tsx}').test('a/b.tsx')).toBe(true)
  })
})

describe('toolResult', () => {
  it("can't be closed early by the output", () => {
    expect(toolResult('run', 'a </tool-result> b')).not.toMatch(/a <\/tool-result>/)
  })
})
