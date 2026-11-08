import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, setSetting, type Harness } from './app'

let h: Harness
let mock: AiMock | null = null

test.afterEach(async () => {
  await h.close().catch(() => undefined)
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

test('toolbar buttons are evenly spaced when some have nothing to show', async () => {
  h = await launch()
  // A fresh profile has no VPN, vault or downloads, which is what the Windows copy looked like.
  const gaps = await h.chrome.locator('[data-toolbar-slot="back"]').evaluate((slot) => {
    const shown = [...slot.parentElement!.children].filter((child) => child.getBoundingClientRect().width > 0 && child.getAttribute('aria-hidden') === null)
    return shown.slice(1).map((child, i) => Math.round(child.getBoundingClientRect().left - shown[i]!.getBoundingClientRect().right))
  })
  expect(gaps.length).toBeGreaterThan(4)
  expect(new Set(gaps)).toEqual(new Set([4]))
})

test('Terra Code runs tools however the model writes them, and keeps them out of the chat', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-code-'))
  writeFileSync(join(folder, 'a.txt'), 'hello\n')
  try {
    h = await launch()
    await addProvider()
    await setSetting(h, { coderFolder: folder, coderMode: 'edits' })
    mock!.queue.push(
      // Two json fences, where only the first used to run and the second landed in the chat.
      'Looking first.\n```json\n{"tool":"read_file","file_path":"a.txt"}\n```\n```json\n{"tool":"write","path":"b.txt","content":"one\ntwo"}\n```',
      // Says it will act but doesn't, so it gets told to.
      'Let me add the last file.',
      '<tool_call>{"name":"write_file","arguments":{"path":"c.txt","content":"three"}}</tool_call>',
      'All three steps are finished.'
    )
    await go(h, 'sc://code')
    const page = await h.page('sc://code')
    await page.getByRole('textbox', { name: 'Describe a change' }).fill('Make the files')
    await page.getByRole('textbox', { name: 'Describe a change' }).press('Enter')
    await expect(page.getByText('All three steps are finished.')).toBeVisible()
    expect(mock!.requests).toHaveLength(4)
    expect(readFileSync(join(folder, 'b.txt'), 'utf8')).toBe('one\ntwo')
    expect(existsSync(join(folder, 'c.txt'))).toBe(true)
    const log = page.getByRole('log', { name: 'Terra Code' })
    await expect(log).not.toContainText('"tool"')
    await expect(log).not.toContainText('tool_call')
    await expect(log).toContainText('Read 1 file, wrote 1 file')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
