import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import nacl from 'tweetnacl'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, setSetting, type Harness } from './app'

let h: Harness
let mock: AiMock | null = null
let github: FakeGithub | null = null
let folder = ''

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'scb-connect-'))
  writeFileSync(join(folder, 'a.txt'), 'hello\n')
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  for (const server of [mock?.server, github?.server]) {
    server?.closeAllConnections()
    server?.close()
  }
  mock = null
  github = null
  rmSync(folder, { recursive: true, force: true })
})

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``
const sent = (index = -1) => JSON.stringify(mock!.requests.at(index)!.body.messages)

interface FakeGithub {
  url: string
  server: Server
  calls: { method: string; path: string; body: unknown; auth: string }[]
}

/** Enough of GitHub's API for connecting, the github tool and a cloud run that finishes straight away. */
async function startGithub(): Promise<FakeGithub> {
  const keys = nacl.box.keyPair()
  const fake: FakeGithub = { url: '', server: null!, calls: [] }
  const routes: [string, RegExp, unknown, number?][] = [
    ['GET', /^\/user$/, { login: 'tester' }],
    ['GET', /^\/repos\/me\/project\/issues/, [{ number: 4, title: 'Flaky login test', state: 'open', url: 'x', node_id: 'y' }]],
    ['GET', /^\/repos\/me\/project$/, { default_branch: 'main', permissions: { push: true } }],
    ['GET', /^\/repos\/me\/project\/branches\/main$/, { commit: { sha: 'base123' } }],
    ['GET', /^\/repos\/me\/project\/actions\/secrets\/public-key$/, { key_id: 'k1', key: Buffer.from(keys.publicKey).toString('base64') }],
    ['PUT', /^\/repos\/me\/project\/actions\/secrets\/SCTERRA_AI_KEY$/, '', 201],
    ['GET', /^\/repos\/me\/project\/git\/commits\/base123$/, { tree: { sha: 'tree0' } }],
    ['POST', /^\/repos\/me\/project\/git\/(blobs|trees|commits)$/, { sha: 'new1' }, 201],
    ['POST', /^\/repos\/me\/project\/git\/refs$/, { ref: 'x' }, 201],
    ['GET', /^\/repos\/me\/project\/actions\/runs\?/, { workflow_runs: [{ id: 99, status: 'completed', conclusion: 'success', html_url: 'https://github.com/me/project/actions/runs/99' }] }],
    ['GET', /^\/repos\/me\/project\/commits\//, { commit: { message: 'Fix the flaky test\n\nThe login test now waits for the redirect before checking.' } }],
    ['GET', /^\/repos\/me\/project\/pulls\?/, []],
    ['DELETE', /^\/repos\/me\/project\/git\/refs\/heads\//, '', 204],
    ['POST', /^\/repos\/me\/project\/pulls$/, { html_url: 'https://github.com/me/project/pull/7' }, 201]
  ]
  fake.server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const path = req.url ?? ''
      const text = Buffer.concat(chunks).toString()
      fake.calls.push({ method: req.method ?? '', path, body: text ? JSON.parse(text) : null, auth: String(req.headers.authorization ?? '') })
      const route = routes.find(([method, pattern]) => method === req.method && pattern.test(path))
      if (!route) return void res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}')
      const [, , body, status = 200] = route
      res.writeHead(status, { 'content-type': 'application/json', 'x-oauth-scopes': 'repo, workflow' })
      res.end(body === '' ? '' : JSON.stringify(body))
    })
  })
  await new Promise<void>((done) => fake.server.listen(0, '127.0.0.1', done))
  fake.url = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`
  return fake
}

async function open({ git = false }: { git?: boolean } = {}): Promise<Page> {
  if (git) {
    const run = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
    run('init', '-q', '-b', 'main')
    run('remote', 'add', 'origin', 'https://github.com/me/project.git')
    run('add', '.')
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  }
  github = await startGithub()
  h = await launch(undefined, [], { SCB_GITHUB_API: github.url })
  mock = await startAiMock()
  await go(h, 'sc://ai')
  const ai = await h.page('sc://ai')
  await ai.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await ai.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await ai.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await ai.getByRole('combobox', { name: 'API format' }).selectOption('openai')
  await ai.getByRole('textbox', { name: 'API key' }).fill('test-key-not-real-12345')
  await ai.getByRole('button', { name: 'Add provider' }).click()
  await expect(ai.getByText('Connected, 1 model available')).toBeVisible()
  await ai.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')
  await setSetting(h, { coderFolder: folder, coderMode: 'edits', saveChats: true, coderNotify: false })
  // Wide enough for the session panel to sit beside the conversation, before the screen lays itself out.
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1480, 920))
  await go(h, 'sc://assistant/?mode=code')
  return h.page('sc://assistant')
}

const box = (page: Page) => page.getByRole('textbox', { name: 'Describe a change' })
async function say(page: Page, text: string) {
  await box(page).fill(text)
  await box(page).press('Enter')
}
const showPanel = async (page: Page) => {
  const panel = page.getByRole('complementary', { name: 'Session' })
  const show = page.getByRole('button', { name: 'Show the session panel' })
  // The screen may still be loading: wait for one or the other.
  await expect(panel.or(show).first()).toBeVisible()
  if (!(await panel.isVisible())) await show.click()
  await expect(panel).toBeVisible()
  return panel
}

test('the checklist can be ticked, renamed, added to and trimmed, and Terra Code hears about it', async () => {
  const page = await open()
  mock!.queue.push(tool({ tool: 'todo', items: [{ text: 'Read a.txt', status: 'completed' }, { text: 'Change the greeting', status: 'in_progress' }, { text: 'Run the tests', status: 'pending' }] }), 'Planned.', 'Following your list.')
  await say(page, 'plan the change')
  await expect(page.getByText('Planned.')).toBeVisible()
  const panel = await showPanel(page)
  const list = panel.getByRole('region', { name: 'Checklist' })
  await expect(list).toContainText('1 of 3')
  await list.getByRole('button', { name: 'Mark done: Change the greeting' }).click()
  await expect(list).toContainText('2 of 3')
  await list.getByRole('button', { name: 'Remove step: Run the tests' }).click()
  await list.getByRole('button', { name: 'Add a step' }).click()
  await list.getByRole('textbox', { name: 'New step' }).fill('Update the README')
  await list.getByRole('textbox', { name: 'New step' }).press('Enter')
  await list.getByRole('button', { name: 'Edit step: Update the README' }).click()
  await list.getByRole('textbox', { name: 'Step' }).fill('Update the README too')
  await list.getByRole('textbox', { name: 'Step' }).press('Enter')
  await expect(list).toContainText('Update the README too')
  await expect(list).not.toContainText('Run the tests')
  // /todo adds one from the message box.
  await say(page, '/todo Check the spelling')
  await expect(list).toContainText('Check the spelling')
  await expect(list).toContainText('2 of 4')

  await say(page, 'carry on')
  await expect(page.getByText('Following your list.')).toBeVisible()
  // What it was told with this message; its own earlier list stays in the conversation, as it should.
  const told = (mock!.requests.at(-1)!.body.messages ?? []).at(-1)!.content
  expect(told).toContain('The person changed your checklist')
  expect(told).toContain('- [x] Change the greeting')
  expect(told).toContain('- [ ] Update the README too')
  expect(told).toContain('- [ ] Check the spelling')
  expect(told).not.toContain('Run the tests')
})

test('Terra Code asks a question with choices, and the answer reaches it', async () => {
  const page = await open()
  mock!.queue.push(
    tool({ tool: 'ask', questions: [{ question: 'Which greeting should a.txt have?', header: 'Greeting', options: [{ label: 'Hi', description: 'Short and friendly' }, { label: 'Good day', description: 'A little formal' }] }] }),
    'Changed it to Good day.'
  )
  await say(page, 'change the greeting')
  const card = page.getByRole('group', { name: 'Terra Code is asking' })
  await expect(card).toContainText('Which greeting should a.txt have?')
  await expect(card.getByRole('button', { name: 'Answer' })).toBeDisabled()
  await card.getByRole('radio', { name: /Good day/ }).click()
  await card.getByRole('button', { name: 'Answer' }).click()
  await expect(page.getByText('Changed it to Good day.')).toBeVisible()
  expect(sent()).toContain('Which greeting should a.txt have?\\n→ Good day')
  await expect(page.getByRole('region', { name: 'Your answers' })).toContainText('Good day')
  await expect(card).toHaveCount(0)
})

test('scAI asks with buttons in the chat, and the pick goes back as the next message', async () => {
  const page = await open()
  await go(h, 'sc://assistant')
  const chat = await h.page('sc://assistant')
  // A model with tool calling asks through its tool; the reply ends there.
  mock!.toolQueue.push([JSON.stringify({ questions: [{ question: 'Which trip should I plan?', header: 'Trip', options: [{ label: 'A weekend', description: 'Two nights' }, { label: 'A week', description: 'Seven nights' }] }] })])
  mock!.toolNames.push('ask_user')
  await chat.getByRole('textbox', { name: 'Message the assistant' }).fill('Plan me a trip')
  await chat.getByRole('button', { name: 'Send' }).click()
  const card = chat.getByRole('group', { name: 'scAI is asking' })
  await expect(card).toContainText('Which trip should I plan?')
  expect(mock!.requests.at(-1)!.body.tools?.map((one) => one.function?.name)).toContain('ask_user')
  mock!.queue.push('A week in Tasmania, then.')
  await card.getByRole('radio', { name: /^A week Seven/ }).click()
  await card.getByRole('textbox', { name: 'Your own answer' }).fill('somewhere cold')
  await card.getByRole('button', { name: 'Answer' }).click()
  await expect(chat.getByText('A week in Tasmania, then.')).toBeVisible()
  expect(sent()).toContain('A week')
  expect(sent()).toContain('somewhere cold')
  void page
})

test('GitHub connects with a token, Terra Code looks at issues, and a cloud run goes to GitHub Actions', async () => {
  // A long walk through three features; under a full parallel run it needs more than the default.
  test.setTimeout(60_000)
  const page = await open({ git: true })
  const panel = await showPanel(page)
  await panel.getByRole('tab', { name: 'Settings' }).click()
  const settings = panel.getByRole('region', { name: 'Terra Code settings' })
  await settings.getByRole('button', { name: /GitHub\s*Not connected/ }).click()
  await settings.getByRole('button', { name: 'Paste a token' }).click()
  await settings.getByRole('textbox', { name: 'GitHub token' }).fill('github_pat_testtokentesttokentest1234')
  await settings.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(settings).toContainText('Signed in as @tester')
  await expect(settings).toContainText('me/project')
  await expect(settings.getByRole('radio', { name: /Look only/ })).toHaveAttribute('aria-checked', 'true')
  expect(github!.calls.find((call) => call.path === '/user')?.auth).toBe('Bearer github_pat_testtokentesttokentest1234')

  // Looking needs no asking.
  mock!.queue.push(tool({ tool: 'github', method: 'GET', path: '/repos/me/project/issues?state=open&per_page=5' }), 'One open issue: the flaky login test.')
  await say(page, 'what issues are open?')
  await expect(page.getByText('One open issue: the flaky login test.')).toBeVisible()
  expect(sent()).toContain('Flaky login test')
  expect(sent()).not.toContain('node_id')

  // The cloud needs Look and act.
  await panel.getByRole('tab', { name: 'Session' }).click()
  await panel.getByRole('button', { name: /Runs on\s*This computer/ }).click()
  await expect(panel.getByRole('radio', { name: /Cloud/ })).toBeDisabled()
  await expect(panel).toContainText('Let Terra Code look and act on GitHub')
  await panel.getByRole('button', { name: 'Open settings' }).click()
  await settings.getByRole('radio', { name: /Look and act/ }).click()
  await panel.getByRole('tab', { name: 'Session' }).click()
  // The row stays open from before.
  await expect(panel.getByRole('button', { name: /Runs on/ })).toHaveAttribute('aria-expanded', 'true')
  await panel.getByRole('radio', { name: /Cloud/ }).click()
  await expect(panel.getByRole('button', { name: /Runs on\s*Cloud/ })).toBeVisible()

  const before = mock!.requests.length
  await say(page, 'Fix the flaky login test')
  const card = page.getByRole('region', { name: 'Cloud run' })
  await expect(card).toContainText('Finished in the cloud')
  await expect(card).toContainText('The login test now waits for the redirect before checking.')
  await expect(card).toContainText('from main')
  await expect(card.getByRole('button', { name: 'Open pull request' })).toBeVisible()
  // Nothing ran here: the model was never asked on this computer.
  expect(mock!.requests.length).toBe(before)
  const tree = github!.calls.find((call) => call.path.endsWith('/git/trees'))!.body as { tree: { path: string }[] }
  expect(tree.tree.map((entry) => entry.path)).toEqual(['.github/workflows/scterra-cloud.yml', '.scterra-cloud/runner.mjs', '.scterra-cloud/task.json'])
  expect(github!.calls.some((call) => call.method === 'PUT' && call.path.endsWith('/SCTERRA_AI_KEY'))).toBe(true)
  expect(JSON.stringify(github!.calls.filter((call) => call.method !== 'PUT'))).not.toContain('test-key-not-real')
  expect(github!.calls.some((call) => call.method === 'POST' && call.path.endsWith('/pulls'))).toBe(true)
})
