import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLOUD_EVENT_MARK, CLOUD_TRIGGER_PREFIX, type CoderEvent } from '@scbrowser/shared'
import { Coder, githubRefused, type CoderGithubHost } from './coder'
import { branchFor, cloudWorkflow, CoderCloud, eventsFromLog, openSealed, sealForGithub } from './coderCloud'
import { CoderGithub, githubRepoOf, trimGithub } from './coderGithub'

let root = ''
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'coder-connect-')))
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

describe('questions from Terra Code', () => {
  it('waits for the answer and hands it to the model', async () => {
    const ask = { tool: 'ask', questions: [{ question: 'Which database?', header: 'Database', options: [{ label: 'SQLite' }, { label: 'Postgres' }] }] }
    const { coder, seen } = scripted([tool(ask), 'Using SQLite.'])
    const events: CoderEvent[] = []
    const run = coder.run('s', root, 'add a cache', 'edits', (event) => {
      events.push(event)
      if (event.type === 'question') {
        expect(coder.waitingSessions()).toEqual(['s'])
        setTimeout(() => coder.answerQuestion(event.id, [['SQLite']]), 5)
      }
    })
    await run
    const question = events.find((event) => event.type === 'question')
    expect(question && question.type === 'question' && question.questions[0]!.options.map((o) => o.label)).toEqual(['SQLite', 'Postgres'])
    expect(seen.at(-1)!.join('\n')).toContain('Which database?\n→ SQLite')
    expect(coder.waitingSessions()).toEqual([])
  })

  it('tells the model to decide when the person closes the questions', async () => {
    const { coder, seen } = scripted([tool({ tool: 'AskUserQuestion', question: 'Tabs or spaces?', options: ['Tabs', 'Spaces'] }), 'Spaces it is.'])
    await coder.run('s', root, 'format', 'edits', (event) => event.type === 'question' && coder.answerQuestion(event.id, null))
    expect(seen.at(-1)!.join('\n')).toContain('Decide sensibly yourself')
  })

  it('isn’t offered when nobody is watching, and is refused if tried', async () => {
    const { coder, seen } = scripted([tool({ tool: 'ask', questions: ['Which one?'] }), 'Picked one.'], { unattended: true })
    await coder.run('s', root, 'go', 'edits', () => undefined)
    expect(seen.at(-1)!.join('\n')).toContain("isn't watching")
  })
})

describe('the checklist, changed by the person', () => {
  it('reaches the model with the next message', async () => {
    const { coder, seen } = scripted(['Ok.', 'Ok again.'])
    await coder.run('s', root, 'first', 'edits', () => undefined)
    const events: CoderEvent[] = []
    await coder.setTodo('s', root, [{ text: 'Write tests', done: false }, { text: 'Read the code', done: true }], (event) => events.push(event))
    expect(events).toEqual([{ sessionId: 's', type: 'todo', items: [{ text: 'Write tests', done: false }, { text: 'Read the code', done: true }], by: 'person' }])
    await coder.run('s', root, 'second', 'edits', () => undefined)
    const sent = seen.at(-1)!.at(-1)!
    expect(sent).toContain('second')
    expect(sent).toContain('The person changed your checklist')
    expect(sent).toContain('- [ ] Write tests')
    expect(sent).toContain('- [x] Read the code')
    // Told once.
    await coder.run('s', root, 'third', 'edits', () => undefined)
    expect(seen.at(-1)!.at(-1)!).not.toContain('checklist')
  })

  it('reaches a run under way at its next step', async () => {
    let coder!: Coder
    const seen: string[][] = []
    coder = new Coder({
      chat: async (messages) => {
        seen.push(messages.map((m) => m.content))
        if (seen.length === 1) {
          await coder.setTodo('s', root, [{ text: 'Added by me', done: false }], () => undefined)
          return tool({ tool: 'read', path: 'a.txt' })
        }
        return 'Done.'
      }
    })
    await coder.run('s', root, 'go', 'edits', () => undefined)
    expect(seen[1]!.join('\n')).toContain('Added by me')
  })
})

/** A GitHub that answers from a table, and keeps what was asked. */
function fakeGithub(access: 'off' | 'read' | 'write' = 'write'): CoderGithubHost & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    access: () => access,
    repo: async () => 'me/project',
    request: async (method, path) => {
      calls.push(`${method} ${path}`)
      return { ok: true, status: 200, output: '200\n[{"number":1,"title":"Bug"}]' }
    }
  }
}

describe('GitHub from Terra Code', () => {
  it('looks freely, and tells the model which repository this is', async () => {
    const github = fakeGithub('read')
    const { coder, seen } = scripted([tool({ tool: 'github', method: 'GET', path: 'https://api.github.com/repos/me/project/issues?state=open' }), 'One bug.'], { github })
    const asked: CoderEvent[] = []
    await coder.run('s', root, 'what issues are open', 'ask', (event) => event.type === 'approval' && asked.push(event))
    expect(github.calls).toEqual(['GET /repos/me/project/issues?state=open'])
    expect(asked).toEqual([])
    expect(seen.at(-1)!.join('\n')).toContain('"title":"Bug"')
  })

  it('refuses changes when only looking is allowed', async () => {
    const github = fakeGithub('read')
    const { coder, seen } = scripted([tool({ tool: 'github', method: 'POST', path: '/repos/me/project/issues', body: { title: 'x' } }), 'Could not.'], { github })
    await coder.run('s', root, 'open an issue', 'edits', () => undefined)
    expect(github.calls).toEqual([])
    expect(seen.at(-1)!.join('\n')).toContain('Only GET works')
  })

  it('asks before each change, and respects a no', async () => {
    const github = fakeGithub('write')
    const { coder, seen } = scripted([tool({ tool: 'github', method: 'POST', path: '/repos/me/project/issues', body: { title: 'Flaky test' } }), 'Declined.'], { github })
    const asked: string[] = []
    await coder.run('s', root, 'open an issue', 'edits', (event) => {
      if (event.type !== 'approval') return
      asked.push(`${event.summary}\n${event.detail}`)
      coder.answer(event.id, 'deny')
    })
    expect(asked[0]).toContain('GitHub: POST /repos/me/project/issues')
    expect(asked[0]).toContain('Flaky test')
    expect(github.calls).toEqual([])
    expect(seen.at(-1)!.join('\n')).toContain('declined')
  })

  it('never reaches secrets or deletes a repository, whatever is approved', () => {
    expect(githubRefused('PUT', '/repos/a/b/actions/secrets/X')).toMatch(/secrets/)
    expect(githubRefused('DELETE', '/repos/a/b')).toMatch(/delete repositories/)
    expect(githubRefused('PATCH', '/repos/a/b')).toMatch(/settings/)
    expect(githubRefused('POST', '/repos/a/b/hooks')).toMatch(/webhooks/)
    expect(githubRefused('GET', '/repos/a/b/actions/secrets')).toBeNull()
    expect(githubRefused('POST', '/repos/a/b/pulls')).toBeNull()
    expect(githubRefused('DELETE', '/repos/a/b/issues/comments/3')).toBeNull()
  })

  it('isn’t offered while it’s off', async () => {
    const github = fakeGithub('off')
    const { coder, seen } = scripted([tool({ tool: 'github', method: 'GET', path: '/user' }), 'No.'], { github })
    await coder.run('s', root, 'who am i', 'edits', () => undefined)
    expect(seen[0]!.join('\n')).not.toContain('GitHub, which the person connected')
    expect(seen.at(-1)!.join('\n')).toContain("GitHub isn't connected")
  })
})

describe('the GitHub connection', () => {
  const store = () => {
    const values = new Map<string, unknown>()
    return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => void values.set(key, value), delete: (key: string) => void values.delete(key), values }
  }
  const answer = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

  it('reads owner/name from every kind of remote', () => {
    expect(githubRepoOf('git@github.com:sc-simpledev/scBrowser.git')).toBe('sc-simpledev/scBrowser')
    expect(githubRepoOf('https://github.com/a/b')).toBe('a/b')
    expect(githubRepoOf('https://token@github.com/a/b.git/')).toBe('a/b')
    expect(githubRepoOf('ssh://git@github.com/a/b.js.git')).toBe('a/b.js')
    expect(githubRepoOf('https://gitlab.com/a/b.git')).toBeNull()
    expect(githubRepoOf(null)).toBeNull()
  })

  it('keeps a pasted token sealed, and never the CLI’s', async () => {
    const kv = store()
    const asked: string[] = []
    const github = new CoderGithub({
      kv,
      access: () => 'read',
      seal: async (text) => `sealed:${text}`,
      unseal: async (text) => text.replace('sealed:', ''),
      cliToken: async () => 'gho_cli_token_1234567890',
      remote: async () => 'git@github.com:me/project.git',
      fetch: async (url, init) => {
        asked.push(`${String(url)} ${(init?.headers as Record<string, string>).Authorization}`)
        return answer({ login: 'me' }, { headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'repo, workflow' } })
      }
    })
    expect(github.access()).toBe('off')
    const status = await github.saveToken('github_pat_abcdefghijklmnopqrstuvwxyz', root)
    expect(status).toMatchObject({ source: 'token', login: 'me', repo: 'me/project', cliReady: true, scopes: ['repo', 'workflow'] })
    expect(JSON.stringify([...kv.values])).toContain('sealed:github_pat_')
    expect(github.access()).toBe('read')
    await github.useCli(root)
    expect(JSON.stringify([...kv.values])).not.toContain('gho_cli')
    expect(await github.token()).toBe('gho_cli_token_1234567890')
    expect(asked.at(-1)).toContain('Bearer gho_cli_token_1234567890')
    github.disconnect()
    expect(github.access()).toBe('off')
  })

  it('trims what only machines need, and cuts long answers with a hint', async () => {
    expect(trimGithub([{ number: 1, url: 'x', html_url: 'h', node_id: 'n', user: { login: 'me', avatar_url: 'a' }, labels_url: 'l' }])).toEqual([{ number: 1, html_url: 'h', user: 'me' }])
    const github = new CoderGithub({
      kv: { get: () => ({ source: 'cli', login: 'me' }), set: () => undefined },
      access: () => 'read',
      seal: async (t) => t,
      unseal: async (t) => t,
      cliToken: async () => 'gho_cli_token_1234567890',
      fetch: async () => answer([{ title: 'x'.repeat(70_000) }], { headers: { 'content-type': 'application/json', link: '<https://api.github.com/x?page=2>; rel="next"' } })
    })
    const result = await github.request('GET', '/repos/me/project/issues', null, new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(result.output).toContain('…(cut')
    expect(result.output).toContain('next page')
  })

  it('says what to do when GitHub refuses the workflow permission', async () => {
    const github = new CoderGithub({
      kv: { get: () => ({ source: 'cli', login: 'me' }), set: () => undefined },
      access: () => 'write',
      seal: async (t) => t,
      unseal: async (t) => t,
      cliToken: async () => 'gho_cli_token_1234567890',
      fetch: async () => answer({ message: 'refusing to allow an OAuth App to create or update workflow `.github/workflows/x.yml` without `workflow` scope' }, { status: 404 })
    })
    await expect(github.call('POST', '/repos/me/p/git/refs', {})).rejects.toThrow('gh auth refresh -s workflow')
  })
})

describe('cloud runs', () => {
  it('seals secrets the way GitHub opens them', () => {
    const keys = nacl.box.keyPair()
    const sealed = sealForGithub(Buffer.from(keys.publicKey).toString('base64'), '{"apiKey":"sk-123"}')
    expect(openSealed(sealed, keys.publicKey, keys.secretKey)).toBe('{"apiKey":"sk-123"}')
    expect(Buffer.from(sealed, 'base64').length).toBe(32 + 16 + '{"apiKey":"sk-123"}'.length)
  })

  it('makes a workflow that only runs on its own branch, and goes back to where it started', () => {
    const yaml = cloudWorkflow({ id: 'abcd1234', trigger: `${CLOUD_TRIGGER_PREFIX}abcd1234` })
    expect(yaml).toContain("branches: ['scterra-cloud/abcd1234']")
    expect(yaml).toContain('git reset --hard HEAD~1')
    expect(yaml).toContain('SCTERRA_AI_KEY: ${{ secrets.SCTERRA_AI_KEY }}')
    expect(branchFor('Add dark mode to the settings page, please!', 'abcd1234')).toBe('scterra/add-dark-mode-to-the-abcd1234')
    expect(branchFor('???', 'abcd1234')).toBe('scterra/abcd1234')
  })

  it('reads the runner’s events back from a job log', () => {
    const log = [
      '2026-11-20T01:00:00.0000000Z Setting up',
      `2026-11-20T01:00:01.0000000Z ${CLOUD_EVENT_MARK}{"type":"tool","id":"1","tool":"read","summary":"Read a.txt"}`,
      `2026-11-20T01:00:02.0000000Z ${CLOUD_EVENT_MARK}{"type":"text","text":"Done`,
      `2026-11-20T01:00:03.0000000Z ${CLOUD_EVENT_MARK}{"type":"done","reason":"finished"}`
    ].join('\n')
    expect(eventsFromLog(log, 'me')).toEqual([
      { sessionId: 'me', type: 'tool', id: '1', tool: 'read', summary: 'Read a.txt' },
      { sessionId: 'me', type: 'done', reason: 'finished' }
    ])
  })

  /** GitHub's API as a table of answers, keeping every call. */
  function fakeCloud(answers: Record<string, unknown>) {
    const calls: { method: string; path: string; body: unknown }[] = []
    const github = {
      access: () => 'write' as const,
      repo: async () => 'me/project',
      call: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body })
        const key = Object.keys(answers).find((pattern) => `${method} ${path}`.startsWith(pattern))
        if (!key) throw new Error(`Unexpected ${method} ${path}`)
        return answers[key]
      }
    }
    const kv = new Map<string, unknown>()
    let now = 1000
    const cloud = new CoderCloud({
      github: github as never,
      kv: { get: (key) => kv.get(key), set: (key, value) => void kv.set(key, value) },
      runner: async () => 'console.log("runner")',
      model: async () => ({ model: { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', needsKey: true, firstParty: true }, secret: '{"apiKey":"sk-test"}' }),
      now: () => (now += 1000)
    })
    return { cloud, calls }
  }

  it('starts from GitHub’s copy of the branch, with the key as a secret and three files in a trigger branch', async () => {
    const keys = nacl.box.keyPair()
    const { cloud, calls } = fakeCloud({
      'GET /repos/me/project/branches/': { commit: { sha: 'base123' } },
      'GET /repos/me/project/actions/secrets/public-key': { key_id: 'k1', key: Buffer.from(keys.publicKey).toString('base64') },
      'PUT /repos/me/project/actions/secrets/SCTERRA_AI_KEY': undefined,
      'GET /repos/me/project/git/commits/base123': { tree: { sha: 'tree0' } },
      'GET /repos/me/project': { default_branch: 'main', permissions: { push: true } },
      'POST /repos/me/project/git/blobs': { sha: 'blob' },
      'POST /repos/me/project/git/trees': { sha: 'tree1' },
      'POST /repos/me/project/git/commits': { sha: 'commit1' },
      'POST /repos/me/project/git/refs': {}
    })
    const run = await cloud.start('s', root, 'Fix the flaky test', { pr: true, effort: 'high' })
    expect(run).toMatchObject({ repo: 'me/project', base: 'main', state: 'queued', pr: true })
    expect(run.trigger).toBe(`${CLOUD_TRIGGER_PREFIX}${run.id}`)
    expect(run.branch).toBe(`scterra/fix-the-flaky-test-${run.id}`)
    const secret = calls.find((call) => call.method === 'PUT')!.body as { encrypted_value: string; key_id: string }
    expect(secret.key_id).toBe('k1')
    expect(openSealed(secret.encrypted_value, keys.publicKey, keys.secretKey)).toBe('{"apiKey":"sk-test"}')
    const tree = calls.find((call) => call.path.endsWith('/git/trees'))!.body as { base_tree: string; tree: { path: string }[] }
    expect(tree.base_tree).toBe('tree0')
    expect(tree.tree.map((entry) => entry.path)).toEqual(['.github/workflows/scterra-cloud.yml', '.scterra-cloud/runner.mjs', '.scterra-cloud/task.json'])
    const task = JSON.parse(Buffer.from((calls.filter((call) => call.path.endsWith('/git/blobs'))[2]!.body as { content: string }).content, 'base64').toString()) as Record<string, unknown>
    expect(task).toMatchObject({ task: 'Fix the flaky test', base: 'main', pr: true, effort: 'high', model: { model: 'claude-opus-5-5' } })
    expect(JSON.stringify(task)).not.toContain('sk-test')
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/repos/me/project/git/refs', body: { ref: `refs/heads/${run.trigger}`, sha: 'commit1' } })
    expect(cloud.runs('s')).toHaveLength(1)
  })

  it('follows the run to its end, reads the summary, cleans up and opens the pull request itself', async () => {
    const keys = nacl.box.keyPair()
    const answers: Record<string, unknown> = {
      'GET /repos/me/project/branches/': { commit: { sha: 'base123' } },
      'GET /repos/me/project/actions/secrets/public-key': { key_id: 'k1', key: Buffer.from(keys.publicKey).toString('base64') },
      'PUT /repos/me/project/actions/secrets/': undefined,
      'GET /repos/me/project/git/commits/': { tree: { sha: 'tree0' } },
      'POST /repos/me/project/git/': { sha: 'x' },
      'GET /repos/me/project/actions/runs': { workflow_runs: [{ id: 77, status: 'in_progress', conclusion: null, html_url: 'https://github.com/me/project/actions/runs/77' }] },
      'GET /repos/me/project/commits/': { commit: { message: 'Fix the flaky test\n\nThe test waited on a timer. It now waits for the event.' } },
      'GET /repos/me/project/pulls': [],
      'DELETE /repos/me/project/git/refs/heads/': undefined,
      'POST /repos/me/project/pulls': { html_url: 'https://github.com/me/project/pull/9' },
      'GET /repos/me/project': { default_branch: 'main' }
    }
    const { cloud, calls } = fakeCloud(answers)
    await cloud.start('s', root, 'Fix the flaky test', { pr: true, effort: null })
    expect((await cloud.check('s'))[0]).toMatchObject({ state: 'working', runId: 77 })
    answers['GET /repos/me/project/actions/runs'] = { workflow_runs: [{ id: 77, status: 'completed', conclusion: 'success', html_url: 'https://github.com/me/project/actions/runs/77' }] }
    const [done] = await cloud.check('s')
    expect(done).toMatchObject({ state: 'done', summary: 'The test waited on a timer. It now waits for the event.', prUrl: 'https://github.com/me/project/pull/9' })
    expect(calls.some((call) => call.method === 'DELETE' && call.path.includes(CLOUD_TRIGGER_PREFIX))).toBe(true)
    // Finished runs aren't asked about again.
    const before = calls.length
    await cloud.check('s')
    expect(calls.length).toBe(before)
  })

  it('refuses before touching GitHub when Terra Code may only look', async () => {
    const cloud = new CoderCloud({
      github: { access: () => 'read' } as never,
      kv: { get: () => undefined, set: () => undefined },
      runner: async () => '',
      model: async () => ({ model: { protocol: 'openai', baseUrl: 'x', model: 'm', needsKey: false, firstParty: false }, secret: null })
    })
    await expect(cloud.start('s', root, 'x', { pr: false, effort: null })).rejects.toThrow('look and act')
  })
})
