import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, omnibox, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock

const REPORT = [
  'Here is the plan.',
  '',
  '```scterra-report',
  JSON.stringify({
    title: 'Launch plan',
    summary: 'Three steps to launch.',
    theme: 'brief',
    blocks: [
      { type: 'heading', level: 2, text: 'Steps' },
      { type: 'list', ordered: true, items: ['Build', 'Test'] },
      { type: 'paragraph', text: '<img src=x onerror=alert(1)> stays as text' },
      { type: 'table', headers: ['Owner'], rows: [['Alex']] }
    ]
  }),
  '```'
].join('\n')

test.beforeEach(async () => {
  mock = await startAiMock()
  site = await serveSite({ '/alpha': titled('Alpha page') })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  mock.server.closeAllConnections()
  mock.server.close()
  site.server.close()
})

async function addProvider() {
  await go(h, 'sc://ai')
  const page = await h.page('sc://ai')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await page.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await page.getByRole('button', { name: 'Add provider' }).click()
  const picker = page.getByRole('combobox', { name: 'Chat model for Mock AI' })
  await expect(page.getByText('Connected, 1 model available')).toBeVisible()
  await picker.selectOption('mock-model')
  await expect(picker).toHaveValue('mock-model')
}

const bar = () => h.chrome.getByRole('toolbar', { name: 'Bookmarks' })

test('the bookmarks bar follows the chosen mode, showing always by default', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  await expect(bar()).toBeVisible()

  await setSetting(h, { bookmarksBar: 'new-tab' })
  await expect(bar()).toHaveCount(0)
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  await expect(bar()).toBeVisible()

  await setSetting(h, { bookmarksBar: 'bookmarks-page' })
  await expect(bar()).toHaveCount(0)
  await go(h, 'sc://bookmarks')
  await expect(bar()).toBeVisible()
})

test('suggestion sources can be switched off', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)

  const overlay = await h.overlay()
  await omnibox(h).pressSequentially('alpha')
  await expect(overlay.getByRole('option', { name: /Alpha page/ })).toBeVisible()
  await omnibox(h).press('Escape')
  await omnibox(h).press('Escape')

  await setSetting(h, { suggestionSources: [] })
  await omnibox(h).pressSequentially('alpha')
  await expect(overlay.getByRole('option')).toHaveCount(1)
})

test('search offers Ask scTerra and Ask Assistant, and the page gives a text answer', async () => {
  await addProvider()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')

  await omnibox(h).click()
  await omnibox(h).fill('rust')
  const overlay = await h.overlay()
  await expect(overlay.getByRole('option', { name: /Ask scTerra/ })).toBeVisible()
  const askPage = overlay.getByRole('option', { name: /Ask Assistant/ })
  await expect(askPage).toBeVisible()
  expect(mock.requests).toHaveLength(0)

  await omnibox(h).press('ArrowDown')
  await omnibox(h).press('ArrowDown')
  await omnibox(h).press('Enter')

  const page = await h.page('sc://assistant')
  await expect(page.getByText('Hello there')).toBeVisible()
  expect(mock.requests.at(-1)?.body.messages?.at(-1)?.content).toBe('rust')

  await page.getByRole('textbox', { name: 'Message the assistant' }).fill('More')
  await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
  await expect(page.getByText('Hello there')).toHaveCount(2)
})

test('long answers appear as a themed report, with no way to bring in markup', async () => {
  await addProvider()
  mock.queue = [REPORT]
  await go(h, 'sc://assistant')
  const page = await h.page('sc://assistant')
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill('Plan a launch')
  await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')

  const report = page.locator('article.sc-report')
  await expect(report).toHaveAttribute('data-theme', 'brief')
  await expect(report.getByRole('heading', { name: 'Launch plan' })).toBeVisible()
  await expect(report.getByRole('heading', { name: 'Steps' })).toBeVisible()
  await expect(report.getByRole('cell', { name: 'Alex' })).toBeVisible()
  await expect(report.locator('img')).toHaveCount(0)
  await expect(report.getByText('stays as text')).toBeVisible()
  await expect(page.getByText('Here is the plan.')).toBeVisible()
})

test('the side panel opens a report beside it, and it downloads as PDF, HTML and Markdown', async () => {
  await addProvider()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  mock.queue = [REPORT]
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  const panel = h.chrome.getByRole('complementary', { name: 'Assistant' })
  await panel.getByRole('textbox', { name: 'Message the assistant' }).fill('Plan it')
  await panel.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
  await panel.getByRole('button', { name: 'Open report' }).click()
  const pane = h.chrome.getByRole('region', { name: 'Report' })
  await expect(pane.locator('article.sc-report')).toContainText('Launch plan')

  const folder = mkdtempSync(join(tmpdir(), 'scb-report-'))
  for (const [label, file] of [['PDF', 'out.pdf'], ['Web page (HTML)', 'out.html'], ['Markdown', 'out.md']] as const) {
    await h.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
    }, join(folder, file))
    await pane.getByRole('button', { name: 'Download' }).click()
    await pane.getByRole('menuitem', { name: label }).click()
    await expect(pane.getByRole('status')).toHaveText('Saved')
    await expect.poll(() => existsSync(join(folder, file))).toBe(true)
    await pane.getByRole('button', { name: 'Close report' }).click()
    await panel.getByRole('button', { name: 'Open report' }).click()
  }
  expect(readFileSync(join(folder, 'out.pdf')).subarray(0, 5).toString()).toBe('%PDF-')
  expect(readFileSync(join(folder, 'out.html'), 'utf8')).toContain('Launch plan')
  expect(readFileSync(join(folder, 'out.md'), 'utf8')).toContain('# Launch plan')
  rmSync(folder, { recursive: true, force: true })

  await pane.getByRole('button', { name: 'Open in a full page' }).click()
  const page = await h.page('sc://assistant/?chat=')
  await expect(page.locator('article.sc-report')).toContainText('Launch plan')
  await expect(page.getByRole('navigation', { name: 'Browser pages' })).toHaveCount(0)
})

test('extensions load, run on pages, stay after a restart and can be removed', async () => {
  const fixture = resolve(__dirname, 'fixtures/extension')
  await h.app.evaluate(
    (_, path) => (globalThis as unknown as { scbExtensions: { add(p: string): Promise<string> } }).scbExtensions.add(path),
    fixture
  )
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  const page = await h.page('/alpha')
  await expect(page.locator('html')).toHaveAttribute('data-extension', 'loaded')
  await h.close()

  h = await launch(h.profile)
  await go(h, 'sc://settings')
  const settings = await h.page('sc://settings')
  const section = settings.getByRole('region', { name: 'Extensions' })
  await expect(section.getByText('Test extension')).toBeVisible()
  await section.getByRole('button', { name: 'Remove' }).click()
  await expect(section.getByText('Test extension')).toHaveCount(0)
})

test('reports that were cut off still appear', async () => {
  await addProvider()
  mock.queue = ['Here.\n```scterra-report\n{"title":"Cut off","blocks":[{"type":"paragraph","text":"Kept"},{"type":"paragraph","text":"Half wri']
  await go(h, 'sc://assistant')
  const page = await h.page('sc://assistant')
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill('Go')
  await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
  await expect(page.locator('article.sc-report')).toContainText('Half wri')
  await expect(page.getByText('Writing a report…')).toHaveCount(0)
})

test('extensions get a toolbar button with a working popup, and their APIs reach our tabs', async () => {
  await h.close()
  h = await launch(undefined, [], { SCB_E2E_SANDBOX: '1' })
  const fixture = resolve(__dirname, 'fixtures/action-extension')
  const id = await h.app.evaluate(
    (_, path) => (globalThis as unknown as { scbExtensions: { add(p: string): Promise<string> } }).scbExtensions.add(path),
    fixture
  )
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  const button = h.chrome.locator('browser-action-list').locator('button, .action')
  await expect(button.first()).toBeVisible()
  await button.first().click()
  const popup = await h.page(`chrome-extension://${id}/popup.html`)
  await expect(popup.getByRole('heading', { name: 'From the popup' })).toBeVisible()
  await expect(popup).toHaveTitle(/^Tabs: [1-9]/)
  // The new tab takes focus, which closes the popup, so don't wait for an answer.
  await popup.evaluate(() => void (globalThis as unknown as { chrome: { runtime: { sendMessage(m: string): void } } }).chrome.runtime.sendMessage('open-tab'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
})

test('opted-out crash logging stays local and shows in Settings', async () => {
  await h.app.evaluate((_) => {
    const { scbReporter } = globalThis as unknown as { scbReporter: { record(kind: string, reason: string): void } }
    scbReporter.record('page', 'crashed')
  })
  await go(h, 'sc://settings')
  const page = await h.page('sc://settings')
  const section = page.getByRole('region', { name: 'Crash reports and usage' })
  await expect(section.getByText('page: crashed')).toBeVisible()
  await expect(section.getByRole('switch', { name: 'Send crash reports' })).toHaveAttribute('aria-checked', 'false')
  await section.getByRole('button', { name: 'Clear' }).click()
  await expect(section.getByText('No crashes recorded')).toBeVisible()
})

test('sync can be turned on from Settings', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-sync-'))
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
  await go(h, 'sc://settings')
  const page = await h.page('sc://settings')
  const section = page.getByRole('region', { name: 'Sync' })
  await section.getByRole('button', { name: 'Choose' }).click()
  await section.getByRole('textbox', { name: 'Sync passphrase' }).fill('a long enough passphrase')
  await section.getByRole('button', { name: 'Turn on' }).click()
  await expect(section.getByText(/Last synced/)).toBeVisible()
  expect(existsSync(join(folder, 'scdelta-sync.bin'))).toBe(true)
  await section.getByRole('button', { name: 'Turn off' }).click()
  await expect(section.getByRole('button', { name: 'Choose' })).toBeVisible()
})

test('the command palette stays put when the pointer moves over it', async () => {
  await shortcut(h, 'k')
  const overlay = await h.overlay()
  const list = overlay.getByRole('listbox', { name: 'Commands' })
  await expect(list).toBeVisible()
  const box = (await list.boundingBox())!
  const top = () => list.evaluate((el) => el.scrollTop)
  for (const offset of [40, 120, 200, box.height - 8]) {
    await overlay.mouse.move(box.x + 40, box.y + offset, { steps: 4 })
  }
  await overlay.mouse.wheel(0, 0)
  expect(await top()).toBe(0)

  const input = overlay.getByRole('combobox', { name: 'Type a command' })
  for (let i = 0; i < 14; i++) await input.press('ArrowDown')
  await expect.poll(top).toBeGreaterThan(0)
})
