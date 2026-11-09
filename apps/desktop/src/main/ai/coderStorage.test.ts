import { mkdtemp, readFile, realpath, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CoderEvent } from '@scbrowser/shared'
import { AiError, type ChatMessage, type ToolSpec } from '@scbrowser/ai'
import { Coder } from './coder'
import { asText, CoderCheckpoints, CoderSnapshots } from './coderStorage'

let root = ''
let home = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coder-project-'))
  home = await mkdtemp(join(tmpdir(), 'coder-home-'))
  await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``
const allow = (coder: Coder) => (event: CoderEvent) => {
  if (event.type === 'approval') coder.answer(event.id, 'allow')
}
const storage = () => ({ checkpoints: new CoderCheckpoints(join(home, 'c')), snapshots: new CoderSnapshots(join(home, 's')) })

function scripted(replies: string[], deps = storage()) {
  const coder = new Coder({ ...deps, chat: async () => replies.shift() ?? 'Done.' })
  return coder
}

describe('command undo', () => {
  it('finds and puts back files a command changed, created and deleted', async () => {
    await writeFile(join(root, 'gone.txt'), 'keep me\n')
    const coder = scripted([tool({ tool: 'run', command: 'echo changed> a.txt && echo new> made.txt && (rm gone.txt || del gone.txt)' }), 'Finished.'])
    await coder.run('s', root, 'go', 'edits', allow(coder))
    const changes = await coder.changes('s')
    expect(changes.map((file) => [file.path, file.status])).toEqual([['a.txt', 'modified'], ['gone.txt', 'deleted'], ['made.txt', 'created']])
    await coder.undo('s')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toContain('three')
    expect(await readFile(join(root, 'gone.txt'), 'utf8')).toBe('keep me\n')
    await expect(stat(join(root, 'made.txt'))).rejects.toThrow()
  })

  it('tells the model what a command changed', async () => {
    const seen: string[] = []
    const replies = [tool({ tool: 'run', command: 'printf x > a.txt' }), 'Finished.']
    const coder = new Coder({ ...storage(), chat: async (messages) => (seen.push(messages.at(-1)!.content), replies.shift() ?? 'Done.') })
    await coder.run('s', root, 'go', 'edits', allow(coder))
    expect(seen[1]).toContain('changed 1 file: a.txt')
  })

  it('puts back a binary file exactly', async () => {
    const bytes = Buffer.from([0, 1, 2, 255, 254, 0, 10])
    await writeFile(join(root, 'b.bin'), bytes)
    const coder = scripted([tool({ tool: 'run', command: 'printf new > b.bin' }), 'Finished.'])
    await coder.run('s', root, 'go', 'edits', allow(coder))
    expect((await coder.review('s', 'b.bin'))?.binary).toBe(true)
    await coder.undo('s', 'b.bin')
    expect((await readFile(join(root, 'b.bin'))).equals(bytes)).toBe(true)
  })

  it('leaves the project\'s own .git alone and skips node_modules', async () => {
    await mkdir(join(root, 'node_modules'))
    const coder = scripted([tool({ tool: 'run', command: 'printf x > node_modules/dep.js; printf y > a.txt' }), 'Finished.'])
    await coder.run('s', root, 'go', 'edits', allow(coder))
    expect((await coder.changes('s')).map((file) => file.path)).toEqual(['a.txt'])
    await expect(stat(join(root, '.git'))).rejects.toThrow()
  })
})

describe('resume after a restart', () => {
  it('keeps the whole conversation and undo', async () => {
    const deps = storage()
    const first = new Coder({ ...deps, chat: (() => { const r = [tool({ tool: 'write', path: 'b.txt', content: 'hi' }), 'Finished.']; return async () => r.shift() ?? 'Done.' })() })
    await first.run('s', root, 'make b', 'edits', allow(first))

    const seen: string[][] = []
    const second = new Coder({ ...deps, chat: async (messages) => (seen.push(messages.map((m) => m.content)), 'Second.') })
    expect((await second.changes('s')).map((file) => file.path)).toEqual(['b.txt'])
    await second.run('s', root, 'and now', 'edits', allow(second), [{ role: 'user', content: 'only the screen' }])
    const all = seen[0]!.join('\n')
    expect(all).toContain('<tool-result tool="write">')
    expect(all).not.toContain('only the screen')
    await second.undo('s')
    await expect(stat(join(root, 'b.txt'))).rejects.toThrow()
  })

  it('keeps nothing when saved chats are off', async () => {
    const deps = storage()
    const coder = new Coder({ ...deps, keepOnDisk: () => false, chat: async () => 'Fine.' })
    await coder.run('s', root, 'go', 'edits', () => undefined)
    expect(await deps.checkpoints.load('s')).toBeNull()
  })

  it('forgets a deleted chat', async () => {
    const deps = storage()
    const coder = new Coder({ ...deps, chat: async () => 'Fine.' })
    await coder.run('s', root, 'go', 'edits', () => undefined)
    await coder.forget('s')
    expect(await deps.checkpoints.load('s')).toBeNull()
  })

  it('drops files outside the folder from a tampered checkpoint', async () => {
    const deps = storage()
    await deps.checkpoints.save('s', { version: 1, folder: root, native: false, introduced: true, messages: [], originals: [['/etc/passwd', 'x']], opaque: [], seen: [] })
    const coder = new Coder({ ...deps, chat: async () => 'Fine.' })
    expect(await coder.changes('s')).toEqual([])
  })

  it('never names a file from the session id', async () => {
    const deps = storage()
    await deps.checkpoints.save('../../evil', { version: 1, folder: root, native: false, introduced: true, messages: [], originals: [], opaque: [], seen: [] })
    await expect(stat(join(home, 'evil.json'))).rejects.toThrow()
    expect(await deps.checkpoints.load('../../evil')).not.toBeNull()
  })

  it('removes old checkpoints only', async () => {
    const deps = new CoderCheckpoints(join(home, 'c'))
    const record = { version: 1 as const, folder: root, native: false, introduced: true, messages: [], originals: [], opaque: [], seen: [] }
    await deps.save('old', record)
    await deps.save('new', record)
    const { readdir } = await import('node:fs/promises')
    const names = await readdir(join(home, 'c'))
    await utimes(join(home, 'c', names[0]!), new Date(0), new Date(0))
    await deps.prune()
    expect(await readdir(join(home, 'c'))).toHaveLength(1)
  })
})

describe('review', () => {
  const edit = async () => {
    const coder = scripted([tool({ tool: 'write', path: 'a.txt', content: 'ONE\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n' }), 'Finished.'])
    await coder.run('s', root, 'go', 'edits', allow(coder))
    return coder
  }

  it('puts back one change and keeps the other', async () => {
    const coder = await edit()
    const review = await coder.review('s', 'a.txt')
    expect(review!.hunks).toHaveLength(2)
    await coder.decide('s', 'a.txt', review!.hunks[0]!.id, 'reject')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n')
    const next = await coder.review('s', 'a.txt')
    expect(next!.hunks).toHaveLength(1)
    expect(await coder.decide('s', 'a.txt', next!.hunks[0]!.id, 'accept')).toEqual([])
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n')
  })

  it('refuses a change that has moved on', async () => {
    const coder = await edit()
    const review = await coder.review('s', 'a.txt')
    await writeFile(join(root, 'a.txt'), 'something else\n')
    await expect(coder.decide('s', 'a.txt', review!.hunks[0]!.id, 'reject')).rejects.toThrow('moved on')
  })

  it('keeps a whole file', async () => {
    const coder = await edit()
    expect(await coder.decide('s', 'a.txt', null, 'accept')).toEqual([])
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toContain('ONE')
  })

  it('offers whole-file decisions for a created file', async () => {
    const coder = scripted([tool({ tool: 'write', path: 'n.txt', content: 'x\ny\n' }), 'Finished.'])
    await coder.run('s', root, 'go', 'edits', allow(coder))
    const review = await coder.review('s', 'n.txt')
    expect(review).toMatchObject({ status: 'created', whole: true })
    await coder.decide('s', 'n.txt', null, 'reject')
    await expect(stat(join(root, 'n.txt'))).rejects.toThrow()
  })
})

describe('native tools', () => {
  type Reply = { text: string; uses: { id: string; name: string; input: unknown }[] }
  const nativeCoder = (replies: (Reply | Error)[], text: string[] = [], deps = storage()) => {
    const calls: { messages: ChatMessage[]; tools: ToolSpec[] }[] = []
    const texts: ChatMessage[][] = []
    const coder = new Coder({
      ...deps,
      chat: async (messages) => (texts.push(messages), text.shift() ?? 'Finished.'),
      native: {
        available: () => true,
        chat: async (messages, _system, tools) => {
          calls.push({ messages: structuredClone(messages), tools })
          const next = replies.shift() ?? { text: 'Finished.', uses: [] }
          if (next instanceof Error) throw next
          return next
        }
      }
    })
    return { coder, calls, texts }
  }

  it('runs calls and answers each by id', async () => {
    const { coder, calls } = nativeCoder([{ text: 'Looking.', uses: [{ id: 'c1', name: 'read', input: { path: 'a.txt' } }, { id: 'c2', name: 'list', input: { path: '.' } }] }])
    await coder.run('s', root, 'look', 'ask', allow(coder))
    const results = calls[1]!.messages.at(-1)!.toolResults!
    expect(results.map((result) => result.id)).toEqual(['c1', 'c2'])
    expect(results[0]!.output).toContain('1  one')
  })

  it('answers unusable arguments rather than dropping the call', async () => {
    const { coder, calls } = nativeCoder([{ text: '', uses: [{ id: 'bad', name: 'write', input: null }] }])
    await coder.run('s', root, 'go', 'edits', allow(coder))
    expect(calls[1]!.messages.at(-1)!.toolResults![0]).toMatchObject({ id: 'bad', output: expect.stringContaining('could not be used') })
  })

  it('offers no changing tools in plan mode', async () => {
    const { coder, calls } = nativeCoder([])
    await coder.run('s', root, 'plan', 'plan', allow(coder))
    expect(calls[0]!.tools.map((one) => one.name)).not.toContain('write')
    expect(calls[0]!.tools.map((one) => one.name)).toContain('read')
  })

  it('falls back to text when a provider refuses tools, keeping history', async () => {
    const { coder, texts } = nativeCoder([{ text: '', uses: [{ id: 'c1', name: 'read', input: { path: 'a.txt' } }] }, new AiError('bad-request', 'no tools')], ['Finished as text.'])
    await coder.run('s', root, 'go', 'ask', allow(coder))
    const flat = texts[0]!.map((message) => message.content).join('\n')
    expect(flat).toContain('```tool')
    expect(flat).toContain('<tool-result tool="read">')
    expect(texts[0]!.some((message) => message.toolUses || message.toolResults)).toBe(false)
  })

  it('still accepts a tool written as text', async () => {
    const { coder, calls } = nativeCoder([{ text: tool({ tool: 'read', path: 'a.txt' }), uses: [] }])
    await coder.run('s', root, 'go', 'ask', allow(coder))
    expect(calls[1]!.messages.at(-1)!.content).toContain('1  one')
  })

  it('answers calls left open by a stop before asking again', async () => {
    const deps = storage()
    await deps.checkpoints.save('s', { version: 1, folder: await realpath(root), native: true, introduced: true, messages: [{ role: 'user', content: 'go' }, { role: 'assistant', content: '', toolUses: [{ id: 'open', name: 'read', input: { path: 'a.txt' } }] }], originals: [], opaque: [], seen: [] })
    const { coder, calls } = nativeCoder([], [], deps)
    await coder.run('s', root, 'carry on', 'ask', allow(coder))
    expect(calls[0]!.messages[2]!.toolResults![0]!.id).toBe('open')
  })
})

describe('asText', () => {
  it('refuses what would not survive as text', () => {
    expect(asText(Buffer.from('fine'))).toBe('fine')
    expect(asText(Buffer.from([0x66, 0, 0x66]))).toBeNull()
    expect(asText(Buffer.from([0xff, 0xfe]))).toBeNull()
    expect(asText(Buffer.alloc(10, 97), 5)).toBeNull()
  })
})
