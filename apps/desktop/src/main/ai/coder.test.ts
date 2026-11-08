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

describe('Coder 0.4.7', () => {
  it('runs several tools from one reply, and skips the rest after a decline', async () => {
    const reply = `Two at once.\n\`\`\`tool\n${JSON.stringify({ tool: 'read', path: 'a.txt' })}\n\`\`\`\n\`\`\`tool\n${JSON.stringify({ tool: 'write', path: 'b.txt', content: 'x' })}\n\`\`\`\n\`\`\`tool\n${JSON.stringify({ tool: 'write', path: 'c.txt', content: 'y' })}\n\`\`\``
    const { coder, seen } = scripted([reply, 'Done.'])
    await coder.run('s', root, 'x', 'ask', (event) => {
      if (event.type === 'approval') coder.answer(event.id, 'deny')
    })
    const results = seen[1]!.at(-1)!
    expect(results).toContain('1  hello')
    expect(results).toContain('declined')
    expect(results).toContain('Skipped')
  })

  it('changes nothing in plan mode', async () => {
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'gone' }), 'Plan: 1. change a.txt'])
    const kinds: string[] = []
    await coder.run('s', root, 'plan it', 'plan', (event) => kinds.push(event.type))
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hello\n')
    expect(kinds).not.toContain('approval')
    expect(seen[1]!.at(-1)).toContain('Plan mode')
  })

  it('lists its changes and undoes them all', async () => {
    const { coder } = scripted([tool({ tool: 'edit', path: 'a.txt', find: 'hello', replace: 'bye' }), tool({ tool: 'write', path: 'new.txt', content: 'n' }), 'Done.'])
    const events: CoderEvent[] = []
    await coder.run('s', root, 'x', 'edits', (event) => events.push(event))
    const last = events.filter((event) => event.type === 'changes').at(-1)
    expect(last).toMatchObject({ files: [{ path: 'a.txt', status: 'modified', added: 1, removed: 1 }, { path: 'new.txt', status: 'created' }] })
    expect(await coder.diff('s', 'a.txt')).toContain('+ bye')
    expect(await coder.undo('s')).toBe(2)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hello\n')
    await expect(readFile(join(root, 'new.txt'), 'utf8')).rejects.toThrow()
    expect(await coder.changes('s')).toEqual([])
  })

  it('starts with the file list and the project instructions', async () => {
    await writeFile(join(root, 'AGENTS.md'), 'Use tabs.')
    const { coder, seen } = scripted(['Done.'])
    await coder.run('s', root, 'x', 'ask', () => undefined)
    expect(seen[0]![0]).toContain('a.txt')
    expect(seen[0]![0]).toContain('Use tabs.')
  })
})
