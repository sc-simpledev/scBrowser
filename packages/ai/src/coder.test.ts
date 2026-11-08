import { describe, expect, it } from 'vitest'
import { CODER_NUDGE, globToRegExp, isDoneMarker, parseCoderReply, promisesAction, streamingText, toolResult } from './coder'

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

describe('parseCoderReply with what models really send', () => {
  const run = { tool: 'run', command: 'npm test' }
  const read = { tool: 'read', path: 'a.ts', offset: 1, limit: 600 }

  it('runs every block in json fences, leaving none in the chat', () => {
    const reply = 'Reading.\n```json\n{"tool":"read","path":"a.ts"}\n```\nThen testing.\n```json\n{"tool":"run","command":"npm test"}\n```'
    expect(parseCoderReply(reply)).toEqual({ text: 'Reading.\n\nThen testing.', calls: [read, run], invalid: false })
  })

  it('runs blocks in an unmarked fence, and several bare objects', () => {
    expect(parseCoderReply('```\n{"tool":"run","command":"npm test"}\n```').calls).toEqual([run])
    expect(parseCoderReply('{"tool":"read","path":"a.ts"}\n{"tool":"run","command":"npm test"}')).toEqual({ text: '', calls: [read, run], invalid: false })
  })

  it('runs a JSON array of tools', () => {
    expect(parseCoderReply('```json\n[{"tool":"read","path":"a.ts"},\n{"tool":"run","command":"npm test"}]\n```')).toEqual({ text: '', calls: [read, run], invalid: false })
  })

  it('takes the tool key in any position', () => {
    expect(parseCoderReply('{"command":"npm test","tool":"run"}').calls).toEqual([run])
  })

  it('understands other agents\' tool names and fields', () => {
    expect(parseCoderReply('{"tool":"bash","cmd":"npm test"}').calls).toEqual([run])
    expect(parseCoderReply('{"tool":"read_file","file_path":"a.ts"}').calls).toEqual([read])
    expect(parseCoderReply('{"tool":"str_replace","path":"a","old_string":"x","new_string":"y"}').calls).toEqual([{ tool: 'edit', path: 'a', edits: [{ find: 'x', replace: 'y' }] }])
    expect(parseCoderReply('{"tool":"shell","command":["npm","test"]}').calls).toEqual([run])
    expect(parseCoderReply('{"tool":"todo_write","todos":[{"content":"a","status":"completed"}]}').calls).toEqual([{ tool: 'todo', items: [{ text: 'a', done: true }] }])
  })

  it('understands function-call shapes and XML', () => {
    expect(parseCoderReply('{"name":"bash","arguments":{"command":"npm test"}}').calls).toEqual([run])
    expect(parseCoderReply('{"type":"function","function":{"name":"bash","arguments":"{\\"command\\":\\"npm test\\"}"}}').calls).toEqual([run])
    expect(parseCoderReply('<tool_call>{"tool":"run","command":"npm test"}</tool_call>')).toEqual({ text: '', calls: [run], invalid: false })
    expect(parseCoderReply('Testing.\n<invoke name="Bash"><parameter name="command">npm test</parameter></invoke>')).toEqual({ text: 'Testing.', calls: [run], invalid: false })
  })

  it('mends raw newlines, stray backslashes and trailing commas', () => {
    expect(parseCoderReply('```tool\n{"tool":"write","path":"a","content":"one\ntwo",}\n```').calls).toEqual([{ tool: 'write', path: 'a', content: 'one\ntwo' }])
    expect(parseCoderReply('{"tool":"search","pattern":"\\d+"}').calls[0]).toMatchObject({ pattern: '\\d+' })
  })

  it('keeps a file holding tool blocks in one piece', () => {
    const content = 'Use ```tool\n{"tool":"run","command":"rm x"}\n``` here'
    const reply = `\`\`\`tool\n${JSON.stringify({ tool: 'write', path: 'd.md', content })}\n\`\`\``
    expect(parseCoderReply(reply)).toEqual({ text: '', calls: [{ tool: 'write', path: 'd.md', content }], invalid: false })
  })

  it('reports a block cut off part way', () => {
    expect(parseCoderReply('Writing.\n```tool\n{"tool":"write","path":"a","content":"on')).toEqual({ text: 'Writing.', calls: [], invalid: true })
  })

  it('leaves ordinary JSON and code alone', () => {
    for (const reply of ['Your package:\n```json\n{"name":"app","version":"1.0.0"}\n```', 'Try `const a = { name: "x" }` instead.', '{"name":"read"}']) {
      expect(parseCoderReply(reply)).toEqual({ text: reply, calls: [], invalid: false })
    }
  })
})

describe('promisesAction', () => {
  it('spots replies that stop short of doing the work', () => {
    for (const text of ['', 'Let me run the tests.', "Now I'll check the file:", 'Now I will fix it.', 'Run this:\n```bash\nnpm test\n```']) expect(promisesAction(text)).toBe(true)
  })

  it('accepts real endings', () => {
    for (const text of ['I fixed the test and it passes.', 'Which of these do you want?', 'All done. Let me know if it needs anything else.']) expect(promisesAction(text)).toBe(false)
  })

  it('has a way out', () => {
    expect(CODER_NUDGE).toContain('DONE')
    expect(isDoneMarker(' done. ')).toBe(true)
    expect(isDoneMarker('Done, I fixed it.')).toBe(false)
  })
})

describe('streamingText', () => {
  it('hides json-fenced tools and XML as they arrive', () => {
    expect(streamingText('Reading.\n```json\n{"tool"')).toBe('Reading.')
    expect(streamingText('Reading.\n<tool_call>{"to')).toBe('Reading.')
  })

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
