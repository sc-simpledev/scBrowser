import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CoderEvent } from '@scbrowser/shared'
import { Coder, trimContext } from './coder'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coder-run-'))
  await writeFile(join(root, 'a.txt'), 'hello\n')
})
afterEach(() => rm(root, { recursive: true, force: true }))

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``

function scripted(replies: string[]) {
  const seen: string[][] = []
  const coder = new Coder({
    chat: async (messages) => {
      seen.push(messages.map((m) => m.content))
      return replies.shift() ?? 'Done.'
    }
  })
  return { coder, seen }
}

describe('Coder', () => {
  it('reads, edits after approval, and finishes', async () => {
    const { coder, seen } = scripted([tool({ tool: 'read', path: 'a.txt' }), tool({ tool: 'edit', path: 'a.txt', find: 'hello', replace: 'goodbye' }), 'Changed it.'])
    const events: CoderEvent[] = []
    await coder.run('s', root, 'change the greeting', 'ask', (event) => {
      events.push(event)
      if (event.type === 'approval') {
        expect(event.detail).toContain('- hello')
        expect(event.detail).toContain('+ goodbye')
        coder.answer(event.id, 'allow')
      }
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('goodbye\n')
    expect(seen[1]!.at(-1)).toContain('1  hello')
    expect(events.at(-1)).toEqual({ sessionId: 's', type: 'done', reason: 'finished' })
  })

  it('leaves the file alone when a change is declined', async () => {
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'x' }), 'OK, left it.'])
    await coder.run('s', root, 'overwrite', 'ask', (event) => {
      if (event.type === 'approval') coder.answer(event.id, 'deny')
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hello\n')
    expect(seen[1]!.at(-1)).toContain('declined')
  })

  it("changes files without asking in edits mode, and won't leave the folder", async () => {
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'b.txt', content: 'new' }), tool({ tool: 'read', path: '../../etc/passwd' }), 'Done.'])
    const kinds: string[] = []
    await coder.run('s', root, 'make b', 'edits', (event) => kinds.push(event.type))
    expect(kinds).not.toContain('approval')
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('new')
    expect(seen[2]!.at(-1)).toContain('outside the project folder')
  })

  it('stops while waiting for an answer', async () => {
    const { coder } = scripted([tool({ tool: 'run', command: 'echo hi' })])
    const events: CoderEvent[] = []
    await coder.run('s', root, 'run it', 'edits', (event) => {
      events.push(event)
      if (event.type === 'approval') coder.stop('s')
    })
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stopped' })
  })

  it('tells the model when its tool block was unreadable', async () => {
    const { coder, seen } = scripted(['```tool\n{"tool":"read", broken\n```', 'Sorry, done.'])
    await coder.run('s', root, 'x', 'ask', () => undefined)
    expect(seen[1]!.at(-1)).toContain('could not be read')
  })
})

describe('trimContext', () => {
  it('empties the oldest tool output first', () => {
    const big = `<tool-result tool="read">\n${'x'.repeat(1000)}\n</tool-result>`
    const messages = [{ role: 'user' as const, content: 'task' }, ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? ('user' as const) : ('assistant' as const), content: i % 2 ? big : 'step' }))]
    trimContext(messages, 3000)
    expect(messages[2]!.content).toContain('Older output removed')
    expect(messages.at(-1)!.content).toBe(big)
  })
})
