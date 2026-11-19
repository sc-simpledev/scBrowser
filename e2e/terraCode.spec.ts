import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, serveSite, setSetting, titled, type Harness } from './app'

let h: Harness
let mock: AiMock | null = null
let folder = ''

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'scb-terra-'))
  writeFileSync(join(folder, 'a.txt'), 'hello\n')
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  if (mock) {
    mock.server.closeAllConnections()
    mock.server.close()
    mock = null
  }
  rmSync(folder, { recursive: true, force: true })
})

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``
const sent = (index = -1) => JSON.stringify(mock!.requests.at(index)!.body.messages)

async function open(mode: 'ask' | 'edits' = 'ask'): Promise<Page> {
  h = await launch()
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
  await setSetting(h, { coderFolder: folder, coderMode: mode, saveChats: true, coderNotify: false })
  await go(h, 'sc://assistant/?mode=code')
  return h.page('sc://assistant')
}

const box = (page: Page) => page.getByRole('textbox', { name: 'Describe a change' })
async function say(page: Page, text: string) {
  await box(page).fill(text)
  await box(page).press('Enter')
}

test('slash commands are listed as you type, and @ attaches a file', async () => {
  const page = await open()
  await box(page).fill('/')
  const commands = page.getByRole('listbox', { name: 'Commands' })
  await expect(commands.getByRole('option', { name: /\/init/ })).toBeVisible()
  await box(page).pressSequentially('he')
  await expect(commands.getByRole('option')).toHaveCount(1)
  await box(page).press('Enter')
  await expect(page.getByText('shows commands')).toBeVisible()

  mock!.queue.push('It says hello.')
  await box(page).fill('what is in ')
  await box(page).pressSequentially('@a.t')
  await page.getByRole('listbox', { name: 'Files and tabs' }).getByRole('option', { name: /a\.txt/ }).waitFor()
  await box(page).press('Enter')
  await expect(box(page)).toHaveValue('what is in @a.txt ')
  await box(page).press('Enter')
  await expect(page.getByText('It says hello.')).toBeVisible()
  expect(sent()).toContain('tool-result tool=\\"file a.txt\\"')
  expect(sent()).toContain('hello')
})

test('"Always allow" saves a rule for the project, shown and removable in settings', async () => {
  const page = await open()
  mock!.queue.push(tool({ tool: 'run', command: 'echo first' }), 'Ran it.', tool({ tool: 'run', command: 'echo second' }), 'Ran it again.')
  await say(page, 'say first')
  const card = page.getByRole('group', { name: /Run a command/ })
  await card.getByRole('button', { name: /Always allow echo\* here/ }).click()
  await expect(page.getByText('Ran it.')).toBeVisible()
  await say(page, 'say second')
  await expect(page.getByText('Ran it again.')).toBeVisible()
  await expect(page.getByRole('group', { name: /Run a command/ })).toHaveCount(0)

  // Settings live in the session panel: its Settings tab, each row opening in place.
  await say(page, '/settings')
  const settings = page.getByRole('region', { name: 'Terra Code settings' })
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  await expect(settings.getByRole('button', { name: /Allowed commands\s*1/ })).toBeVisible()
  await settings.getByRole('button', { name: /Allowed commands/ }).click()
  const allowed = settings.getByRole('list', { name: 'Allowed commands' })
  await expect(allowed).toContainText('echo*')
  await settings.getByRole('button', { name: 'Remove echo*' }).click()
  await expect(allowed).toHaveCount(0)
})

test('rewinding puts files and the conversation back, and offers the message again', async () => {
  const page = await open('edits')
  mock!.queue.push(tool({ tool: 'write', path: 'b.txt', content: 'new\n' }), 'Made b.')
  await say(page, 'make b')
  await expect(page.getByText('Made b.')).toBeVisible()
  expect(existsSync(join(folder, 'b.txt'))).toBe(true)
  await page.getByRole('log', { name: 'Terra Code' }).getByText('make b', { exact: true }).hover()
  await page.getByRole('button', { name: 'Rewind to before this' }).click()
  await page.getByRole('group', { name: 'Rewind' }).getByRole('button', { name: 'Both' }).click()
  await expect(page.getByText(/Rewound: 1 file is back/)).toBeVisible()
  expect(existsSync(join(folder, 'b.txt'))).toBe(false)
  await expect(page.getByText('Made b.')).toHaveCount(0)
  await expect(box(page)).toHaveValue('make b')
})

test('a background job keeps running, shows what it prints, and stops from the bar', async () => {
  const page = await open()
  await setSetting(h, { coderMode: 'edits' })
  mock!.queue.push(tool({ tool: 'run', command: 'echo serving; sleep 60', background: true }), 'The server is up.')
  await say(page, 'start the server')
  await page.getByRole('group', { name: /keeps running/ }).getByRole('button', { name: 'Run' }).click()
  await expect(page.getByText('The server is up.')).toBeVisible()
  const bar = page.getByRole('region', { name: 'Background jobs' })
  await expect(bar).toContainText('1 running in the background')
  await bar.getByRole('button', { expanded: false }).click()
  await expect(bar).toContainText('serving')
  await bar.getByRole('button', { name: 'Stop' }).click()
  await expect(bar).toHaveCount(0)
  expect(sent(1)).toContain('Started job 1')
})

test('an MCP server added in settings offers its tools, which ask before running', async () => {
  const page = await open()
  // /mcp opens the panel's Settings tab with the MCP servers row already open.
  await say(page, '/mcp')
  const settings = page.getByRole('region', { name: 'Terra Code settings' })
  await settings.getByRole('button', { name: 'Add your own' }).click()
  const form = settings.getByRole('group', { name: 'Add an MCP server' })
  await form.getByRole('textbox', { name: 'Server name' }).fill('fake')
  await form.getByRole('textbox', { name: 'Command' }).fill(`node "${resolve(__dirname, 'fixtures/mcp/server.mjs')}"`)
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(settings.getByText('fake', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Hide the session panel' }).first().click()

  mock!.queue.push(tool({ tool: 'mcp__fake__shout', words: 'hello' }), 'It shouted.')
  await say(page, 'shout hello')
  const card = page.getByRole('group', { name: 'Use shout from fake' })
  await expect(card).toContainText('"words": "hello"')
  await card.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(page.getByText('It shouted.')).toBeVisible()
  expect(sent()).toContain('HELLO!')
  // The tool is offered to the model by its MCP name.
  expect(JSON.stringify(mock!.requests[0]!.body.tools)).toContain('mcp__fake__shout')

  await say(page, '/mcp')
  await expect(settings.getByText('1 tools')).toBeVisible()
})

test('changes are committed with a written message, on a new branch', async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder })
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: folder })
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: folder })
  execFileSync('git', ['config', 'user.email', 'tester@example.test'], { cwd: folder })
  const page = await open('edits')
  mock!.queue.push(tool({ tool: 'write', path: 'b.txt', content: 'new\n' }), 'Made b.', 'Add b.txt with a greeting')
  await say(page, 'make b')
  await expect(page.getByText('Made b.')).toBeVisible()
  await page.getByRole('region', { name: 'Changed files' }).getByRole('button', { name: 'Commit' }).click()
  const commit = page.getByRole('region', { name: 'Commit' })
  await expect(commit.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Add b.txt with a greeting')
  await commit.getByRole('checkbox', { name: 'On a new branch' }).check()
  await commit.getByRole('textbox', { name: 'Branch name' }).fill('feature/b')
  await commit.getByRole('button', { name: 'Commit' }).click()
  await expect(page.getByText(/Committed [0-9a-f]+ Add b\.txt/)).toBeVisible()
  expect(execFileSync('git', ['log', '-1', '--format=%s %D'], { cwd: folder }).toString()).toContain('Add b.txt with a greeting HEAD -> feature/b')
  await expect(page.getByRole('region', { name: 'Changed files' })).toHaveCount(0)
})

test('the preview tab opens the dev server, reads it and its console errors', async () => {
  const site = await serveSite({ '/': titled('Dev app', '<h1>Shop</h1><button onclick="console.error(\'broken checkout\')">Pay</button>') })
  try {
    const page = await open()
    const url = site.url('/').replace('127.0.0.1', 'localhost')
    mock!.queue.push(tool({ tool: 'preview', action: 'open', url }), tool({ tool: 'preview', action: 'click', target: 'Pay' }), tool({ tool: 'preview', action: 'read' }), 'Checkout is broken.')
    await say(page, 'check the app')
    await page.getByRole('group', { name: 'Click Pay in the preview' }).getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(page.getByText('Checkout is broken.')).toBeVisible()
    expect(sent(1)).toContain('Dev app')
    expect(sent(2)).toContain('Clicked button')
    expect(sent(3)).toContain('Shop')
    expect(sent(2) + sent(3)).toContain('broken checkout')
    // Beside the person's tab, without taking its place.
    await expect(h.chrome.getByRole('tab', { selected: true })).not.toContainText('Dev app')
  } finally {
    site.server.close()
  }
})

test('the model can be chosen for one session, and pictures go with the message', async () => {
  const page = await open()
  await page.getByRole('button', { name: 'mock-model', exact: true }).click()
  await page.getByRole('dialog', { name: 'Model for this session' }).getByRole('button', { name: 'mock-model' }).click()
  await page.getByRole('button', { name: /^Thinking: / }).click()
  await page.getByRole('dialog', { name: 'Thinking' }).getByRole('radio', { name: /^High/ }).click()
  await expect(page.getByRole('button', { name: 'Thinking: High' })).toBeVisible()

  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    transfer.items.add(new File([bytes], 'dot.png', { type: 'image/png' }))
    return transfer
  })
  await box(page).dispatchEvent('drop', { dataTransfer: data })
  await expect(page.getByRole('img', { name: 'Picture 1' })).toBeVisible()
  mock!.queue.push('A dot.')
  await say(page, 'what is this')
  await expect(page.getByText('A dot.')).toBeVisible()
  await expect(page.getByText('With a picture')).toBeVisible()
  expect(sent()).toContain('image_url')
  expect(sent()).toContain('data:image/png;base64')
})

test('a project’s slash command and the review command go to the model as tasks', async () => {
  const page = await open()
  execFileSync('mkdir', ['-p', join(folder, '.terra', 'commands')])
  writeFileSync(join(folder, '.terra', 'commands', 'ship.md'), '---\ndescription: Get it ready to ship\n---\nPrepare $ARGUMENTS for release.')
  await page.reload()
  await box(page).fill('/sh')
  await expect(page.getByRole('listbox', { name: 'Commands' }).getByRole('option', { name: /\/ship.*Get it ready to ship/ })).toBeVisible()
  mock!.queue.push('Ready.')
  await say(page, '/ship version 2')
  await expect(page.getByText('Ready.')).toBeVisible()
  expect(sent()).toContain('Prepare version 2 for release.')
  mock!.queue.push('Looks fine.')
  await say(page, '/review')
  await expect(page.getByText('Looks fine.')).toBeVisible()
  expect(sent()).toContain('careful senior reviewer')
  expect(JSON.stringify(mock!.requests.at(-1)!.body.tools)).not.toContain('"write"')
})

test('a session in a separate copy works on its own branch, then merges back', async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder })
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: folder })
  execFileSync('git', ['config', 'user.email', 'tester@example.test'], { cwd: folder })
  execFileSync('git', ['add', '-A'], { cwd: folder })
  execFileSync('git', ['commit', '-q', '-m', 'start'], { cwd: folder })
  const page = await open('edits')
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: /New session in a separate copy/ }).click()
  const chip = page.getByRole('button', { name: /Separate copy on terra\// })
  await expect(chip).toBeVisible()
  mock!.queue.push(tool({ tool: 'write', path: 'c.txt', content: 'copy\n' }), 'Made c.', 'Add c.txt')
  await say(page, 'make c')
  await expect(page.getByText('Made c.')).toBeVisible()
  // The project itself is untouched until the branch is merged.
  expect(existsSync(join(folder, 'c.txt'))).toBe(false)
  await page.getByRole('region', { name: 'Changed files' }).getByRole('button', { name: 'Commit' }).click()
  const commit = page.getByRole('region', { name: 'Commit' })
  await expect(commit.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Add c.txt')
  await commit.getByRole('button', { name: 'Commit' }).click()
  await expect(page.getByText(/Committed/)).toBeVisible()
  await chip.click()
  await page.getByRole('menuitem', { name: /Merge into main/ }).click()
  await expect(page.getByText(/Merged into main/)).toBeVisible()
  expect(existsSync(join(folder, 'c.txt'))).toBe(true)
  await chip.click()
  await page.getByRole('menuitem', { name: /Remove the copy/ }).click()
  await expect(page.getByRole('button', { name: /Separate copy on/ })).toHaveCount(0)
})

test('a run carries on while another chat is on screen, and its chat catches up', async () => {
  const page = await open()
  await page.evaluate(() => (window as unknown as { scbInternal: { invoke(c: string, ...a: unknown[]): Promise<unknown> } }).scbInternal.invoke('coder:set-rules', { allow: ['sleep*'], deny: [] }))
  mock!.queue.push(tool({ tool: 'run', command: 'sleep 2' }), 'Finished while you were away.')
  await say(page, 'wait a bit')
  await expect(page.getByText('Working')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Saved chats' }).getByRole('link', { name: /wait a bit/ })).toBeVisible()
  await go(h, 'sc://assistant/?mode=code')
  const other = await h.page('sc://assistant')
  await expect(other.getByRole('heading', { name: /What should we do/ })).toBeVisible()
  await other.getByRole('navigation', { name: 'Saved chats' }).getByRole('link', { name: /wait a bit/ }).click()
  await expect(other.getByText('Finished while you were away.')).toBeVisible({ timeout: 10_000 })
  await expect(other.getByRole('log', { name: 'Terra Code' }).getByText('sleep 2')).toBeVisible()
})

test('a screenshot of the preview goes to the model as a picture, and reading a tab asks first', async () => {
  const site = await serveSite({ '/': titled('Docs page', '<h1>How to configure the widget</h1><p>Set colour to teal.</p>'), '/app': titled('App', '<h1>App</h1>') })
  try {
    const page = await open()
    // A tab the person has open, as documentation.
    await h.app.evaluate((_, url) => (globalThis as unknown as { scbTabs: { create(u: string, o: object): number } }).scbTabs.create(url, { activate: false }), site.url('/'))
    await expect(h.chrome.getByRole('tab', { name: /Docs page/ })).toBeVisible()
    const tabId = await h.app.evaluate(() => (globalThis as unknown as { scbTabs: { snapshot(): { tabs: { id: number; title: string }[] } } }).scbTabs.snapshot().tabs.find((tab) => tab.title === 'Docs page')!.id)
    mock!.queue.push(
      tool({ tool: 'preview', action: 'open', url: site.url('/app').replace('127.0.0.1', 'localhost') }),
      tool({ tool: 'preview', action: 'screenshot' }),
      tool({ tool: 'tabs', action: 'read', tab: tabId }),
      'The docs say teal.'
    )
    await say(page, 'check the docs')
    const ask = page.getByRole('group', { name: /Let Terra Code read “Docs page”/ })
    await ask.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(page.getByText('The docs say teal.')).toBeVisible()
    expect(JSON.stringify(mock!.requests[2]!.body.messages)).toContain('data:image/jpeg;base64')
    expect(sent()).toContain('Set colour to teal.')
  } finally {
    site.server.close()
  }
})

test('a session can carry on in a copy, which is saved as a chat of its own', async () => {
  const page = await open()
  mock!.queue.push('First answer.')
  await say(page, 'start here')
  await expect(page.getByText('First answer.')).toBeVisible()
  const saved = page.getByRole('navigation', { name: 'Saved chats' })
  await expect(saved.getByRole('link', { name: /start here/ })).toHaveCount(1)
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: /Carry on in a copy/ }).click()
  await expect(saved.getByRole('link', { name: /start here \(copy\)/ })).toBeVisible()
  await expect(page.getByText('First answer.')).toBeVisible()
  mock!.queue.push('Second answer.')
  await say(page, 'and then')
  await expect(page.getByText('Second answer.')).toBeVisible()
  expect(sent()).toContain('First answer.')
})

test('reasoning folds above a step, a helper reports back, and the session panel follows along', async () => {
  const page = await open()
  const size = (width: number, height: number) => h.app.evaluate(({ BrowserWindow }, [w, ht]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, ht!), [width, height])
  // Wide enough for the panel to sit beside the conversation.
  await size(1480, 920)
  mock!.thinking.push('I should read a.txt before anything else.')
  mock!.queue.push(
    `${tool({ tool: 'todo', items: [{ text: 'Look at a.txt', status: 'in_progress' }, { text: 'Report back', status: 'pending' }] })}\n${tool({ tool: 'explore', task: 'What is in a.txt?' })}`,
    'a.txt holds a greeting.',
    'It holds a greeting.'
  )
  await say(page, 'what is in a.txt')
  await expect(page.getByText('It holds a greeting.')).toBeVisible()
  // The reasoning, folded to a line that opens.
  const thought = page.getByRole('region', { name: 'Reasoning' })
  await expect(thought).toContainText('Thought')
  await thought.getByRole('button').click()
  await expect(thought).toContainText('I should read a.txt before anything else.')
  // The helper, with what it reported.
  const helper = page.getByRole('region', { name: 'explore agent' })
  await expect(helper).toContainText('Done')
  await helper.getByRole('button').first().click()
  await expect(helper).toContainText('a.txt holds a greeting.')
  // The panel, with the checklist and the helper.
  const panel = page.getByRole('complementary', { name: 'Session' })
  await expect(panel.getByRole('region', { name: 'Checklist' })).toContainText('0 of 2')
  await expect(panel.getByRole('region', { name: 'Agents' })).toContainText('explore')
  await expect(panel.getByRole('region', { name: 'Activity' })).toContainText('Steps')
  await panel.getByRole('button', { name: 'Hide the session panel' }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Checklist' })).toContainText('Look at a.txt')
  await page.getByRole('button', { name: 'Show the session panel' }).click()
  await expect(panel).toBeVisible()
  // Narrow, it floats over the conversation, and only when asked for.
  await size(820, 820)
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: 'Show the session panel' }).click()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Hide the session panel' }).click()
  await expect(panel).toHaveCount(0)
  // How hard it thinks, from the box.
  await say(page, '/effort max')
  await expect(page.getByText('Thinking set to Max.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Thinking: Max' })).toBeVisible()
})

test('settings open in place in the session panel, and its rows change the session', async () => {
  const page = await open()
  await page.getByRole('button', { name: 'Show the session panel' }).click()
  const panel = page.getByRole('complementary', { name: 'Session' })
  await panel.getByRole('button', { name: /Permissions\s*Ask/ }).click()
  await panel.getByRole('radio', { name: /Auto-edit/ }).click()
  // The message box follows, as it's the same setting.
  await expect(page.getByRole('radiogroup', { name: 'Changes' }).getByRole('radio', { name: 'Auto-edit' })).toHaveAttribute('aria-checked', 'true')
  await panel.getByRole('button', { name: /Thinking\s*Auto/ }).click()
  await panel.getByRole('radio', { name: /High/ }).first().click()
  await expect(panel.getByRole('button', { name: /Thinking\s*High/ })).toBeVisible()
  await panel.getByRole('tab', { name: 'Settings' }).click()
  const settings = panel.getByRole('region', { name: 'Terra Code settings' })
  await settings.getByRole('switch', { name: 'Notify me' }).click()
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('settings:get').then((s) => (s as { coderNotify: boolean }).coderNotify))).toBe(true)
  await settings.getByRole('button', { name: /Blocked commands/ }).click()
  await settings.getByRole('textbox', { name: 'Add to blocked commands' }).fill('git push*')
  await settings.getByRole('button', { name: 'Add' }).click()
  await expect(settings.getByRole('list', { name: 'Blocked commands' })).toContainText('git push*')
})

test('a finished plan can be changed, then started without asking', async () => {
  const page = await open()
  await page.getByRole('radiogroup', { name: 'Changes' }).getByRole('radio', { name: 'Plan' }).click()
  mock!.queue.push('1. Make b.txt')
  await say(page, 'plan b')
  const card = page.getByRole('region', { name: 'Plan ready' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Edit plan' }).click()
  await card.getByRole('textbox', { name: 'Plan' }).fill('1. Make b.txt saying new')
  mock!.queue.push(tool({ tool: 'write', path: 'b.txt', content: 'new\n' }), 'Made it.')
  await card.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByText('Made it.')).toBeVisible()
  expect(readFileSync(join(folder, 'b.txt'), 'utf8')).toBe('new\n')
  await expect(page.getByRole('radiogroup', { name: 'Changes' }).getByRole('radio', { name: 'Auto-edit' })).toHaveAttribute('aria-checked', 'true')
  expect(sent(-2)).toContain('Carry out this plan')
  expect(sent(-2)).toContain('Make b.txt saying new')
  await expect(card).toHaveCount(0)
})

test('one step can be undone and redone on its own', async () => {
  const page = await open('edits')
  mock!.queue.push(tool({ tool: 'write', path: 'a.txt', content: 'two\n' }), tool({ tool: 'write', path: 'b.txt', content: 'new\n' }), 'Done both.')
  await say(page, 'change both')
  await expect(page.getByText('Done both.')).toBeVisible()
  const undo = page.getByRole('button', { name: 'Undo this step' })
  await expect(undo).toHaveCount(2)
  await undo.first().click()
  await expect(page.getByText('Undone', { exact: true })).toBeVisible()
  expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('hello\n')
  expect(existsSync(join(folder, 'b.txt'))).toBe(true)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(page.getByText('Undone', { exact: true })).toHaveCount(0)
  expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('two\n')
})

test('comments left on lines in review go to the model as a task', async () => {
  const page = await open('edits')
  mock!.queue.push(tool({ tool: 'write', path: 'a.txt', content: 'changed\n' }), 'Changed.')
  await say(page, 'change a')
  await expect(page.getByText('Changed.')).toBeVisible()
  await page.getByRole('region', { name: 'Changed files' }).getByRole('button', { name: 'Review' }).click()
  const review = page.getByRole('region', { name: 'Review changes' })
  // The removed line and the added line are both line 1; the added one is second.
  await review.getByRole('button', { name: 'Comment on line 1' }).nth(1).click()
  await review.getByRole('textbox', { name: 'Comment on line 1' }).fill('Say hi instead')
  await review.getByRole('button', { name: 'Add comment' }).click()
  await expect(review).toContainText('1 comment')
  mock!.queue.push('Will do.')
  await review.getByRole('button', { name: 'Send to Terra Code' }).click()
  await expect(page.getByText('Will do.')).toBeVisible()
  expect(sent()).toContain('Say hi instead')
  expect(sent()).toContain('a.txt, line 1')
})

test('sessions are listed by project, marked when waiting, and can be searched, pinned and archived', async () => {
  const page = await open()
  mock!.queue.push('First.')
  await say(page, 'alpha task')
  await expect(page.getByText('First.')).toBeVisible()
  const list = page.getByRole('navigation', { name: 'Saved chats' })
  await expect(list.getByRole('link', { name: /alpha task/ })).toBeVisible()
  await list.getByRole('button', { name: 'New session' }).click()
  mock!.queue.push(tool({ tool: 'write', path: 'b.txt', content: 'new\n' }), 'Second.')
  await say(page, 'beta task')
  const card = page.getByRole('group', { name: /b\.txt/ })
  await expect(card).toBeVisible()
  const beta = list.getByRole('link', { name: /beta task/ })
  await expect(beta).toContainText('Needs you')
  await card.getByRole('button', { name: 'Apply change' }).click()
  await expect(page.getByText('Second.')).toBeVisible()
  await expect(beta).not.toContainText('Needs you')
  // Both under the project's folder.
  await expect(list.getByRole('region', { name: basename(folder) })).toContainText('alpha task')
  await list.getByRole('textbox', { name: 'Search sessions' }).fill('alpha')
  await expect(list.getByRole('link')).toHaveCount(1)
  await list.getByRole('textbox', { name: 'Search sessions' }).fill('')
  await list.getByRole('link', { name: /alpha task/ }).hover()
  await list.getByRole('listitem').filter({ hasText: 'alpha task' }).getByRole('button', { name: 'Pin' }).click()
  await expect(list.getByRole('region', { name: 'Pinned' })).toContainText('alpha task')
  await beta.hover()
  await list.getByRole('listitem').filter({ hasText: 'beta task' }).getByRole('button', { name: 'Archive' }).click()
  const archived = list.getByRole('region', { name: 'Archived' })
  await expect(archived).toContainText('1')
  await expect(list.getByRole('link', { name: /beta task/ })).toHaveCount(0)
  await archived.getByRole('button').click()
  await expect(list.getByRole('link', { name: /beta task/ })).toBeVisible()
})

test('the project’s formatter runs after edits once allowed', async () => {
  test.skip(process.platform === 'win32', 'The stand-in formatter is a shell script')
  mkdirSync(join(folder, 'node_modules', '.bin'), { recursive: true })
  const bin = join(folder, 'node_modules', '.bin', 'prettier')
  writeFileSync(bin, '#!/bin/sh\nfor f in "$@"; do case "$f" in -*|warn) ;; *) tr a-z A-Z < "$f" > "$f.tmp" && mv "$f.tmp" "$f";; esac; done\n')
  chmodSync(bin, 0o755)
  writeFileSync(join(folder, '.prettierrc'), '{}')
  const page = await open('edits')
  mock!.queue.push(tool({ tool: 'write', path: 'app.ts', content: 'const a = 1\n' }), 'Wrote it.')
  await say(page, 'write app')
  const card = page.getByRole('group', { name: /Prettier/ })
  await card.getByRole('button', { name: 'Always format with Prettier here' }).click()
  await expect(page.getByText('Wrote it.')).toBeVisible()
  expect(readFileSync(join(folder, 'app.ts'), 'utf8')).toBe('CONST A = 1\n')
  expect(sent()).toContain('Formatted with Prettier')
})

test('common MCP servers are offered, and one that needs a key opens filled in', async () => {
  const page = await open()
  await say(page, '/mcp')
  const settings = page.getByRole('region', { name: 'Terra Code settings' })
  await settings.getByRole('button', { name: 'Browse servers' }).click()
  const directory = settings.getByRole('list', { name: 'Common MCP servers' })
  await expect(directory).toContainText('context7')
  await directory.getByRole('button', { name: 'Add github' }).click()
  const form = settings.getByRole('group', { name: 'Add an MCP server' })
  await expect(form.getByRole('textbox', { name: 'Server name' })).toHaveValue('github')
  await expect(form.getByRole('textbox', { name: 'Address' })).toHaveValue('https://api.githubcopilot.com/mcp/')
  await expect(form.getByRole('textbox', { name: 'Headers' })).toHaveValue(/Authorization/)
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(form).toHaveCount(0)
})
