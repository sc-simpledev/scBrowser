import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, serveSite, setSetting, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>

const activeUrl = () => main((g) => g.scbTabs.tabs.get(g.scbTabs.active.id).view.webContents.getURL() as string)

test.beforeEach(async () => {
  site = await serveSite({
    '/plain': titled('Plain page'),
    // Reloads itself for ever, as some sign-in and consent loops do.
    '/reloads': `<!doctype html><title>Reloads</title><script>setTimeout(() => location.reload(), 60)</script>`,
    // A banner that reloads the page when rejected, and never remembers the answer.
    '/banner': `<!doctype html><title>Banner</title><script>sessionStorage.loads = Number(sessionStorage.loads || 0) + 1; document.title = 'Loads ' + sessionStorage.loads</script><div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;padding:20px;background:#eee"><p>We use cookies.</p><button onclick="location.reload()">Reject all</button></div>`
  })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
  if (mock) {
    mock.server.closeAllConnections()
    mock.server.close()
    mock = null
  }
})

async function addProvider() {
  mock = await startAiMock()
  await go(h, 'sc://ai')
  const page = await h.page('sc://ai')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await page.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await page.getByRole('combobox', { name: 'API format' }).selectOption('openai')
  await page.getByRole('textbox', { name: 'API key' }).fill('test-key-not-real-12345')
  await page.getByRole('button', { name: 'Add provider' }).click()
  await expect(page.getByText('Connected, 1 model available')).toBeVisible()
  await page.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')
}

test('a page that reloads itself without end is stopped', async () => {
  h = await launch()
  await go(h, site.url('/reloads'))
  await expect.poll(activeUrl, { timeout: 15_000 }).toContain('sc://error')
  expect(new URL(await activeUrl()).searchParams.get('reason')).toContain('kept reloading')
})

test('a cookie banner that comes back after every reject is only pressed a couple of times', async () => {
  h = await launch()
  await go(h, site.url('/banner'))
  await h.chrome.waitForTimeout(5000)
  const title = await main((g) => g.scbTabs.tabs.get(g.scbTabs.active.id).view.webContents.getTitle() as string)
  const loads = Number(/Loads (\d+)/.exec(title)?.[1] ?? 0)
  expect(loads).toBeGreaterThanOrEqual(2)
  expect(loads).toBeLessThanOrEqual(3)
})

test('Terra Code works inside the assistant, shows its plan and changes, and undoes them', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-code-'))
  writeFileSync(join(folder, 'greeting.txt'), 'hello\n')
  try {
    h = await launch()
    await addProvider()
    await setSetting(h, { coderFolder: folder, coderMode: 'edits' })
    mock!.queue.push(
      [
        'Planning and changing both files.',
        '```tool\n{"tool":"todo","items":[{"text":"Change the greeting","done":true},{"text":"Add notes","done":false}]}\n```',
        '```tool\n{"tool":"edit","path":"greeting.txt","find":"hello","replace":"goodbye"}\n```',
        '```tool\n{"tool":"write","path":"notes.txt","content":"new notes\\n"}\n```'
      ].join('\n'),
      'Changed the greeting and added notes.'
    )
    await go(h, 'sc://assistant')
    const page = await h.page('sc://assistant')
    // Typing /code in the chat hands the task to Terra Code.
    await page.getByRole('textbox', { name: 'Message the assistant' }).fill('/code Say goodbye and add notes')
    await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
    await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Changed the greeting and added notes.')).toBeVisible()
    // Both tool calls in one reply ran.
    expect(mock!.requests).toHaveLength(2)
    expect(readFileSync(join(folder, 'greeting.txt'), 'utf8')).toBe('goodbye\n')
    await expect(page.getByRole('region', { name: 'Plan' })).toContainText('1 of 2')
    const changed = page.getByRole('region', { name: 'Changed files' })
    await expect(changed).toContainText('2 files changed')
    await changed.getByRole('button', { name: /2 files changed/ }).click()
    await changed.getByRole('button', { name: /greeting\.txt/ }).click()
    await expect(changed).toContainText('+ goodbye')
    await changed.getByRole('button', { name: 'Undo changes' }).click()
    await changed.getByRole('button', { name: 'Undo all' }).click()
    await expect(page.getByText('Put 2 files back as they were.')).toBeVisible()
    expect(readFileSync(join(folder, 'greeting.txt'), 'utf8')).toBe('hello\n')
    expect(existsSync(join(folder, 'notes.txt'))).toBe(false)
    // And back to chat.
    await page.getByRole('tab', { name: 'Chat' }).click()
    await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toBeVisible()
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('when AI can’t be reached, the assistant offers a VPN', async () => {
  h = await launch()
  await addProvider()
  mock!.server.closeAllConnections()
  await new Promise<void>((resolve) => mock!.server.close(() => resolve()))
  mock = null
  await go(h, 'sc://assistant')
  const page = await h.page('sc://assistant')
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill('Hello?')
  await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
  const help = page.getByRole('alert').filter({ hasText: 'Turn on a VPN to use AI?' })
  await expect(help).toBeVisible()
  // No VPN added yet, so it offers the starting one, with the warning.
  await expect(help.getByRole('button', { name: 'Use starting VPN connection' })).toBeVisible()
  await expect(help).toContainText('aren’t secure')
})

test('the VPN page offers the starting connection until one is added', async () => {
  h = await launch()
  await go(h, 'sc://vpn')
  const page = await h.page('sc://vpn')
  const card = page.getByRole('region', { name: 'Starting VPN connection' })
  await expect(card.getByRole('button', { name: 'Use starting VPN connection' })).toBeVisible()
  await expect(card).toContainText('Secure (https) sites stay encrypted')
  await page.getByRole('textbox', { name: 'Connection links' }).fill('socks5://127.0.0.1:1080#Mine')
  await page.getByRole('button', { name: 'Add links' }).click()
  await expect(card).toBeHidden()
})
