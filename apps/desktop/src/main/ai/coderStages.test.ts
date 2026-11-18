import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCoderReply, toCall } from '@scbrowser/ai'
import { isSafeCommand, ruleCovers, suggestRule, type CoderEvent } from '@scbrowser/shared'
import { codeFromArgv } from '../codeArgs'
import { Coder, expandCommand, focusDiagnostics, rememberNote, type ChatOptions } from './coder'
import { frontmatter, mcpConfig } from './coderProject'
import { MemoryCoderTrust } from './coderTrust'
import { sandboxAvailable } from './coderTools'

/** These steps use POSIX shell commands; on Windows Terra Code's commands go through cmd.exe. */
const posixOnly = process.platform === 'win32'

let root = ''
let home = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coder-stage-'))
  home = await mkdtemp(join(tmpdir(), 'coder-home-'))
  await writeFile(join(root, 'a.txt'), 'hello\n')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``

function scripted(replies: string[], extra: Partial<ConstructorParameters<typeof Coder>[0]> = {}) {
  const seen: { system: string; messages: { content: string; images?: string[] }[]; options?: ChatOptions }[] = []
  const coder = new Coder({
    home,
    chat: async (messages, system, _signal, options) => {
      seen.push({ system, messages: messages.map((m) => ({ content: m.content, images: (m as { images?: string[] }).images })), options })
      options?.onUsage?.(100, 10)
      // Summaries are asked for whenever the session grows long, so they don't take a scripted reply.
      if (system.includes('summarise a coding session')) return 'Summary: changed nothing yet.'
      return replies.shift() ?? 'Done.'
    },
    ...extra
  })
  return { coder, seen }
}

const collect = (coder: Coder, answer: (event: Extract<CoderEvent, { type: 'approval' }>) => 'allow' | 'always' | 'deny' = () => 'allow') => {
  const events: CoderEvent[] = []
  const emit = (event: CoderEvent) => {
    events.push(event)
    if (event.type === 'approval') coder.answer(event.id, answer(event))
  }
  return { events, emit }
}

describe('commands and rules', () => {
  it('knows commands that only look', () => {
    expect(isSafeCommand('git status')).toBe(true)
    expect(isSafeCommand('ls -la src')).toBe(true)
    expect(isSafeCommand('git diff --stat')).toBe(true)
    expect(isSafeCommand('node --version')).toBe(true)
    expect(isSafeCommand('ls; rm -rf ~')).toBe(false)
    expect(isSafeCommand('cat a > b')).toBe(false)
    expect(isSafeCommand('git diff --output=x')).toBe(false)
    expect(isSafeCommand('rm a')).toBe(false)
    expect(isSafeCommand('git push')).toBe(false)
  })

  it('matches saved rules, never across an operator', () => {
    expect(ruleCovers('npm test*', 'npm test')).toBe(true)
    expect(ruleCovers('npm test*', 'npm test -- --watch')).toBe(true)
    expect(ruleCovers('npm test*', 'npm test; rm -rf ~')).toBe(false)
    expect(ruleCovers('npm test *', 'npm testing')).toBe(false)
    expect(ruleCovers('make', 'make')).toBe(true)
    expect(ruleCovers('make', 'make all')).toBe(false)
    expect(ruleCovers('mcp__github__*', 'mcp__github__create_issue')).toBe(true)
  })

  it('suggests a rule for the program and its subcommand', () => {
    expect(suggestRule('npm test')).toBe('npm test*')
    expect(suggestRule('npm run build -- --prod')).toBe('npm run build*')
    expect(suggestRule('python -m pytest tests/')).toBe('python -m pytest*')
    expect(suggestRule('cargo build --release')).toBe('cargo build*')
    expect(suggestRule('./run.sh --fast')).toBe('./run.sh*')
    expect(suggestRule('a && b')).toBe('a && b')
  })

  it('runs safe commands without asking, even in plan mode, and refuses the rest there', async () => {
    const { coder, seen } = scripted([tool({ tool: 'run', command: 'ls' }), tool({ tool: 'run', command: 'touch x' }), 'Planned.'])
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'look', 'plan', emit)
    expect(events.some((event) => event.type === 'approval')).toBe(false)
    expect(seen[1]!.messages.at(-1)!.content).toContain('a.txt')
    expect(seen[2]!.messages.at(-1)!.content).toContain('only commands that just look')
  })

  it('saves "always" as a rule for the project, which later runs use', async () => {
    const trust = new MemoryCoderTrust()
    const { coder } = scripted([tool({ tool: 'run', command: 'echo one' }), 'Done.', tool({ tool: 'run', command: 'echo two' }), 'Done.'], { trust })
    const first = collect(coder, (event) => {
      expect(event.rule).toBe('echo*')
      return 'always'
    })
    await coder.run('s', root, 'say one', 'ask', first.emit)
    expect(trust.rules(await import('node:fs/promises').then((fs) => fs.realpath(root))).allow).toEqual(['echo*'])
    const second = collect(coder)
    await coder.run('s', root, 'say two', 'ask', second.emit)
    expect(second.events.some((event) => event.type === 'approval')).toBe(false)
  })

  it("follows the project's deny rules without asking", async () => {
    await mkdir(join(root, '.terra'))
    await writeFile(join(root, '.terra', 'settings.json'), JSON.stringify({ deny: ['git push*'] }))
    const { coder, seen } = scripted([tool({ tool: 'run', command: 'git push origin main' }), 'OK.'])
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'push', 'ask', emit)
    expect(events.some((event) => event.type === 'approval')).toBe(false)
    expect(seen[1]!.messages.at(-1)!.content).toContain('rule for this project blocks')
  })
})

describe('live and background commands', () => {
  it.skipIf(posixOnly)('streams what a command prints, and keeps a background job running to read later', async () => {
    const { coder, seen } = scripted([
      tool({ tool: 'run', command: 'echo live-output' }),
      tool({ tool: 'run', command: 'echo started; sleep 0.3; echo later; sleep 30', background: true }),
      tool({ tool: 'output', job: 1, wait: 2 }),
      tool({ tool: 'kill', job: 1 }),
      'Done.'
    ])
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'serve', 'ask', emit)
    expect(events.some((event) => event.type === 'output' && event.text.includes('live-output'))).toBe(true)
    expect(seen[2]!.messages.at(-1)!.content).toContain('Started job 1')
    expect(seen[3]!.messages.at(-1)!.content).toContain('later')
    expect(seen[4]!.messages.at(-1)!.content).toContain('Stopped job 1')
    expect(events.some((event) => event.type === 'jobs')).toBe(true)
    coder.dispose()
  })
})

describe('rewind', () => {
  it('puts files and the conversation back to before a turn', async () => {
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'one\n' }), 'First.', tool({ tool: 'write', path: 'a.txt', content: 'two\n' }), tool({ tool: 'write', path: 'b.txt', content: 'new\n' }), 'Second.', 'Third.'])
    await coder.run('s', root, 'first', 'edits', collect(coder).emit, undefined, { turnId: 't1' })
    await coder.run('s', root, 'second', 'edits', collect(coder).emit, undefined, { turnId: 't2' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('two\n')
    const back = await coder.rewind('s', 't2')
    expect(back.task).toBe('second')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\n')
    await expect(readFile(join(root, 'b.txt'), 'utf8')).rejects.toThrow()
    await coder.run('s', root, 'again', 'edits', collect(coder).emit, undefined, { turnId: 't3' })
    const sent = seen.at(-1)!.messages.map((m) => m.content).join('\n')
    expect(sent).toContain('first')
    expect(sent).not.toContain('second')
    expect((await coder.changes('s')).map((change) => change.path)).toEqual(['a.txt'])
  })
})

describe('compaction', () => {
  it.skipIf(posixOnly)('summarises the start of a long session, keeping recent turns and the task', async () => {
    const replies = [...Array.from({ length: 10 }, (_, i) => tool({ tool: 'run', command: `head -c 30000 /dev/zero | tr '\\0' x; echo ${i}` })), 'Done.']
    const { coder, seen } = scripted(replies)
    const { events, emit } = collect(coder, () => 'allow')
    await coder.run('s', root, 'the long task', 'ask', emit)
    const compacted = events.find((event) => event.type === 'compacted')
    expect(compacted).toBeDefined()
    const summaryCall = seen.find((call) => call.system.includes('summarise a coding session'))
    expect(summaryCall!.messages[0]!.content).toContain('the long task')
    expect(seen.at(-1)!.messages[0]!.content).toContain('Summary: changed nothing yet.')
    expect(events.some((event) => event.type === 'context')).toBe(true)
  })
})

describe('tools', () => {
  it('patches several files at once with one approval, all or nothing', async () => {
    await writeFile(join(root, 'b.txt'), 'world\n')
    const { coder, seen } = scripted([
      tool({ tool: 'patch', files: [{ path: 'a.txt', edits: [{ find: 'hello', replace: 'hi' }] }, { path: 'b.txt', edits: [{ find: 'nope', replace: 'x' }] }] }),
      tool({ tool: 'patch', files: [{ path: 'a.txt', edits: [{ find: 'hello', replace: 'hi' }] }, { path: 'b.txt', find: 'world', replace: 'earth' }] }),
      'Done.'
    ])
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'rename', 'ask', emit)
    expect(seen[1]!.messages.at(-1)!.content).toContain('Nothing was changed')
    expect(events.filter((event) => event.type === 'approval')).toHaveLength(1)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hi\n')
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('earth\n')
  })

  it('shows lines around search matches, and pictures as pictures', async () => {
    await writeFile(join(root, 'c.txt'), 'one\ntwo\nthree\nfour\n')
    await writeFile(join(root, 'dot.png'), Buffer.from('iVBORw0KGgo=', 'base64'))
    const { coder, seen } = scripted([tool({ tool: 'search', pattern: 'three', context: 1 }), tool({ tool: 'read', path: 'dot.png' }), 'Done.'])
    await coder.run('s', root, 'look', 'ask', collect(coder).emit)
    expect(seen[1]!.messages.at(-1)!.content).toContain('c.txt-2- two')
    expect(seen[1]!.messages.at(-1)!.content).toContain('c.txt:3: three')
    expect(seen[2]!.messages.at(-1)!.images?.[0]).toMatch(/^data:image\/png;base64,/)
  })

  it('sends pictures and @ files with the task, and the session model and effort with each request', async () => {
    const { coder, seen } = scripted(['Seen.'])
    await coder.run('s', root, 'what is this', 'ask', collect(coder).emit, undefined, { images: ['data:image/png;base64,AAAA'], mentions: [{ kind: 'file', path: 'a.txt' }], model: { providerId: 'p', model: 'm' }, effort: 'high' })
    expect(seen[0]!.messages[0]!.images).toEqual(['data:image/png;base64,AAAA'])
    expect(seen[0]!.messages[0]!.content).toContain('<tool-result tool="file a.txt">')
    expect(seen[0]!.options).toMatchObject({ model: { providerId: 'p', model: 'm' }, effort: 'high' })
  })
})

describe('the project', () => {
  it("runs a project's slash command, agent and skill", async () => {
    await mkdir(join(root, '.terra', 'commands'), { recursive: true })
    await mkdir(join(root, '.terra', 'agents'), { recursive: true })
    await mkdir(join(root, '.claude', 'skills', 'release'), { recursive: true })
    await writeFile(join(root, '.terra', 'commands', 'shout.md'), '---\ndescription: Says it loudly\n---\nSay $ARGUMENTS in capitals.')
    await writeFile(join(root, '.terra', 'agents', 'reader.md'), '---\nname: reader\ndescription: Reads files\ntools: read\n---\nYou read files and report.')
    await writeFile(join(root, '.claude', 'skills', 'release', 'SKILL.md'), '---\nname: release\ndescription: How to cut a release\n---\nBump the version, then tag.')
    const { coder, seen } = scripted([tool({ tool: 'agent', agent: 'reader', task: 'read a.txt' }), tool({ tool: 'read', path: 'a.txt' }), 'It says hello.', tool({ tool: 'skill', name: 'release' }), 'Done.'])
    await coder.run('s', root, '/shout hello there', 'ask', collect(coder).emit)
    expect(seen[0]!.messages[0]!.content).toContain('Say hello there in capitals.')
    expect(seen[0]!.system).toContain('"agent":"reader"')
    expect(seen[0]!.system).toContain('"name":"release"')
    expect(seen[1]!.system).toContain('You read files and report.')
    expect(seen[3]!.messages.at(-1)!.content).toContain('It says hello.')
    expect(seen[4]!.messages.at(-1)!.content).toContain('Bump the version, then tag.')
  })

  it.skipIf(posixOnly)("asks before a project's hooks run, then runs them after edits", async () => {
    await mkdir(join(root, '.terra'))
    await writeFile(join(root, '.terra', 'hooks.json'), JSON.stringify({ afterEdit: [{ command: 'printf formatted > "$TERRA_FILE"', match: '*.txt' }] }))
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'messy' }), 'Done.'])
    const { events, emit } = collect(coder, (event) => (event.summary.includes('hooks') ? 'allow' : 'allow'))
    await coder.run('s', root, 'write', 'edits', emit)
    expect(events.some((event) => event.type === 'approval' && event.summary.includes('hooks'))).toBe(true)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('formatted')
    expect(seen[1]!.messages.at(-1)!.content).toContain('A hook changed the file')
  })

  it('expands commands and reads frontmatter', () => {
    const commands = [{ name: 'fix', description: '', body: 'Fix issue $1 in $2.', source: 'project' as const, tools: [] }]
    expect(expandCommand('/fix 12 parser', commands)).toBe('Fix issue 12 in parser.\n\n12 parser')
    expect(expandCommand('/other thing', commands)).toBe('/other thing')
    expect(frontmatter('---\nname: x\ntools: [read, search]\n---\nBody').fields).toEqual({ name: 'x', tools: '[read, search]' })
  })

  it('reads MCP server settings in the usual shape', () => {
    expect(mcpConfig('github', { command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'x' } })).toEqual({ name: 'github', type: 'stdio', command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'x' }, enabled: true })
    expect(mcpConfig('remote', { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } })).toMatchObject({ type: 'http' })
    expect(mcpConfig('bad name!', { command: 'x' })).toBeNull()
    expect(mcpConfig('none', { args: [] })).toBeNull()
  })
})

describe('odds and ends', () => {
  it('puts errors in changed files first when a checker says a lot', () => {
    const output = [...Array.from({ length: 600 }, (_, i) => `src/other${i}.ts(1,1): error TS1: noise noise noise`), 'src/mine.ts(4,2): error TS2: real', 'Found 601 errors.'].join('\n')
    const focused = focusDiagnostics(output, ['src/mine.ts'])
    expect(focused).toContain('In the files you changed:\nsrc/mine.ts(4,2)')
    expect(focused).toContain('Found 601 errors.')
  })

  it('adds notes to TERRA.md, newest first', async () => {
    await rememberNote(root, 'Use pnpm')
    await rememberNote(root, 'Tests need a database')
    expect(await readFile(join(root, 'TERRA.md'), 'utf8')).toBe('# Notes for Terra Code\n\n## Notes\n\n- Tests need a database\n- Use pnpm\n')
  })

  it('reads `scterra code …` from the command line', () => {
    expect(codeFromArgv(['/opt/scTerra/scterra', 'code', 'fix', 'the', 'tests'], '/home/a/project', 1)).toEqual({ folder: '/home/a/project', task: 'fix the tests' })
    expect(codeFromArgv(['electron', '.', '--no-sandbox', 'code'], '/p', 2)).toEqual({ folder: '/p', task: '' })
    expect(codeFromArgv(['/opt/scTerra/scterra', 'https://example.com'], '/p', 1)).toBeNull()
  })

  it('reads the new tools and MCP calls in any of the usual shapes', () => {
    expect(toCall({ tool: 'mcp__github__create_issue', title: 'Bug' })).toEqual({ tool: 'mcp', name: 'mcp__github__create_issue', input: { title: 'Bug' } })
    expect(toCall({ name: 'mcp__fs__read', arguments: '{"path":"x"}' })).toEqual({ tool: 'mcp', name: 'mcp__fs__read', input: { path: 'x' } })
    expect(toCall({ tool: 'Bash', command: 'npm run dev', run_in_background: true })).toEqual({ tool: 'run', command: 'npm run dev', background: true })
    expect(toCall({ tool: 'BashOutput', bash_id: 'shell_2' })).toEqual({ tool: 'output', job: 2, wait: 0 })
    expect(toCall({ tool: 'Task', subagent_type: 'reviewer', prompt: 'check it' })).toEqual({ tool: 'agent', agent: 'reviewer', task: 'check it' })
    expect(toCall({ tool: 'Task', subagent_type: 'general-purpose', prompt: 'look' })).toEqual({ tool: 'explore', task: 'look' })
    expect(toCall({ tool: 'WebFetch', url: 'https://a.test/x' })).toEqual({ tool: 'fetch', url: 'https://a.test/x' })
    expect(toCall({ tool: 'preview', action: 'click', target: 'Save' })).toMatchObject({ tool: 'preview', action: 'click', target: 'Save' })
    expect(toCall({ tool: 'preview', action: 'click' })).toBeNull()
    expect(parseCoderReply('```tool\n{"tool":"tabs","action":"read","tab":4}\n```').calls).toEqual([{ tool: 'tabs', action: 'read', tab: 4 }])
  })
})

describe('sandbox and checks', () => {
  it.runIf(sandboxAvailable())('fences commands into the project, and cuts the network off when asked', async () => {
    const { runCommand } = await import('./coderTools')
    const outside = join(home, 'outside.txt')
    const inProject = await runCommand(root, 'echo ok > made.txt && cat made.txt', new AbortController().signal, 20_000, { sandbox: 'offline' })
    expect(inProject.output).toContain('ok')
    const escaped = await runCommand(root, `echo no > "${outside}"`, new AbortController().signal, 20_000, { sandbox: 'project' })
    expect(escaped.ok).toBe(false)
    await expect(readFile(outside, 'utf8')).rejects.toThrow()
    const server = (await import('node:http')).createServer((_req, res) => res.end('reached')).listen(0)
    const port = (server.address() as { port: number }).port
    try {
      const online = await runCommand(root, `node -e "fetch('http://127.0.0.1:${port}').then(r => r.text()).then(console.log, () => console.log('blocked'))"`, new AbortController().signal, 20_000, { sandbox: 'project' })
      const offline = await runCommand(root, `node -e "fetch('http://127.0.0.1:${port}').then(r => r.text()).then(console.log, () => console.log('blocked'))"`, new AbortController().signal, 20_000, { sandbox: 'offline' })
      expect(online.output).toContain('reached')
      expect(offline.output).toContain('blocked')
    } finally {
      server.close()
    }
  })

  it("runs the project's checker by itself after edits, when it may run without asking", async () => {
    await mkdir(join(root, '.terra'))
    await writeFile(join(root, '.terra', 'settings.json'), JSON.stringify({ diagnostics: 'echo CHECKED-OK' }))
    const trust = new MemoryCoderTrust()
    trust.setRules(await (await import('node:fs/promises')).realpath(root), { allow: ['echo*'], deny: [] })
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'changed\n' }), 'Done.'], { trust, autoCheck: () => true })
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'change it', 'edits', emit)
    expect(seen[1]!.messages.at(-1)!.content).toContain('Checked by itself after your edits, with echo CHECKED-OK')
    expect(seen[1]!.messages.at(-1)!.content).toContain('CHECKED-OK')
    expect(events.some((event) => event.type === 'approval')).toBe(false)
  })

  it('never runs the checker by itself when it would need asking', async () => {
    await mkdir(join(root, '.terra'))
    await writeFile(join(root, '.terra', 'settings.json'), JSON.stringify({ diagnostics: 'echo CHECKED-OK' }))
    const { coder, seen } = scripted([tool({ tool: 'write', path: 'a.txt', content: 'changed\n' }), 'Done.'], { autoCheck: () => true })
    await coder.run('s', root, 'change it', 'edits', collect(coder).emit)
    expect(seen[1]!.messages.at(-1)!.content).not.toContain('Checked by itself')
  })
})
