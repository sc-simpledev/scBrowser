import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('sc://code leads to the assistant, and Terra Code chats are saved in its list and carry on', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-code-'))
  writeFileSync(join(folder, 'a.txt'), 'hello\n')
  try {
    h = await launch()
    await addProvider()
    await setSetting(h, { coderFolder: folder, coderMode: 'edits', saveChats: true })
    mock!.queue.push('Reading.\n```tool\n{"tool":"read","path":"a.txt"}\n```', 'It says hello.')
    await go(h, 'sc://code')
    const page = await h.page('sc://assistant')
    await page.getByRole('textbox', { name: 'Describe a change' }).fill('What does a.txt say')
    await page.getByRole('textbox', { name: 'Describe a change' }).press('Enter')
    await expect(page.getByText('It says hello.')).toBeVisible()
    const saved = page.getByRole('navigation', { name: 'Saved chats' }).getByRole('link', { name: /What does a\.txt say/ })
    await expect(saved).toBeVisible()
    await expect.poll(() => page.url()).toContain('chat=code-')

    // A fresh screen, then back to the saved chat through the shared list.
    await go(h, 'sc://assistant')
    const again = await h.page('sc://assistant')
    await again.getByRole('navigation', { name: 'Saved chats' }).getByRole('link', { name: /What does a\.txt say/ }).click()
    await expect(again.getByText('It says hello.')).toBeVisible()
    await expect(again.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')

    // Following up carries the earlier conversation.
    mock!.queue.push('Still hello.')
    await again.getByRole('textbox', { name: 'Describe a change' }).fill('Check again')
    await again.getByRole('textbox', { name: 'Describe a change' }).press('Enter')
    await expect(again.getByText('Still hello.')).toBeVisible()
    const sent = JSON.stringify(mock!.requests.at(-1)!.body.messages)
    expect(sent).toContain('What does a.txt say')
    expect(sent).toContain('It says hello.')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a run keeps going while looking at Chat', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-code-'))
  writeFileSync(join(folder, 'a.txt'), 'hello\n')
  try {
    h = await launch()
    await addProvider()
    await setSetting(h, { coderFolder: folder, coderMode: 'ask' })
    mock!.queue.push('```tool\n{"tool":"read","path":"a.txt"}\n```\n', '```tool\n{"tool":"write","path":"b.txt","content":"new"}\n```', 'Finished the work.')
    await go(h, 'sc://assistant/?mode=code')
    const page = await h.page('sc://assistant')
    await page.getByRole('textbox', { name: 'Describe a change' }).fill('Make b')
    await page.getByRole('textbox', { name: 'Describe a change' }).press('Enter')
    const card = page.getByRole('group', { name: 'Create b.txt' })
    await expect(card).toBeVisible()
    await page.getByRole('tab', { name: 'Chat' }).click()
    await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toBeVisible()
    await page.getByRole('tab', { name: 'Code' }).click()
    await card.getByRole('button', { name: 'Apply change' }).click()
    await expect(page.getByText('Finished the work.')).toBeVisible()
    expect(readFileSync(join(folder, 'b.txt'), 'utf8')).toBe('new')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
