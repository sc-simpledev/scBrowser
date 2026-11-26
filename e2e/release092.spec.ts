import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, omnibox, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let mock: AiMock | null = null
let site: Site
let scratch = ''

test.beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'scb-092-'))
  site = await serveSite({
    '/links': titled('Links page', '<p><a href="/other">Go to the other page</a></p>'),
    '/other': titled('Other page'),
    '/long': titled('How to bake bread at home without a mixer, a complete guide | Bread Blog')
  })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  if (mock) {
    mock.server.closeAllConnections()
    mock.server.close()
    mock = null
  }
  site.server.close()
  rmSync(scratch, { recursive: true, force: true })
})

/** The mock model as the chat model, through sc://ai as a person would set it up. */
async function withMockModel(env: Record<string, string> = {}): Promise<void> {
  h = await launch(undefined, [], env)
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
  await setSetting(h, { httpsOnly: false, saveChats: false })
}

const tabCount = (h: Harness) => h.chrome.getByRole('tab').count()

test('a half-typed address stays with its tab when you switch away and back', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/other'))
  await expect(activeTab(h)).toHaveText('Other page')
  await shortcut(h, 'T')
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await omnibox(h).fill('half typed words')
  await h.chrome.getByRole('tab', { name: 'Other page' }).click()
  await expect(omnibox(h)).not.toHaveValue('half typed words')
  await h.chrome.getByRole('tab', { name: 'New tab' }).click()
  await expect(omnibox(h)).toHaveValue('half typed words')
})

test('Ctrl and Shift pick several tabs, and their menu acts on all of them', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/other'))
  for (let i = 0; i < 2; i++) await shortcut(h, 'T')
  await expect(h.chrome.getByRole('tab')).toHaveCount(3)
  const tabs = h.chrome.getByRole('tab')
  // The open tab is the third; Ctrl adds the second, Shift from the open one reaches the first.
  await tabs.nth(1).click({ modifiers: ['Control'] })
  await expect(h.chrome.locator('[data-picked]')).toHaveCount(2)
  await tabs.nth(0).click({ modifiers: ['Shift'] })
  await expect(h.chrome.locator('[data-picked]')).toHaveCount(3)
  await h.app.evaluate(({ Menu }) => {
    const realm = globalThis as unknown as { lastMenu: unknown }
    Menu.buildFromTemplate = ((template: unknown) => {
      realm.lastMenu = template
      return { popup: () => undefined }
    }) as never
  })
  await tabs.nth(1).click({ button: 'right' })
  await expect.poll(() => h.app.evaluate(() => ((globalThis as unknown as { lastMenu?: { label?: string }[] }).lastMenu ?? []).map((row) => row.label ?? '-').join('|'))).toContain('Close 3 tabs')
  // Escape lets go of the pick.
  await h.chrome.keyboard.press('Escape')
  await expect(h.chrome.locator('[data-picked]')).toHaveCount(0)
  await tabs.nth(0).click({ modifiers: ['Control'] })
  await tabs.nth(0).click({ button: 'right' })
  await h.app.evaluate(() => (globalThis as unknown as { lastMenu: { label?: string; click?: () => void }[] }).lastMenu.find((row) => row.label === 'Close 2 tabs')!.click!())
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
})

test('link hints click a link from the keyboard', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/links'))
  await expect(activeTab(h)).toHaveText('Links page')
  const page = await h.page('/links')
  await shortcut(h, '.')
  // One link in view, so its hint is the first letter.
  await expect.poll(() => page.evaluate(() => document.documentElement.lastElementChild?.tagName)).toBe('DIV')
  await page.keyboard.press('s')
  await expect(activeTab(h)).toHaveText('Other page')
})

test('the padlock shows a QR code for the page, and a site can always open in a workspace', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await h.app.evaluate(() => {
    const tabs = (globalThis as unknown as { scbTabs: { setWorkspaces(list: unknown[]): void; workspaceList(): unknown[] } }).scbTabs
    tabs.setWorkspaces([...tabs.workspaceList(), { id: 'work', name: 'Work', focus: false }])
  })
  await go(h, site.url('/other'))
  await expect(activeTab(h)).toHaveText('Other page')
  await h.chrome.evaluate(() => window.scb.invoke('site:controls', 120, 80))
  const overlay = await h.overlay()
  const panel = overlay.getByRole('dialog', { name: 'Controls for 127.0.0.1' })
  await panel.getByRole('button', { name: 'QR code for this page' }).click()
  await expect(panel.getByRole('img', { name: `QR code for ${site.url('/other')}` })).toBeVisible()
  await expect(panel.getByRole('img', { name: `QR code for ${site.url('/other')}` }).locator('path')).toHaveAttribute('d', /^M\d/)
  await panel.getByRole('button', { name: 'Back to the site’s controls' }).click()
  await panel.getByRole('combobox', { name: 'Workspace this site always opens in' }).selectOption('work')
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('settings:get').then((settings) => settings.siteWorkspaces['127.0.0.1']))).toBe('work')
  await overlay.keyboard.press('Escape')
  // Typed in a new tab here, the site opens in Work instead, and the empty tab goes.
  await shortcut(h, 'T')
  await omnibox(h).fill(site.url('/links'))
  await omnibox(h).press('Enter')
  await expect.poll(() => h.app.evaluate(() => (globalThis as unknown as { scbTabs: { workspace: { id: string } } }).scbTabs.workspace.id)).toBe('work')
  await expect(activeTab(h)).toHaveText('Links page')
})

test('tidy tab titles shortens long titles, with the full one on hover', async () => {
  await withMockModel()
  await go(h, site.url('/long'))
  await expect(activeTab(h)).toHaveText('How to bake bread at home without a mixer, a complete guide | Bread Blog')
  mock!.queue.push('{"titles":[{"tab":1,"title":"Bake bread without a mixer"}]}')
  await h.app.evaluate(() => (globalThis as unknown as { scbActions: { tidyTitles(): void } }).scbActions.tidyTitles())
  await expect(activeTab(h)).toHaveText('Bake bread without a mixer')
  // The page's own title is kept, for the hover card, and comes back when the page changes it.
  expect(await h.app.evaluate(() => (globalThis as unknown as { scbTabs: { snapshot(): { tabs: { title: string; shortTitle?: string }[] } } }).scbTabs.snapshot().tabs[0])).toMatchObject({ title: 'How to bake bread at home without a mixer, a complete guide | Bread Blog', shortTitle: 'Bake bread without a mixer' })
  await h.app.evaluate(() => (globalThis as unknown as { scbActions: { restoreTitles(): void } }).scbActions.restoreTitles())
  await expect(activeTab(h)).toHaveText('How to bake bread at home without a mixer, a complete guide | Bread Blog')
})

test('the side assistant: a status line, /compact, saving a note and an offer to remember', async () => {
  const notes = join(scratch, 'notes')
  await withMockModel()
  await setSetting(h, { notesFolder: notes })
  await shortcut(h, 'A', ['control', 'shift'])
  const panel = h.chrome.getByRole('complementary', { name: 'Assistant' })
  const box = panel.getByRole('textbox', { name: 'Message the assistant' })
  const say = async (text: string) => {
    await box.fill(text)
    await box.press('Enter')
  }
  mock!.queue.push('Fine, in kilometres from now on.\n\n```scterra-remember\nPrefers metric units.\n```')
  await say('Please use kilometres, I am in Australia')
  await expect(panel.getByText('Fine, in kilometres from now on.')).toBeVisible()
  // The block never shows as text: it's an offer, with a button.
  await expect(panel.getByText('scterra-remember')).toHaveCount(0)
  const offer = panel.getByRole('group', { name: 'Remember this?' })
  await expect(offer).toContainText('Prefers metric units.')
  expect(JSON.stringify(mock!.requests.at(-1)!.body.messages)).toContain('scterra-remember')
  await offer.getByRole('button', { name: 'Remember' }).click()
  await expect(panel.getByText('Remembered. Change it in AI settings, under Memory.')).toBeVisible()
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('ai:status').then(() => true))).toBe(true)
  // The status line: the model, this chat's tokens and how full its context is.
  const status = panel.locator('[title*="tokens in"]')
  await expect(status).toContainText('18 tokens')
  await expect(panel.getByRole('meter', { name: 'Context used' })).toBeVisible()

  mock!.queue.push('Second answer.')
  await say('And another question')
  await expect(panel.getByText('Second answer.')).toBeVisible()
  // Save as a note, straight into the notes folder.
  await panel.getByText('Second answer.').hover()
  await panel.getByRole('button', { name: 'Save as a note' }).last().click()
  await expect.poll(() => (existsSync(notes) ? readdirSync(notes) : []).length).toBe(1)
  const note = readFileSync(join(notes, readdirSync(notes)[0]!), 'utf8')
  expect(note).toContain('> And another question')
  expect(note).toContain('Second answer.')

  mock!.queue.push('They want kilometres, and asked a second question.')
  await say('/compact')
  await expect(panel.getByRole('separator').filter({ hasText: 'Earlier messages summed up to make room' })).toBeVisible()
  mock!.queue.push('Third answer.')
  await say('Carry on')
  await expect(panel.getByText('Third answer.')).toBeVisible()
  const sent = mock!.requests.at(-1)!.body.messages!.filter((message) => message.role !== 'system')
  expect(sent[0]!.content).toContain('(Earlier in this chat, summed up to make room:)')
  expect(sent[0]!.content).toContain('They want kilometres')
  expect(sent.at(-1)!.content).toContain('Carry on')
})

/** Terra Code with the mock model, in a git project with one commit. */
async function terraCode(env: Record<string, string> = {}): Promise<{ page: Page; folder: string }> {
  const folder = join(scratch, 'project')
  mkdirSync(folder)
  writeFileSync(join(folder, 'a.txt'), 'hello\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first')
  await withMockModel(env)
  await setSetting(h, { coderFolder: folder, coderMode: 'edits', coderNotify: false })
  await go(h, 'sc://assistant/?mode=code')
  return { page: await h.page('sc://assistant'), folder }
}

const codeBox = (page: Page) => page.getByRole('textbox', { name: 'Describe a change' })
async function code(page: Page, text: string) {
  await codeBox(page).fill(text)
  await codeBox(page).press('Enter')
}

test('Terra Code: ! runs your own command, # adds to TERRA.md, /context and /doctor', async () => {
  const { page, folder } = await terraCode()
  await codeBox(page).fill('!echo hello from the shell')
  await expect(page.getByRole('status').filter({ hasText: 'Command: runs in your project folder' })).toBeVisible()
  await codeBox(page).press('Enter')
  const shell = page.getByRole('region', { name: 'Your command' })
  await expect(shell).toContainText('$ echo hello from the shell')
  await expect(shell).toContainText('hello from the shell')
  await expect(shell).toContainText('done')

  await code(page, '# tests need the database running')
  await expect(page.getByText('Added to TERRA.md: tests need the database running')).toBeVisible()
  expect(readFileSync(join(folder, 'TERRA.md'), 'utf8')).toContain('tests need the database running')

  mock!.queue.push('Noted, I saw it.')
  await code(page, 'What did my command print?')
  await expect(page.getByText('Noted, I saw it.')).toBeVisible()
  expect(JSON.stringify(mock!.requests.at(-1)!.body.messages)).toContain('The person ran a command themselves in the project folder: `echo hello from the shell`')

  await code(page, '/context')
  const context = page.getByRole('region', { name: 'What fills the model’s memory' })
  await expect(context).toContainText('Memory in use')
  await expect(context).toContainText('Instructions')
  await expect(context).toContainText('Your messages')

  await code(page, '/doctor')
  const doctor = page.getByRole('region', { name: 'Terra Code’s setup' })
  await expect(doctor).toContainText('Project notes')
  await expect(doctor).toContainText('TERRA.md, read at the start of every session.')
  await expect(doctor).toContainText('Language servers')
})

test('Terra Code runs a task on your own server over SSH, and brings its branch back', async () => {
  test.setTimeout(120_000)
  // A stand-in for ssh: it skips the options and the host, and runs the command here, in a home of its own.
  const home = join(scratch, 'server-home')
  mkdirSync(home)
  const ssh = join(scratch, 'ssh')
  writeFileSync(ssh, `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o|-p) shift 2;; *) break;; esac; done\nshift\nHOME='${home}' exec sh -c "$1"\n`)
  chmodSync(ssh, 0o755)
  const { page, folder } = await terraCode({ SCB_SSH: ssh })
  // Uncommitted work goes along too.
  writeFileSync(join(folder, 'a.txt'), 'hello, edited\n')

  await page.getByRole('button', { name: 'Show the session panel' }).click()
  const panel = page.getByRole('complementary', { name: 'Session' })
  await panel.getByRole('button', { name: /Runs on/ }).click()
  await panel.getByRole('radio', { name: /Your server/ }).click()
  await panel.getByPlaceholder('user@host or a name from ~/.ssh/config').fill('me@box')
  await panel.getByRole('button', { name: 'Check' }).click()
  await expect(panel.getByRole('status')).toContainText('Ready: me@box has Node')
  await panel.getByRole('button', { name: 'Hide the session panel' }).click()

  // The runner on the "server" asks the mock model: one write, then done.
  mock!.toolNames.push('write')
  mock!.toolQueue.push([JSON.stringify({ path: 'hello.txt', content: 'hi from the server\n' })])
  mock!.queue.push('Wrote hello.txt.')
  await code(page, 'Add a hello file')
  const card = page.getByRole('region', { name: 'Run on your server' })
  await expect(card).toContainText(/Working on your server|Finished on your server/, { timeout: 30_000 })
  await expect(card).toContainText('Finished on your server', { timeout: 60_000 })
  await expect(card).toContainText('on me@box')
  await card.getByRole('button', { name: 'Fetch the branch' }).click()
  await expect(page.getByText(/^Fetched scterra\/add-a-hello-file-\w+ from me@box/)).toBeVisible()
  const branch = execFileSync('git', ['branch', '--list', 'scterra/*', '--format=%(refname:short)'], { cwd: folder, encoding: 'utf8' }).trim()
  expect(execFileSync('git', ['show', `${branch}:hello.txt`], { cwd: folder, encoding: 'utf8' })).toBe('hi from the server\n')
  expect(execFileSync('git', ['show', `${branch}:a.txt`], { cwd: folder, encoding: 'utf8' })).toBe('hello, edited\n')
  // The key went to the runner in its environment, never into a file on the server.
  const run = readdirSync(join(home, '.scterra/runs'))[0]!
  expect(readFileSync(join(home, '.scterra/runs', run, 'task.json'), 'utf8')).not.toContain('test-key-not-real')
})

test('a saved tab set opens by itself at its time', async () => {
  test.setTimeout(90_000)
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/other'))
  await expect(activeTab(h)).toHaveText('Other page')
  // Saved from a tab of its own, so the web page is what the set holds.
  await shortcut(h, 'T')
  await go(h, 'sc://archive')
  const archive = await h.page('sc://archive')
  await archive.getByRole('textbox', { name: 'Name for this set of tabs' }).fill('Morning')
  await archive.getByRole('button', { name: 'Save', exact: true }).click()
  await archive.getByRole('button', { name: 'Set a timetable for Morning' }).click()
  for (const day of ['Saturday', 'Sunday']) await archive.getByRole('button', { name: day }).click()
  const now = new Date()
  const earlier = new Date(now.getTime() - 60_000)
  const hhmm = `${String(earlier.getHours()).padStart(2, '0')}:${String(earlier.getMinutes()).padStart(2, '0')}`
  test.skip(earlier.getDate() !== now.getDate(), 'Too close to midnight for a time a minute ago')
  await archive.locator('input[type="time"]').fill(hhmm)
  await archive.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(archive.getByText(`Opens every day at ${hhmm}`)).toBeVisible()
  const before = await tabCount(h)
  await expect.poll(() => tabCount(h), { timeout: 45_000 }).toBeGreaterThan(before)
  await expect(h.chrome.getByRole('tab', { name: /Other page/ })).toHaveCount(2)
})
