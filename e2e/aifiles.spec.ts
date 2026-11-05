import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { go, launch, serveSite, setSetting, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock
/** Every request the local site got, to prove a preview can't reach it. */
let hits: string[]

/** Files and presets are only on the full-page assistant. */
let page: Page
const panel = () => page
const filePane = () => page.getByRole('region', { name: 'File' })

test.beforeEach(async () => {
  mock = await startAiMock()
  site = await serveSite({ '/': '<!doctype html><title>Home</title><p>Home</p>' })
  hits = []
  site.server.on('request', (req) => hits.push(req.url ?? ''))
  // The https test's certificate is made up on the spot.
  h = await launch(undefined, ['--ignore-certificate-errors'])
  // HTTPS-only would stop the local site's plain http on its own, which would hide whether the preview's guard works.
  await setSetting(h, { httpsOnly: false })
  await go(h, 'sc://ai')
  page = await h.page('sc://ai')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await page.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await page.getByRole('button', { name: 'Add provider' }).click()
  await expect(page.getByText('Connected, 1 model available')).toBeVisible()
  await page.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')
  await go(h, 'sc://assistant')
  page = await h.page('sc://assistant')
  await expect(page.getByRole('button', { name: 'Make a report' })).toBeVisible()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  mock.server.closeAllConnections()
  mock.server.close()
  site.server.close()
})

const ask = async (text: string) => {
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('the assistant writes a file, previews it with no way out, and edits it', async () => {
  const leak = site.url('/collect')
  const html = `<!doctype html><title>Counter</title><h1 id="out">Hello from the file</h1>
<script>
  document.getElementById('out').dataset.ran = 'yes'
  fetch('${leak}?via=fetch').catch(() => {})
  new Image().src = '${leak}?via=image'
  // Chromium stops plain http in a secure frame by itself, so the guard is tested with a page it would allow.
  setTimeout(() => { location.href = 'data:text/html,<h1 id=escaped>Escaped</h1>' }, 1500)
</script>`
  mock.queue = [`Here's a page.\n\`\`\`\`scterra-file name="index.html"\n${html}\n\`\`\`\`\nOpen it beside the chat.`]
  await ask('Make a counter page')

  await expect(panel().getByRole('button', { name: 'Open index.html' })).toContainText('Created')
  await expect(filePane()).toBeVisible()
  const preview = page.frameLocator('iframe[title="Preview of index.html"]')
  await expect(preview.locator('#out')).toHaveText('Hello from the file')
  await expect(preview.locator('#out')).toHaveAttribute('data-ran', 'yes')
  // Long enough for the navigation to have gone through, had it been allowed.
  await new Promise((resolve) => setTimeout(resolve, 2500))
  expect(hits.filter((url) => url.startsWith('/collect'))).toEqual([])
  expect(page.frames().map((frame) => frame.url()).some((url) => url.startsWith('data:'))).toBe(false)
  await expect(preview.locator('#escaped')).toHaveCount(0)

  await filePane().getByRole('tab', { name: 'Code' }).click()
  await expect(filePane().getByLabel('Code of index.html')).toContainText('Hello from the file')

  mock.queue = ['Changed the heading.\n````scterra-edit name="index.html"\n<<<<<<< FIND\n<h1 id="out">Hello from the file</h1>\n=======\n<h1 id="out">Edited heading</h1>\n>>>>>>> REPLACE\n````']
  await filePane().getByRole('textbox', { name: 'Change to make' }).fill('Change the heading')
  await filePane().getByRole('button', { name: 'Ask for this change' }).click()
  await expect(filePane().getByRole('status').filter({ hasText: 'Version 2 of 2' })).toBeVisible()
  await expect(filePane().getByLabel('Code of index.html')).toContainText('Edited heading')
  // The change request carried the file as it was, and reads back as what was asked.
  expect(mock.requests.at(-1)!.body.messages!.at(-1)!.content).toContain('Hello from the file')
  await expect(panel().getByText('Change to index.html: Change the heading')).toBeVisible()
  await expect(panel().getByRole('button', { name: 'Open index.html' }).last()).toContainText('Edited')

  await filePane().getByRole('button', { name: 'Earlier version' }).click()
  await expect(filePane().getByLabel('Code of index.html')).toContainText('Hello from the file')
})

/**
 * A throwaway https site, as a real leak would use one. Requests are stopped by the preview's own
 * policy, and leaving by sc://assistant's frame-src, before `guardPreviewFrames` is even asked.
 */
async function httpsSite(): Promise<{ url: string; hits: string[]; close: () => void } | null> {
  try {
    const folder = mkdtempSync(join(tmpdir(), 'scb-cert-'))
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', join(folder, 'key.pem'), '-out', join(folder, 'cert.pem')], { stdio: 'ignore' })
    const received: string[] = []
    const server = createServer({ key: readFileSync(join(folder, 'key.pem')), cert: readFileSync(join(folder, 'cert.pem')) }, (req, res) => {
      received.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'text/html' }).end('<h1 id="escaped">Escaped</h1>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, hits: received, close: () => server.close() }
  } catch {
    return null
  }
}

test('a preview can reach nothing over https either, by request or by leaving', async () => {
  const leak = await httpsSite()
  test.skip(!leak, 'openssl is needed to make a certificate')
  const port = leak!.url
  const html = `<!doctype html><h1 id="out">Hello</h1><script>
  fetch('${port}/collect?via=fetch').catch(() => {})
  new Image().src = '${port}/collect?via=image'
  setTimeout(() => { location.href = '${port}/collect?via=navigation' }, 800)
</script>`
  mock.queue = [`Here.\n\`\`\`\`scterra-file name="index.html"\n${html}\n\`\`\`\``]
  await ask('Make a page')
  await expect(page.frameLocator('iframe[title="Preview of index.html"]').locator('#out')).toHaveText('Hello')
  await new Promise((resolve) => setTimeout(resolve, 2500))
  expect(leak!.hits).toEqual([])
  expect(page.frames().some((frame) => frame.url().startsWith('https:'))).toBe(false)
  // The site really can be reached, so nothing arriving above means the preview was stopped.
  await go(h, `${port}/direct`)
  await expect.poll(() => leak!.hits).toContain('/direct')
  leak!.close()
})

test('an edit that does not match says so and leaves the file alone', async () => {
  mock.queue = ['Made it.\n````scterra-file name="notes.md"\n# Notes\n````', 'Changed.\n````scterra-edit name="notes.md"\n<<<<<<< FIND\nnot in the file\n=======\nx\n>>>>>>> REPLACE\n````']
  await ask('Write notes')
  await expect(filePane()).toBeVisible()
  await ask('Change them')
  await expect(panel().getByRole('button', { name: 'Open notes.md' }).last()).toContainText('didn’t match')
  await expect(filePane().getByRole('navigation', { name: 'Versions' })).toHaveCount(0)
})

test('a report preset sends its layout, reads back as the topic, and its report shows the new blocks', async () => {
  await panel().getByRole('button', { name: 'Report', exact: true }).click()
  await page.getByRole('dialog', { name: 'Report presets' }).getByRole('button', { name: /SWOT analysis/ }).click()
  await expect(panel().getByText('SWOT analysis report')).toBeVisible()
  const report = {
    kind: 'SWOT analysis',
    title: 'Corner bakery',
    summary: 'Where it stands.',
    theme: 'modern',
    blocks: [
      { type: 'stats', items: [{ value: '120', label: 'loaves a day' }] },
      { type: 'cards', items: [{ title: 'Strengths', text: 'Loyal regulars' }, { title: 'Threats', text: 'A chain nearby' }] },
      { type: 'proscons', pros: ['Fresh'], cons: ['Small'] },
      { type: 'timeline', items: [{ when: '2019', text: 'Opened' }] },
      { type: 'steps', items: [{ title: 'Extend hours', text: 'Open at six.' }] }
    ]
  }
  mock.queue = [`Here it is.\n\`\`\`scterra-report\n${JSON.stringify(report)}\n\`\`\``]
  await ask('Our bakery')

  const sent = mock.requests.at(-1)!.body.messages!.at(-1)!.content
  expect(sent).toContain('set "kind" to "SWOT analysis"')
  expect(sent).toContain('Topic: Our bakery')
  await expect(panel().getByText('SWOT analysis: Our bakery')).toBeVisible()
  await panel().getByRole('button', { name: 'Open report' }).click()
  const pane = page.getByRole('region', { name: 'Report' })
  await expect(pane.locator('.kind')).toHaveText('SWOT analysis')
  await expect(pane.locator('.stat-value')).toHaveText('120')
  await expect(pane.locator('.card-title')).toHaveText(['Strengths', 'Threats'])
  await expect(pane.locator('.timeline .when')).toHaveText('2019')
  await expect(pane.getByRole('combobox', { name: 'Design' })).toHaveValue('modern')
})

test('the sidebar assistant is left as it was, without files or presets', async () => {
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  const sidebar = h.chrome.getByRole('complementary', { name: 'Assistant' })
  await expect(sidebar.getByRole('textbox', { name: 'Message the assistant' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Report', exact: true })).toHaveCount(0)
  await sidebar.getByRole('textbox', { name: 'Message the assistant' }).fill('Hi')
  await sidebar.getByRole('button', { name: 'Send' }).click()
  await expect.poll(() => mock.requests.length).toBe(1)
  expect(JSON.stringify(mock.requests[0]!.body)).not.toContain('scterra-file')
})

test('a preview address never opens as a page', async () => {
  const id = await h.app.evaluate(() => {
    const tabs = (globalThis as unknown as { scbTabs: { create(url: string): number; snapshot(): { tabs: { id: number; url: string }[] } } }).scbTabs
    const created = tabs.create('sc-preview://anything/index.html')
    return tabs.snapshot().tabs.find((tab) => tab.id === created)!.url
  })
  expect(id).toBe('sc://newtab')
})
