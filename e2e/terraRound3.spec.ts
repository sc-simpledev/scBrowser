import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import nacl from 'tweetnacl'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, serveSite, setSetting, type Harness } from './app'

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
  /** Checked in order, first match wins, so a test can put its own in front. */
  routes: [string, RegExp, unknown, number?][]
}

/** Enough of GitHub's API for connecting, the github tool and a cloud run that finishes straight away. */
async function startGithub(): Promise<FakeGithub> {
  const keys = nacl.box.keyPair()
  const fake: FakeGithub = { url: '', server: null!, calls: [], routes: [] }
  fake.routes = [
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
    ['POST', /^\/repos\/me\/project\/pulls$/, { html_url: 'https://github.com/me/project/pull/7' }, 201],
    ['GET', /^\/user\/repos/, [{ full_name: 'me/project', description: 'The project', private: true, pushed_at: '2026-11-19T00:00:00Z' }, { full_name: 'me/other', description: '', private: false, pushed_at: '2026-10-01T00:00:00Z' }]],
    ['PATCH', /^\/repos\/me\/project\/actions\/variables\/SCTERRA_MODEL$/, '', 404],
    ['POST', /^\/repos\/me\/project\/actions\/variables$/, '', 201],
    ['GET', /^\/repos\/me\/project\/contents\//, { message: 'Not Found' }, 404],
    ['PUT', /^\/repos\/me\/project\/contents\//, { content: {} }, 201],
    ['GET', /^\/repos\/me\/project\/commits\/scterra-cloud%2F[0-9a-f]+\/check-runs/, { check_runs: [] }]
  ]
  fake.server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const path = req.url ?? ''
      const text = Buffer.concat(chunks).toString()
      fake.calls.push({ method: req.method ?? '', path, body: text ? JSON.parse(text) : null, auth: String(req.headers.authorization ?? '') })
      const route = fake.routes.find(([method, pattern]) => method === req.method && pattern.test(path))
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
    // Commits need a name and address, which CI's machine doesn't have.
    run('config', 'user.name', 'Test')
    run('config', 'user.email', 'test@example.com')
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


const connectGithub = async (page: Page, write = true) => {
  const panel = await showPanel(page)
  await panel.getByRole('tab', { name: 'Settings' }).click()
  const settings = panel.getByRole('region', { name: 'Terra Code settings' })
  await settings.getByRole('button', { name: /GitHub\s*Not connected/ }).click()
  await settings.getByRole('button', { name: 'Paste a token' }).click()
  await settings.getByRole('textbox', { name: 'GitHub token' }).fill('github_pat_testtokentesttokentest1234')
  await settings.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(settings).toContainText('Signed in as @tester')
  if (write) await settings.getByRole('radio', { name: /Look and act/ }).click()
  return { panel, settings }
}

test('a new project is set up from one card: safe commands and writing TERRA.md', async () => {
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 1', build: 'node -e 2', dev: 'vite' }, devDependencies: { typescript: '5' } }))
  const page = await open()
  const card = page.getByRole('region', { name: 'Set up this project' })
  await expect(card).toContainText('TypeScript')
  await expect(card.getByRole('checkbox', { name: 'npm test*' })).toHaveAttribute('aria-checked', 'true')
  await card.getByRole('checkbox', { name: 'npm run build*' }).click()
  mock!.queue.push('Wrote TERRA.md.')
  await card.getByRole('button', { name: 'Set up' }).click()
  await expect(page.getByText('Wrote TERRA.md.')).toBeVisible()
  expect(sent()).toContain('write TERRA.md')
  const rules = await page.evaluate(() => (window as any).scbInternal.invoke('coder:setup'))
  expect(rules.rules.allow).toEqual(['npm test*'])
  await expect(card).toHaveCount(0)
})

test('/review #12 and /fix-ci become GitHub tasks, and more starters are offered', async () => {
  const page = await open({ git: true })
  await expect(page.getByRole('button', { name: /Upgrade dependencies/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Add tests/ })).toBeVisible()
  mock!.queue.push('Reviewed.', 'Fixed.')
  await say(page, '/review #12')
  await expect(page.getByText('Reviewed.')).toBeVisible()
  expect(sent()).toContain('pull request #12')
  await say(page, '/fix-ci')
  await expect(page.getByText('Fixed.')).toBeVisible()
  expect(sent()).toContain('actions/runs?branch=main')
})

test('a commit that would include a key stops and offers to go ahead anyway', async () => {
  const page = await open({ git: true })
  mock!.queue.push(tool({ tool: 'write', path: 'config.ts', content: `export const key = 'sk-ant-${'a'.repeat(40)}'\n` }), 'Added the key.', 'Add config')
  await say(page, 'add the config')
  await expect(page.getByText('Added the key.')).toBeVisible()
  const panel = await showPanel(page)
  await panel.getByRole('button', { name: 'Commit' }).click()
  const commit = page.getByRole('region', { name: 'Commit' })
  await commit.getByRole('textbox', { name: 'Commit message' }).fill('Add config')
  await commit.getByRole('button', { name: 'Commit', exact: true }).click()
  await expect(commit).toContainText('Possible secret in what would be committed: config.ts:1 (an AI provider key)')
  await commit.getByRole('button', { name: 'Commit anyway' }).click()
  await expect(page.getByText(/^Committed [0-9a-f]+ Add config\.$/)).toBeVisible()
})

test('in a narrow window the floating session panel steps aside for the commit it starts', async () => {
  const page = await open({ git: true })
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 700))
  // The window manager takes a moment to apply the new size.
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(800)
  mock!.queue.push(tool({ tool: 'write', path: 'notes.md', content: 'Notes\n' }), 'Added notes.', 'Add notes')
  await say(page, 'add notes')
  await expect(page.getByText('Added notes.')).toBeVisible()
  const panel = await showPanel(page)
  await panel.getByRole('button', { name: 'Commit' }).click()
  await expect(panel).toHaveCount(0)
  const commit = page.getByRole('region', { name: 'Commit' })
  await commit.getByRole('textbox', { name: 'Commit message' }).fill('Add notes')
  await commit.getByRole('button', { name: 'Commit', exact: true }).click()
  await expect(page.getByText(/^Committed [0-9a-f]+ Add notes\.$/)).toBeVisible()
})

test('a budget shows how much of it a session has used', async () => {
  const page = await open()
  await setSetting(h, { coderBudget: 200_000 })
  mock!.queue.push('First answer.')
  await say(page, 'hello')
  await expect(page.getByText('First answer.')).toBeVisible()
  const panel = await showPanel(page)
  await expect(panel.getByRole('meter', { name: 'Budget used' })).toBeVisible()
})

test('GitHub repositories can be cloned from, and Terra Code installed on GitHub through a pull request', async () => {
  const page = await open({ git: true })
  const { settings } = await connectGithub(page)
  await settings.getByRole('button', { name: /On GitHub\s*Not installed/ }).click()
  await settings.getByRole('button', { name: 'Add a scheduled task' }).click()
  await settings.getByRole('textbox', { name: 'Task' }).fill('Update dependencies that are safe to move')
  await settings.getByRole('combobox', { name: 'How often' }).selectOption('week')
  await settings.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(settings).toContainText('Every Monday at 9:00')
  await settings.getByRole('button', { name: 'Install on GitHub' }).click()
  await expect(settings.getByRole('button', { name: 'Its pull request' })).toBeVisible()
  const put = github!.calls.find((call) => call.method === 'PUT' && call.path.includes('/contents/'))!.body as { content: string; branch: string }
  const yaml = Buffer.from(put.content, 'base64').toString()
  expect(yaml).toContain('issue_comment:')
  expect(yaml).toContain('Update dependencies that are safe to move')
  expect(put.branch).toMatch(/^scterra\/install-/)
  expect(github!.calls.some((call) => call.method === 'POST' && call.path.endsWith('/actions/variables'))).toBe(true)
  expect(github!.calls.some((call) => call.method === 'POST' && call.path.endsWith('/pulls'))).toBe(true)

  // Clone: with no folder, the repositories are listed.
  await setSetting(h, { coderFolder: '' })
  const fresh = await h.page('sc://assistant')
  await fresh.reload()
  await fresh.getByRole('button', { name: 'Clone from GitHub' }).click()
  const clone = fresh.getByRole('region', { name: 'Clone from GitHub' })
  await expect(clone.getByRole('list', { name: 'Repositories' })).toContainText('me/project')
  await clone.getByRole('textbox', { name: 'Find a repository' }).fill('other')
  await expect(clone.getByRole('listitem')).toHaveCount(1)
})

test('a cloud run shows its latest steps while it works, and carries on here when done', async () => {
  const page = await open({ git: true })
  const { panel } = await connectGithub(page)
  // Working at first, with steps in its check run; then done.
  const steps = ['[scterra-event] {"type":"tool","id":"1","tool":"read","summary":"Read login.test.ts"}', '[scterra-event] {"type":"tool","id":"2","tool":"edit","summary":"Edit login.test.ts"}'].join('\n')
  const working: [string, RegExp, unknown, number?][] = [
    ['GET', /^\/repos\/me\/project\/actions\/runs\?/, { workflow_runs: [{ id: 99, status: 'in_progress', conclusion: null, html_url: 'https://github.com/me/project/actions/runs/99' }] }],
    ['GET', /\/check-runs/, { check_runs: [{ output: { text: steps } }] }]
  ]
  github!.routes.unshift(...working)
  await panel.getByRole('tab', { name: 'Session' }).click()
  await panel.getByRole('button', { name: /Runs on/ }).click()
  await panel.getByRole('radio', { name: /GitHub Actions/ }).click()
  await say(page, 'Fix the flaky login test')
  const card = page.getByRole('region', { name: 'Cloud run' })
  await expect(card.getByRole('list', { name: 'Latest steps' })).toContainText('Edit login.test.ts')
  github!.routes.splice(0, working.length)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(card).toContainText('Finished in the cloud')
  mock!.queue.push('Picking up from the cloud run.')
  await card.getByRole('button', { name: 'Continue here' }).click()
  await expect(page.getByText(/Carrying on here/)).toBeVisible()
  await say(page, 'what did it do?')
  await expect(page.getByText('Picking up from the cloud run.')).toBeVisible()
  expect(sent()).toContain('this task went to Terra Code in the cloud')
  expect(sent()).toContain('The login test now waits for the redirect')
})

test('the tab sidebar can hide until the pointer reaches the edge, and take a colour', async () => {
  h = await launch()
  await setSetting(h, { tabLayout: 'vertical', sidebarColor: '#7d86d9' })
  const sidebar = h.chrome.getByRole('complementary', { name: 'Sidebar' })
  await expect(sidebar).toBeVisible()
  expect(await sidebar.evaluate((element) => (element as HTMLElement).style.background)).toContain('color-mix')
  await setSetting(h, { sidebarAutoHide: true })
  await expect(sidebar).toHaveCount(0)
  const edge = h.chrome.getByTestId('sidebar-edge')
  await edge.dispatchEvent('mouseover')
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('tab').first()).toBeVisible()
  await sidebar.dispatchEvent('mouseout')
  await expect(sidebar).toHaveCount(0)
  // Clicking into the page takes focus from the browser's own view, which hides it too.
  await edge.dispatchEvent('mouseover')
  await expect(sidebar).toBeVisible()
  await h.chrome.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(sidebar).toHaveCount(0)
  // In Settings, with tabs down the side.
  await go(h, 'sc://settings/#tabs')
  const settings = await h.page('sc://settings')
  await settings.getByRole('radio', { name: 'Sage' }).click()
  await expect.poll(() => h.chrome.evaluate(() => (window as any).scb.invoke('settings:get').then((s: { sidebarColor: string }) => s.sidebarColor))).toBe('#6fae7f')
})

test('the chat uses MCP tools after asking, looks at the page, and a sent message can be edited', async () => {
  const site = await serveSite({ '/shop': '<!doctype html><title>Shop</title><h1>Lamps</h1><table><tr><th>Item</th><th>Price</th></tr><tr><td>Desk lamp</td><td>$20</td></tr></table><button>Buy now</button><label>Quantity <input value="2"></label><input type="password" name="password" value="hunter2">' })
  try {
    const page = await open()
    await page.evaluate((server) => (window as any).scbInternal.invoke('coder:mcp-save', { name: 'fake', type: 'stdio', command: 'node', args: [server], env: {}, enabled: true }), resolve(__dirname, 'fixtures/mcp/server.mjs'))
    await go(h, 'sc://assistant')
    const chat = await h.page('sc://assistant')
    mock!.toolQueue.push([JSON.stringify({ words: 'hello' })])
    mock!.toolNames.push('mcp__fake__shout')
    mock!.queue.push('It shouted HELLO!')
    await chat.getByRole('textbox', { name: 'Message the assistant' }).fill('Shout hello with the fake server')
    await chat.getByRole('button', { name: 'Send' }).click()
    const ask = chat.getByRole('group', { name: 'Use shout from fake?' })
    await expect(ask).toBeVisible()
    expect(JSON.stringify(mock!.requests.at(-1)!.body.tools)).toContain('mcp__fake__shout')
    await ask.getByRole('button', { name: 'Allow' }).click()
    await expect(chat.getByText('It shouted HELLO!')).toBeVisible()
    await expect(chat.getByText('Used shout from fake')).toBeVisible()
    expect(sent()).toContain('HELLO!')

    // Edit: back in the box, and the conversation goes back to before it.
    await chat.getByRole('log', { name: 'Conversation' }).getByText('Shout hello with the fake server').hover()
    await chat.getByRole('button', { name: 'Edit this message' }).click()
    await expect(chat.getByRole('textbox', { name: 'Message the assistant' })).toHaveValue('Shout hello with the fake server')
    await expect(chat.getByText('It shouted HELLO!')).toHaveCount(0)

    // The side panel reads the whole page, and can look at it.
    await go(h, site.url('/shop'))
    await h.chrome.getByRole('button', { name: 'Assistant' }).click()
    const sidePanel = h.chrome.getByRole('complementary', { name: 'Assistant' })
    mock!.toolQueue.push(['{}'])
    mock!.toolNames.push('look_at_page')
    mock!.queue.push('A desk lamp for $20.')
    await sidePanel.getByRole('textbox', { name: 'Message the assistant' }).fill('What is for sale?')
    await sidePanel.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
    await expect(sidePanel.getByText('A desk lamp for $20.')).toBeVisible()
    const first = JSON.stringify(mock!.requests.at(-2)!.body.messages)
    expect(first).toContain('| Desk lamp | $20 |')
    expect(first).toContain('[button: Buy now]')
    expect(first).toContain('Quantity')
    expect(first).toContain('On screen now')
    expect(first).not.toContain('hunter2')
    expect(JSON.stringify(mock!.requests.at(-1)!.body.messages)).toContain('data:image/jpeg;base64,')
    await expect(sidePanel.getByText('Looked at the page')).toBeVisible()
  } finally {
    site.server.close()
  }
})

test('a project folder that isn’t on GitHub is linked to an existing repository from the GitHub steps', async () => {
  const page = await open()
  await expect(page.getByText('GitHub isn’t connected.')).toBeVisible()
  const { settings } = await connectGithub(page, false)
  await expect(settings.getByRole('list', { name: 'Connecting GitHub' }).first()).toBeVisible()
  await expect(settings).toContainText('isn’t on GitHub yet')
  await settings.getByRole('button', { name: 'Link to an existing one' }).click()
  const picker = settings.getByRole('region', { name: 'Link to a repository' })
  await picker.getByRole('button', { name: /me\/project/ }).click()
  await expect(settings).toContainText('This project is me/project on GitHub.')
  await expect(settings).toContainText('Linked to me/project')
  // The start screen's line follows without a reload.
  await expect(page.getByText('On GitHub as')).toContainText('me/project')
  expect(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: folder, encoding: 'utf8' }).trim()).toBe('https://github.com/me/project.git')
})

test('Create a repository makes one on GitHub and links the folder to it', async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder })
  const page = await open()
  const { settings } = await connectGithub(page, false)
  github!.routes.unshift(['POST', /^\/user\/repos$/, { full_name: 'tester/fresh' }, 201])
  await settings.getByRole('button', { name: 'Create a repository' }).click()
  const name = settings.getByRole('textbox', { name: 'Repository name' })
  await expect(name).toHaveValue(folder.split('/').at(-1)!)
  await name.fill('fresh')
  await settings.getByRole('button', { name: 'Create and push' }).click()
  await expect(settings).toContainText('This project is tester/fresh on GitHub.')
  await expect(settings).toContainText('Made tester/fresh. It’s empty until your first commit is pushed')
  expect(github!.calls.find((call) => call.method === 'POST' && call.path === '/user/repos')?.body).toEqual({ name: 'fresh', private: true, auto_init: false })
  expect(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: folder, encoding: 'utf8' }).trim()).toBe('https://github.com/tester/fresh.git')
})
