import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, newProfile, serveSite, setSetting, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock
let folder = ''

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

test.beforeEach(async () => {
  mock = await startAiMock()
  folder = mkdtempSync(join(tmpdir(), 'scb-code-'))
  writeFileSync(join(folder, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n')
  site = await serveSite({ '/plain': titled('Plain page'), '/tracked': `<!doctype html><title>Tracked</title><script src="/tracker.js"></script><p>Words</p>` })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
  mock.server.close()
  rmSync(folder, { recursive: true, force: true })
})

const runCode = async (reply: string, done: string) => {
  mock.queue.push(reply, done)
  await go(h, 'sc://assistant/?mode=code')
  const page = await h.page('sc://assistant')
  await page.getByRole('textbox', { name: 'Describe a change' }).fill('Do it')
  await page.getByRole('textbox', { name: 'Describe a change' }).press('Enter')
  await expect(page.getByText(done)).toBeVisible()
  return page
}

test('a change can be put back while another is kept', async () => {
  h = await launch()
  await addProvider()
  await setSetting(h, { coderFolder: folder, coderMode: 'edits' })
  const page = await runCode('```tool\n{"tool":"write","path":"a.txt","content":"ONE\\ntwo\\nthree\\nfour\\nfive\\nsix\\nSEVEN\\n"}\n```', 'Wrote it.')
  await page.getByRole('region', { name: 'Changed files' }).getByRole('button', { name: 'Review' }).click()
  const review = page.getByRole('region', { name: 'Review changes' })
  await expect(review.getByRole('button', { name: 'Put back', exact: true })).toHaveCount(2)
  await review.getByRole('button', { name: 'Put back', exact: true }).first().click()
  await expect(review.getByRole('button', { name: 'Put back', exact: true })).toHaveCount(1)
  expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n')
  await review.getByRole('button', { name: 'Keep', exact: true }).click()
  await expect(review).toHaveCount(0)
  expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toContain('SEVEN')
})

test('a reopened chat still has its changes after a restart, and undo works', async () => {
  const profile = newProfile()
  h = await launch(profile)
  await addProvider()
  await setSetting(h, { coderFolder: folder, coderMode: 'edits' })
  await runCode('```tool\n{"tool":"write","path":"made.txt","content":"x\\n"}\n```', 'Made it.')
  const page = await h.page('sc://assistant')
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get('chat')), { timeout: 5000 }).toBeTruthy()
  const chat = await page.evaluate(() => new URL(location.href).searchParams.get('chat'))
  await h.close()
  h = await launch(profile)
  await go(h, `sc://assistant/?chat=${chat}`)
  const again = await h.page('sc://assistant')
  await again.getByRole('region', { name: 'Changed files' }).getByRole('button', { name: 'Review' }).click()
  const review = again.getByRole('region', { name: 'Review changes' })
  await review.getByRole('button', { name: 'Put back file' }).click()
  await expect.poll(() => existsSync(join(folder, 'made.txt'))).toBe(false)
})

test('open tabs save as a named set and open again as a group', async () => {
  h = await launch()
  await go(h, site.url('/plain'))
  await h.app.evaluate(() => (globalThis as never as { scbTabs: { create: (url: string) => void } }).scbTabs.create('sc://archive/'))
  const page = await h.page('sc://archive')
  await page.getByLabel('Name for this set of tabs').fill('Research')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const row = page.getByRole('region', { name: 'Saved tab sets' }).getByRole('listitem')
  await expect(row).toContainText('Research')
  await expect(row).toContainText('1 tab')
  await row.getByRole('button', { name: 'Open' }).click()
  await expect(row).toContainText('Research')
  await expect(h.chrome.getByText('Research').first()).toBeVisible()
})

test('memory notes reach the model', async () => {
  h = await launch()
  await addProvider()
  const ai = await h.page('sc://ai')
  await ai.getByLabel('New note').fill('I use pnpm')
  await ai.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(ai.getByLabel('Note', { exact: true })).toHaveValue('I use pnpm')
  mock.queue.push('Hello.')
  await go(h, 'sc://assistant')
  const page = await h.page('sc://assistant')
  const box = page.getByRole('textbox', { name: 'Message the assistant' })
  await box.fill('Hi')
  await box.press('Enter')
  await expect(page.getByText('Hello.')).toBeVisible()
  expect(JSON.stringify(mock.requests.at(-1))).toContain('I use pnpm')
})

test('the padlock lists what was blocked and sets a font for the site', async () => {
  h = await launch()
  await go(h, site.url('/tracked'))
  await expect.poll(() => h.app.evaluate(() => (globalThis as never as { scbTabs: { active: { blockedCount: number } } }).scbTabs.active.blockedCount)).toBeGreaterThan(0)
  await h.chrome.getByRole('button', { name: 'Site controls' }).click()
  const overlay = await h.overlay()
  const panel = overlay.getByRole('dialog', { name: /Controls for/ })
  await panel.getByRole('button', { name: /blocked on this page/ }).click()
  await expect(panel.getByRole('list', { name: 'Blocked on this page' })).toContainText('127.0.0.1')
  await panel.getByRole('combobox', { name: 'Font on this site' }).selectOption('serif')
  await expect(panel.getByRole('combobox', { name: 'Font on this site' })).toHaveValue('serif')
})
