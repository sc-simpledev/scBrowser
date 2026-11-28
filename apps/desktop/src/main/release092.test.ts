import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProvider, parseTidyTitles } from '@scbrowser/ai'
import type { CoderCloudRun, CoderEvent, CoderGithubStatus, CoderStatus, McpServerView, Settings } from '@scbrowser/shared'
import { DEFAULT_SETTINGS } from '@scbrowser/shared'
import { Coder } from './ai/coder'
import { CoderCloud } from './ai/coderCloud'
import { runDoctor } from './ai/coderDoctor'
import { CoderLsp } from './ai/coderLsp'
import type { CoderServer } from './ai/coderServer'
import { hintLabels, HINT_LETTERS } from './linkHints'

const posixOnly = process.platform === 'win32'
let root = ''
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'release092-')))
  await writeFile(join(root, 'a.ts'), 'export const one = 1\n')
})
afterEach(() => rm(root, { recursive: true, force: true }))

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``

describe('link hints', () => {
  it('labels every target with letters of one length, so none starts another', () => {
    expect(hintLabels(3)).toEqual(['s', 'a', 'd'])
    const many = hintLabels(40)
    expect(new Set(many).size).toBe(40)
    expect(many.every((label) => label.length === 2)).toBe(true)
    expect(many.every((label) => [...label].every((letter) => HINT_LETTERS.includes(letter)))).toBe(true)
    expect(hintLabels(HINT_LETTERS.length).every((label) => label.length === 1)).toBe(true)
  })
})

describe('tidy tab titles', () => {
  it('keeps only shorter titles, for tabs that were offered', () => {
    const tabs = [
      { id: 7, title: 'How to centre a div in CSS (2026 guide) | Example Dev Blog', url: 'https://example.com/a' },
      { id: 9, title: 'Inbox', url: 'https://mail.example.com' }
    ]
    const titles = parseTidyTitles('Here: {"titles":[{"tab":1,"title":"Centre a div in CSS"},{"tab":2,"title":"The inbox of mail"},{"tab":5,"title":"x"}]}', tabs)
    expect([...titles]).toEqual([[7, 'Centre a div in CSS']])
    expect(parseTidyTitles('not json', tabs).size).toBe(0)
  })
})

describe('the model’s own words when it stops', () => {
  it('passes on what a server said inside its stream', async () => {
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}\n\ndata: ${JSON.stringify({ error: { message: 'The AI service had a problem.' } })}\n\n`
    const fetch = (async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as typeof globalThis.fetch
    const provider = createProvider({ config: { id: 'x', name: 'scTerra AI', protocol: 'openai', baseUrl: 'https://example.com/v1', models: ['m'], firstParty: false, hosted: true }, secret: { apiKey: '', headers: {} }, fetch })
    const read = async () => {
      for await (const _event of provider.chat({ model: 'm', system: '', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 })) void _event
    }
    await expect(read()).rejects.toThrow('scTerra AI stopped with an error: The AI service had a problem.')
  })
})

describe('Terra Code’s context, style and language server errors', () => {
  it('breaks down what fills the model’s memory', async () => {
    const coder = new Coder({ chat: async () => 'All done, nothing to change.' })
    await coder.run('s', root, 'look at a.ts please', 'ask', () => undefined)
    const breakdown = await coder.contextBreakdown('s', root, 'ask')
    const labels = breakdown.parts.map((part) => part.label)
    expect(labels).toEqual(expect.arrayContaining(['Instructions', 'Project notes', 'Your messages', 'Replies']))
    expect(breakdown.used).toBe(breakdown.parts.reduce((sum, part) => sum + part.tokens, 0))
    expect(breakdown.limit).toBeGreaterThan(breakdown.used)
  })

  it('tells the model how to explain when a style is chosen', async () => {
    const systems: string[] = []
    const coder = new Coder({ style: () => 'learning', chat: async (_messages, system) => (systems.push(system), 'Done.') })
    await coder.run('s', root, 'hello', 'ask', () => undefined)
    expect(systems[0]).toContain('TODO(you)')
  })

  it('hands the model the language server’s errors after an edit', async () => {
    const replies = [tool({ tool: 'write', path: 'a.ts', content: 'export const one: string = 1\n' }), 'Done.']
    const seen: string[] = []
    const coder = new Coder({
      autoFormat: () => false,
      chat: async (messages) => (seen.push(messages.at(-1)!.content), replies.shift() ?? 'Done.'),
      lsp: { available: () => ['.ts'], run: async () => '', problems: async (_root, path) => `${path}:1:14: Type 'number' is not assignable to type 'string'.` }
    })
    await coder.run('s', root, 'change one', 'edits', () => undefined)
    expect(seen.join('\n')).toContain("The language server sees these errors in the file now")
    expect(seen.join('\n')).toContain("a.ts:1:14: Type 'number' is not assignable to type 'string'.")
  })

  it.skipIf(posixOnly)('reads errors a real language server process publishes', async () => {
    const bin = join(root, 'node_modules', '.bin')
    await mkdir(bin, { recursive: true })
    const server = join(bin, 'typescript-language-server')
    // A stand-in that publishes an error on any line holding "oops", the way servers do after an open or change.
    await writeFile(
      server,
      `#!/usr/bin/env node
let buffer = Buffer.alloc(0)
const send = (message) => { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message })); process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n'); process.stdout.write(body) }
const publish = (uri, text) => setTimeout(() => send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: text.split('\\n').flatMap((line, i) => line.includes('oops') ? [{ range: { start: { line: i, character: line.indexOf('oops') }, end: { line: i, character: line.indexOf('oops') + 4 } }, severity: 1, message: 'Cannot find name oops.' }, { range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } }, severity: 2, message: 'Just a warning.' }] : []) } }), 30)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\\r\\n\\r\\n'); if (end === -1) return
    const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1]); if (buffer.length < end + 4 + length) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()); buffer = buffer.subarray(end + 4 + length)
    if (message.method === 'initialize') send({ id: message.id, result: { capabilities: {} } })
    if (message.method === 'textDocument/didOpen') publish(message.params.textDocument.uri, message.params.textDocument.text)
    if (message.method === 'textDocument/didChange') publish(message.params.textDocument.uri, message.params.contentChanges[0].text)
  }
})
`
    )
    await chmod(server, 0o755)
    const lsp = new CoderLsp()
    try {
      expect(await lsp.problems(root, 'a.ts')).toBe('')
      await writeFile(join(root, 'a.ts'), 'export const one = 1\nconst two = oops\n')
      // Errors only: the warning stays out.
      expect(await lsp.problems(root, 'a.ts')).toBe('a.ts:2:13: Cannot find name oops.')
      expect(await lsp.problems(root, '../outside.ts')).toBe('')
    } finally {
      lsp.dispose()
    }
  })
})

describe('/doctor', () => {
  const status = (patch: Partial<CoderStatus> = {}): CoderStatus => ({ folder: root, ready: true, model: 'claude-sonnet-5-5', providerName: 'Anthropic', hosted: false, running: false, git: true, branch: 'main', sandboxAvailable: false, devContainer: false, ...patch })
  const github = async (): Promise<CoderGithubStatus> => ({ source: null, login: null, cliReady: false, scopes: null, project: 'no-remote', folder: root, repo: null, remote: null, error: null, deviceFlow: false })
  it('says what works, what’s missing, and what to do', async () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, coderFolder: root }
    const broken: McpServerView = { name: 'linear', type: 'http', target: 'https://mcp.linear.app', envKeys: [], source: 'person', enabled: true, trusted: true, state: 'error', error: 'It answered 500.', tools: [] } as unknown as McpServerView
    const items = await runDoctor({ settings, status: status(), github, mcp: async () => [broken], server: async () => ({ ok: true, message: 'Ready', node: 'v22', git: '2', system: null }) })
    const byLabel = Object.fromEntries(items.map((item) => [item.label, item]))
    expect(byLabel.Model).toMatchObject({ state: 'ok' })
    expect(byLabel.Project).toMatchObject({ state: 'ok' })
    expect(byLabel['Project notes']).toMatchObject({ state: 'off', detail: expect.stringContaining('/init') })
    expect(byLabel.GitHub).toMatchObject({ state: 'off' })
    expect(byLabel['MCP servers']).toMatchObject({ state: 'warn', detail: 'linear: It answered 500.' })
    expect(byLabel['Your server']).toBeUndefined()
    await writeFile(join(root, 'TERRA.md'), '# Notes\n')
    const again = await runDoctor({ settings: { ...settings, coderServer: 'me@box' }, status: status({ ready: false }), github, mcp: async () => [], server: async () => ({ ok: false, message: 'me@box didn’t answer.', node: null, git: null, system: null }) })
    const now = Object.fromEntries(again.map((item) => [item.label, item]))
    expect(now.Model).toMatchObject({ state: 'warn' })
    expect(now['Project notes']).toMatchObject({ state: 'ok', detail: expect.stringContaining('TERRA.md') })
    expect(now['Your server']).toMatchObject({ state: 'warn', detail: 'me@box didn’t answer.' })
  })
})

describe('runs on the person’s server, through CoderCloud', () => {
  it('starts there with the server’s settings, and follows it until it’s done', async () => {
    const store = new Map<string, unknown>()
    const calls: string[] = []
    let state: 'working' | 'done' = 'working'
    const server = {
      start: async (target: { host: string }, _folder: string, spec: { where?: string; pushTo?: string | null; sandbox?: string }) => (calls.push(`start ${target.host} ${spec.where} ${spec.pushTo} ${spec.sandbox}`), { warning: null }),
      status: async () => ({ state, summary: state === 'done' ? 'Wrote it.' : null, error: null, pushed: false, live: ['Write a.ts'] }),
      events: async () => [] as CoderEvent[],
      cancel: async () => undefined,
      fetch: async () => 'Fetched.'
    } as unknown as CoderServer
    const cloud = new CoderCloud({
      github: { access: () => 'off', call: async () => ({}) } as never,
      kv: { get: (key) => store.get(key), set: (key, value) => store.set(key, value) },
      runner: async () => '',
      model: async (_ref, where) => (calls.push(`model ${where}`), { model: { protocol: 'openai', baseUrl: 'https://example.com/v1', model: 'm', needsKey: false, firstParty: false }, secret: null }),
      server,
      serverSettings: () => ({ host: 'me@box:2222', push: false, sandbox: 'project' })
    })
    const run = await cloud.start('s1', root, 'Write a.ts', { pr: true, effort: null, where: 'server' })
    expect(run).toMatchObject({ where: 'server', host: 'me@box:2222', state: 'working', pr: false, trigger: '' })
    expect(calls).toEqual(['model server', 'start me@box server null project'])
    let [checked] = await cloud.check('s1')
    expect(checked).toMatchObject({ state: 'working', live: ['Write a.ts'] })
    state = 'done'
    ;[checked] = await cloud.check('s1')
    expect(checked).toMatchObject({ state: 'done', summary: 'Wrote it.' })
    expect(await cloud.fetchBranch('s1', run.id, root)).toBe('Fetched.')
    await expect(cloud.pr('s1', run.id)).rejects.toThrow(/kept this branch to itself/)
  })

  it('says why a GitHub run failed, from its log', async () => {
    const store = new Map<string, unknown>([['coder:cloud', { s1: [{ id: 'r1', repo: 'me/p', base: 'main', trigger: 'scterra-cloud/r1', branch: 'scterra/x-r1', task: 'x', pr: false, state: 'working', runId: null, runUrl: null, prUrl: null, summary: null, startedAt: 0, endedAt: null, error: null, warning: null } satisfies CoderCloudRun] }]])
    const github = {
      access: () => 'write',
      call: async (method: string, path: string) => {
        if (path.includes('/actions/runs?branch=')) return { workflow_runs: [{ id: 5, status: 'completed', conclusion: 'failure', html_url: 'https://github.com/me/p/actions/runs/5' }] }
        if (path.endsWith('/actions/runs/5/jobs')) return { jobs: [{ id: 9 }] }
        if (path.endsWith('/actions/jobs/9/logs')) return `2026-11-25T19:55:42Z [scterra-event] ${JSON.stringify({ type: 'error', message: 'scTerra AI stopped with an error: The AI service had a problem.' })}\n`
        if (method === 'DELETE') return {}
        throw new Error(`unexpected ${method} ${path}`)
      }
    }
    const cloud = new CoderCloud({ github: github as never, kv: { get: (key) => store.get(key), set: (key, value) => store.set(key, value) }, runner: async () => '', model: async () => ({ model: { protocol: 'openai', baseUrl: '', model: '', needsKey: false, firstParty: false }, secret: null }) })
    const [run] = await cloud.check('s1')
    expect(run).toMatchObject({ state: 'failed', error: 'It stopped: scTerra AI stopped with an error: The AI service had a problem.' })
  })
})
