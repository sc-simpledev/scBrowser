import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findSecrets, scheduleCron, secretWarning, type CoderEvent } from '@scbrowser/shared'
import { headlessFromArgv } from '../codeArgs'
import { ChatTools } from './chatTools'
import { Coder, mcpNote } from './coder'
import { automationsWorkflow } from './coderAutomations'
import { CoderLsp } from './coderLsp'
import { claudeRule, claudeSettings, loadHooks, projectSettings } from './coderProject'
import { deviceWait, projectSetup } from './coderSetup'
import { pageText } from './pageView'

const posixOnly = process.platform === 'win32'
let root = ''
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'coder-round3-')))
  await writeFile(join(root, 'a.ts'), 'export const one = 1\n')
})
afterEach(() => rm(root, { recursive: true, force: true }))

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``

describe('a project’s first-run suggestions', () => {
  it('reads the stack, safe scripts and MCP servers that fit, without what’s already allowed', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', dev: 'vite', build: 'vite build' }, dependencies: { react: '19' }, devDependencies: { typescript: '5', '@playwright/test': '1', '@sentry/react': '9' } }))
    await writeFile(join(root, 'pnpm-lock.yaml'), '')
    await mkdir(join(root, '.claude'))
    await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(pnpm run e2e:*)', 'Read(./src/**)'], deny: ['Bash(git push:*)'] } }))
    const setup = await projectSetup(root, ['pnpm run lint*'])
    expect(setup.stack).toEqual(['TypeScript', 'React', 'pnpm'])
    expect(setup.instructions).toBe(false)
    expect(setup.rules).toEqual(['pnpm run test*', 'pnpm run build*', 'pnpm run e2e*'])
    expect(setup.mcp.sort()).toEqual(['context7', 'playwright', 'sentry'])
  })
})

describe('Claude Code’s settings', () => {
  it('turn its command rules into ours', () => {
    expect(claudeRule('Bash(npm run test:*)')).toBe('npm run test*')
    expect(claudeRule('Bash(git status)')).toBe('git status')
    expect(claudeRule('Read(./src/**)')).toBeNull()
  })

  it('give their deny rules and hooks to the project, which still has to be trusted', async () => {
    await mkdir(join(root, '.claude'))
    await writeFile(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { deny: ['Bash(rm -rf:*)'] },
        hooks: {
          PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }, { matcher: 'WebFetch', hooks: [{ type: 'command', command: 'echo skip' }] }],
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './check.sh' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }]
        }
      })
    )
    expect((await projectSettings(root)).deny).toContain('rm -rf*')
    expect((await claudeSettings(root)).hooks.map((hook) => `${hook.event} ${hook.command}`)).toEqual(['afterEdit prettier --write', 'beforeCommand ./check.sh', 'afterTurn say done'])
    const [project] = await loadHooks(root, join(root, 'no-home'))
    expect(project?.source).toBe('project')
    expect(project?.hooks).toHaveLength(3)
  })

  it.skipIf(posixOnly)('hand a Claude hook its JSON on standard input', async () => {
    await mkdir(join(root, '.claude'))
    await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'cat > hook-input.json' }] }] } }))
    const replies = [tool({ tool: 'write', path: 'b.ts', content: 'x\n' }), 'Wrote it.']
    const coder = new Coder({ chat: async () => replies.shift() ?? 'Done.' })
    await coder.run('s', root, 'write b', 'edits', (event) => event.type === 'approval' && coder.answer(event.id, 'allow'))
    const input = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(root, 'hook-input.json'), 'utf8'))) as Record<string, unknown>
    expect(input).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(root, 'b.ts') } })
  })
})

describe('secret scanning', () => {
  it('finds secrets in added lines only, with where they are', () => {
    const diff = [
      'diff --git a/.env b/.env',
      '+++ b/.env',
      '@@ -1,2 +1,3 @@',
      ' NAME=app',
      `+ANTHROPIC_API_KEY=sk-ant-${'a'.repeat(40)}`,
      `-OLD=ghp_${'b'.repeat(36)}`,
      '+API_KEY=your_api_key_here',
      '+++ b/deploy.pem',
      '@@ -0,0 +1 @@',
      '+-----BEGIN RSA PRIVATE KEY-----'
    ].join('\n')
    expect(findSecrets(diff)).toEqual([
      { file: '.env', line: 2, kind: 'an AI provider key' },
      { file: 'deploy.pem', line: 1, kind: 'a private key' }
    ])
    expect(secretWarning(findSecrets(diff))).toContain('.env:2 (an AI provider key)')
    expect(secretWarning([])).toBeNull()
  })
})

describe('Terra Code on GitHub', () => {
  it('turns a local time into UTC cron, in words', () => {
    // Sydney is ten hours ahead: 9:00 there is 23:00 the day before in UTC.
    expect(scheduleCron('day', 9, -600)).toEqual({ cron: '0 23 * * *', label: 'Every day at 9:00' })
    expect(scheduleCron('weekday', 9, -600).cron).toBe('0 23 * * 0-4')
    expect(scheduleCron('week', 9, -600).cron).toBe('0 23 * * 0')
    expect(scheduleCron('week', 9, 0).cron).toBe('0 9 * * 1')
    expect(scheduleCron('weekday', 20, 300).cron).toBe('0 1 * * 2-6')
  })

  it('writes a workflow that only lets people who can push start it, with the tasks quoted safely', () => {
    const yaml = automationsWorkflow({ comments: true, schedules: [{ cron: '0 23 * * 0', task: "Update what's outdated", pr: true, label: 'Every Monday at 9:00' }] })
    expect(yaml).toContain('issue_comment:')
    expect(yaml).toContain("- cron: '0 23 * * 0'")
    expect(yaml).toContain('"OWNER","MEMBER","COLLABORATOR"')
    expect(yaml).toContain("SCTERRA_SCHEDULES: '[{\"cron\":\"0 23 * * 0\",\"task\":\"Update what''s outdated\",\"pr\":true}]'")
    expect(yaml).toContain('persist-credentials: false')
    expect(yaml).toContain('terra-code-runner.mjs')
    expect(automationsWorkflow({ comments: false, schedules: [] })).not.toContain('  issue_comment:')
  })

  it('waits for a device sign-in, slowing down when GitHub asks', async () => {
    const answers = [{ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { access_token: 'gho_token' }]
    const waits: number[] = []
    const token = await deviceWait(
      'client',
      { device_code: 'd', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 },
      new AbortController().signal,
      (async () => new Response(JSON.stringify(answers.shift()))) as unknown as typeof fetch,
      async (ms) => void waits.push(ms)
    )
    expect(token).toBe('gho_token')
    expect(waits).toEqual([5000, 5000, 10000])
  })
})

describe('headless runs', () => {
  it('read the task and what may happen without asking', () => {
    expect(headlessFromArgv(['scterra', 'code', '-p', 'fix', 'the', 'tests', '--allow-edits'], '/w', 1)).toEqual({ folder: '/w', task: 'fix the tests', mode: 'edits', allowEdits: true, allowCommands: false, json: false })
    expect(headlessFromArgv(['scterra', 'code', '--print', 'explain', '--plan', '--allow-commands', '--json'], '/w', 1)).toMatchObject({ mode: 'plan', allowEdits: false, allowCommands: false, json: true })
    expect(headlessFromArgv(['scterra', 'code', 'open this'], '/w', 1)).toBeNull()
    expect(headlessFromArgv(['scterra', 'code', '-p'], '/w', 1)).toBeNull()
  })
})

describe('what the sidebar assistant reads from a page', () => {
  const view = { title: 'Shop', description: 'Things for sale', text: '# Shop\n| Item | Price |\n| Lamp | $20 |\n[button: Buy]', visible: 'Lamp $20', links: '- Lamp: https://shop.test/lamp', bodyChars: 400, scrolled: 0 }
  it('sends the whole page when the article is only part of it, with what’s on screen first', () => {
    const text = pageText({ text: 'Lamp' }, view)
    expect(text.indexOf('On screen now')).toBeLessThan(text.indexOf('The whole page'))
    expect(text).toContain('[button: Buy]')
    expect(text).toContain('Links on the page:\n- Lamp: https://shop.test/lamp')
  })
  it('sends the article when it is most of the page', () => {
    expect(pageText({ text: 'x'.repeat(2000) }, { ...view, bodyChars: 2400 })).toContain('The article:\nxxx')
  })
})

describe('MCP servers, told to the model', () => {
  it('lists each, with why one isn’t working', () => {
    const note = mcpNote([
      { name: 'files', state: 'ready', error: null, enabled: true, trusted: true, tools: ['read', 'write'] },
      { name: 'db', state: 'error', error: 'npx wasn’t found.', enabled: true, trusted: true, tools: [] },
      { name: 'off', state: 'off', error: null, enabled: false, trusted: true, tools: [] },
      { name: 'proj', state: 'off', error: null, enabled: true, trusted: false, tools: [] }
    ])
    expect(note).toContain('- files: connected, 2 tools')
    expect(note).toContain('- db: not working (npx wasn’t found.)')
    expect(note).toContain('- proj: from the project')
    expect(note).not.toContain('- off')
    expect(mcpNote([])).toBe('')
  })

  it('reach the model in its instructions, and errors are explained', async () => {
    const systems: string[] = []
    const coder = new Coder({
      chat: async (_messages, system) => (systems.push(system), 'Done here.'),
      mcp: { tools: async () => [], views: async () => [{ name: 'db', state: 'error', error: 'It took longer than 90 seconds to start.', enabled: true, trusted: true, tools: [] }], call: async () => ({ ok: true, output: '', images: [] }) }
    })
    await coder.run('s', root, 'is my db server working?', 'ask', () => undefined)
    expect(systems[0]).toContain('- db: not working (It took longer than 90 seconds to start.)')
  })
})

describe('budgets, notes and the language server tool', () => {
  it('stops a session that has used its budget, and says so', async () => {
    const replies = [tool({ tool: 'read', path: 'a.ts' }), 'Read it.']
    const coder = new Coder({
      budget: () => 100,
      chat: async (_messages, _system, _signal, options) => {
        options?.onUsage?.(80, 40)
        return replies.shift() ?? 'Done.'
      }
    })
    const events: CoderEvent[] = []
    await coder.run('s', root, 'read', 'ask', (event) => events.push(event))
    expect(events.find((event) => event.type === 'error')).toMatchObject({ message: expect.stringContaining('budget') })
  })

  it('tells the model a note with the next message', async () => {
    const seen: string[] = []
    const coder = new Coder({ chat: async (messages) => (seen.push(messages.at(-1)!.content), 'Ok.') })
    await coder.addNote('s', root, 'Earlier, this went to the cloud.')
    await coder.run('s', root, 'carry on', 'ask', () => undefined)
    expect(seen[0]).toContain('carry on')
    expect(seen[0]).toContain('(Earlier, this went to the cloud.)')
  })

  it('offers the lsp tool when a server is installed, and runs it', async () => {
    const asked: string[] = []
    const replies = [tool({ tool: 'lsp', action: 'definition', path: 'a.ts', line: 1, column: 14 }), 'It is in a.ts.']
    const seen: string[] = []
    const coder = new Coder({
      chat: async (messages) => (seen.push(messages.map((m) => m.content).join('\n')), replies.shift() ?? 'Done.'),
      lsp: { available: () => ['.ts'], run: async (_root, action, path, line, column) => (asked.push(`${action} ${path}:${line}:${column}`), 'a.ts:1:14: export const one = 1') }
    })
    await coder.run('s', root, 'where is one?', 'ask', () => undefined)
    expect(asked).toEqual(['definition a.ts:1:14'])
    expect(seen.at(-1)).toContain('a.ts:1:14: export const one = 1')
  })

  it.skipIf(posixOnly)('speaks to a real language server process', async () => {
    // A tiny stand-in server that answers initialize and definition the way the protocol says.
    const bin = join(root, 'node_modules', '.bin')
    await mkdir(bin, { recursive: true })
    const server = join(bin, 'typescript-language-server')
    await writeFile(
      server,
      `#!/usr/bin/env node
let buffer = Buffer.alloc(0)
const send = (message) => { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message })); process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n'); process.stdout.write(body) }
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\\r\\n\\r\\n'); if (end === -1) return
    const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1]); if (buffer.length < end + 4 + length) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()); buffer = buffer.subarray(end + 4 + length)
    if (message.method === 'initialize') send({ id: message.id, result: { capabilities: {} } })
    if (message.method === 'textDocument/definition') send({ id: message.id, result: [{ uri: message.params.textDocument.uri, range: { start: { line: 0, character: 13 }, end: { line: 0, character: 16 } } }] })
    if (message.method === 'textDocument/hover') send({ id: message.id, result: { contents: { kind: 'markdown', value: 'const one: 1' } } })
  }
})
`
    )
    await chmod(server, 0o755)
    const lsp = new CoderLsp()
    try {
      expect(lsp.available(root)).toContain('.ts')
      expect(await lsp.run(root, 'definition', 'a.ts', 1, 14)).toBe('a.ts:1:14: export const one = 1')
      expect(await lsp.run(root, 'hover', 'a.ts', 1, 14)).toBe('const one: 1')
    } finally {
      lsp.dispose()
    }
  })
})

describe('the chat’s tools', () => {
  it('asks before an MCP tool that changes things, and remembers the yes for the reply', async () => {
    const events: { type: string; approvalId?: string }[] = []
    const calls: string[] = []
    const tools = new ChatTools({
      folder: () => root,
      mcp: { tools: async () => [], call: async (_folder, name) => (calls.push(name), { ok: true, output: 'Saved.', images: [] }) },
      webSearch: async () => 'results',
      readUrl: async () => 'page',
      screenshot: async () => null
    })
    const mcp = [{ server: 'notes', readOnly: false, spec: { name: 'mcp__notes__save', description: '', parameters: {} } }]
    const allowed = new Set<string>()
    const context = {
      streamId: 's',
      tabId: null,
      signal: new AbortController().signal,
      emit: (event: { type: string; approvalId?: string }) => {
        events.push(event)
        if (event.type === 'approval') setTimeout(() => tools.answer(event.approvalId!, true), 1)
      }
    }
    const first = await tools.run({ id: '1', name: 'mcp__notes__save', input: { text: 'hi' } }, mcp, context as never, allowed)
    const second = await tools.run({ id: '2', name: 'mcp__notes__save', input: { text: 'again' } }, mcp, context as never, allowed)
    expect(first.output).toBe('Saved.')
    expect(second.output).toBe('Saved.')
    expect(events.filter((event) => event.type === 'approval')).toHaveLength(1)
    expect(calls).toEqual(['mcp__notes__save', 'mcp__notes__save'])
    const look = await tools.run({ id: '3', name: 'look_at_page', input: {} }, mcp, context as never, allowed)
    expect(look.output).toContain('No page is shared')
  })
})
