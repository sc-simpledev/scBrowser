import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MCP_DIRECTORY, type CoderEvent } from '@scbrowser/shared'
import { Coder } from './coder'
import { callbackPort, waitForCode } from './coderMcpAuth'
import { formatterFor } from './coderProject'
import { MemoryCoderTrust } from './coderTrust'

const posixOnly = process.platform === 'win32'
let root = ''
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'coder-round-')))
  await writeFile(join(root, 'a.txt'), 'one\n')
})
afterEach(() => rm(root, { recursive: true, force: true }))

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``

function scripted(replies: string[], extra: Partial<ConstructorParameters<typeof Coder>[0]> = {}) {
  const seen: string[][] = []
  const coder = new Coder({
    chat: async (messages) => {
      seen.push(messages.map((m) => m.content))
      return replies.shift() ?? 'Done.'
    },
    ...extra
  })
  return { coder, seen }
}

const collect = (coder: Coder, answer: (event: Extract<CoderEvent, { type: 'approval' }>) => 'allow' | 'always' | 'deny' = () => 'allow') => {
  const events: CoderEvent[] = []
  return {
    events,
    emit: (event: CoderEvent) => {
      events.push(event)
      if (event.type === 'approval') coder.answer(event.id, answer(event))
    }
  }
}

describe('rewinding, with a choice', () => {
  const twoTurns = async () => {
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'two\n' }), 'First.', tool({ tool: 'write', path: 'a.txt', content: 'three\n' }), 'Second.', 'Third.'])
    await coder.run('s', root, 'first', 'edits', collect(coder).emit, undefined, { turnId: 't1' })
    await coder.run('s', root, 'second', 'edits', collect(coder).emit, undefined, { turnId: 't2' })
    return { coder, seen }
  }

  it('puts back only the code, keeping the conversation and telling the model', async () => {
    const { coder, seen } = await twoTurns()
    await coder.rewind('s', 't2', 'code')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('two\n')
    await coder.run('s', root, 'next', 'edits', collect(coder).emit, undefined, { turnId: 't3' })
    const sent = seen.at(-1)!.join('\n')
    expect(sent).toContain('second')
    expect(sent).toContain('put the files back')
  })

  it('goes back only in the conversation, keeping the files', async () => {
    const { coder, seen } = await twoTurns()
    await coder.rewind('s', 't2', 'conversation')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('three\n')
    await coder.run('s', root, 'next', 'edits', collect(coder).emit, undefined, { turnId: 't3' })
    const sent = seen.at(-1)!.join('\n')
    expect(sent).not.toContain('second')
    expect(sent).toContain('kept the files as they are now')
  })
})

describe('undoing one step', () => {
  it('undoes and redoes a single edit, and says which steps can be', async () => {
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'two\n' }), tool({ tool: 'write', path: 'b.txt', content: 'new\n' }), 'Done.', 'OK.'])
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'change things', 'edits', emit)
    const steps = events.filter((event): event is Extract<CoderEvent, { type: 'tool-result' }> => event.type === 'tool-result' && !!event.undoable)
    expect(steps).toHaveLength(2)
    await coder.undoStep('s', steps[0]!.id)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\n')
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('new\n')
    await coder.undoStep('s', steps[1]!.id)
    await expect(readFile(join(root, 'b.txt'), 'utf8')).rejects.toThrow()
    await coder.undoStep('s', steps[0]!.id, true)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('two\n')
    await coder.run('s', root, 'and now', 'edits', emit)
    expect(seen.at(-1)!.join('\n')).toContain('undid your step')
  })

  it("won't undo a step whose file has changed since", async () => {
    const { coder } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'two\n' }), 'Done.'])
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'change', 'edits', emit)
    const step = events.find((event): event is Extract<CoderEvent, { type: 'tool-result' }> => event.type === 'tool-result' && !!event.undoable)!
    await writeFile(join(root, 'a.txt'), 'someone else\n')
    await expect(coder.undoStep('s', step.id)).rejects.toThrow(/changed since/)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('someone else\n')
  })
})

describe('formatters', () => {
  it("finds the project's own formatter, and none when it isn't set up", async () => {
    await writeFile(join(root, 'app.ts'), 'x')
    expect(await formatterFor(root, join(root, 'app.ts'))).toBeNull()
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
    await writeFile(join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier'), '')
    // Installed but not configured: still not this project's formatter.
    expect(await formatterFor(root, join(root, 'app.ts'))).toBeNull()
    await writeFile(join(root, '.prettierrc'), '{}')
    const found = await formatterFor(root, join(root, 'app.ts'))
    expect(found).toMatchObject({ name: 'Prettier', key: 'prettier', example: 'prettier --write --log-level warn app.ts' })
    expect(await formatterFor(root, join(root, 'notes.txt'))).toBeNull()
  })

  it.skipIf(posixOnly)('asks once, then formats each edited file and tells the model', async () => {
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
    const bin = join(root, 'node_modules', '.bin', 'prettier')
    // A stand-in that upper-cases the file it's given.
    await writeFile(bin, '#!/bin/sh\nfor f in "$@"; do case "$f" in -*|warn) ;; *) tr a-z A-Z < "$f" > "$f.tmp" && mv "$f.tmp" "$f";; esac; done\n')
    await chmod(bin, 0o755)
    await writeFile(join(root, '.prettierrc'), '{}')
    const trust = new MemoryCoderTrust()
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'app.ts', content: 'const a = 1\n' }), tool({ tool: 'write', path: 'b.ts', content: 'let b\n' }), 'Done.'], { trust })
    const { events, emit } = collect(coder, (event) => (event.summary.includes('Prettier') ? 'always' : 'allow'))
    await coder.run('s', root, 'write', 'edits', emit)
    expect(events.filter((event) => event.type === 'approval' && event.summary.includes('Prettier'))).toHaveLength(1)
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('CONST A = 1\n')
    expect(await readFile(join(root, 'b.ts'), 'utf8')).toBe('LET B\n')
    expect(seen[1]!.at(-1)).toContain('Formatted with Prettier')
    expect(trust.trusted(root, 'formatter:prettier')).toBe('prettier')
  })

  it('is left alone when turned off', async () => {
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
    await writeFile(join(root, 'node_modules', '.bin', 'prettier'), '')
    await writeFile(join(root, '.prettierrc'), '{}')
    const { coder } = scripted([tool({ tool: 'write', path: 'app.ts', content: 'x\n' }), 'Done.'], { autoFormat: () => false })
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'write', 'edits', emit)
    expect(events.some((event) => event.type === 'approval')).toBe(false)
  })
})

describe('the session list', () => {
  it('knows which sessions wait for an answer', async () => {
    const { coder } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'two\n' }), 'Done.'])
    let waitingThen: string[] = []
    await coder.run('s', root, 'change', 'ask', (event) => {
      if (event.type !== 'approval') return
      waitingThen = coder.waitingSessions()
      coder.answer(event.id, 'allow')
    })
    expect(waitingThen).toEqual(['s'])
    expect(coder.waitingSessions()).toEqual([])
  })
})

describe('MCP sign-in and directory', () => {
  it('waits for the code on the computer itself, at a port that stays the same per server', async () => {
    expect(callbackPort('linear')).toBe(callbackPort('linear'))
    expect(callbackPort('linear')).toBeGreaterThanOrEqual(33418)
    const port = callbackPort(`test-${Date.now()}`)
    const code = waitForCode(port)
    await new Promise((done) => setTimeout(done, 50))
    const page = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=x`)
    expect(await page.text()).toContain('Signed in')
    await expect(code).resolves.toBe('abc')
  })

  it('reports a refused sign-in', async () => {
    const port = callbackPort(`refused-${Date.now()}`)
    const code = waitForCode(port)
    code.catch(() => undefined)
    await new Promise((done) => setTimeout(done, 50))
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)
    await expect(code).rejects.toThrow('access_denied')
  })

  it('lists common servers with names MCP accepts', () => {
    expect(MCP_DIRECTORY.length).toBeGreaterThan(8)
    for (const entry of MCP_DIRECTORY) expect(entry.name).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/)
    expect(new Set(MCP_DIRECTORY.map((entry) => entry.id)).size).toBe(MCP_DIRECTORY.length)
  })
})
