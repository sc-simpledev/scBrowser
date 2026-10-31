import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, omnibox, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

const API_KEY = 'test-key-not-real-12345'

let h: Harness
let site: Site
let mock: AiMock

test.beforeEach(async () => {
  mock = await startAiMock()
  site = await serveSite({
    '/article': titled('Long read', `<article>${'<p>The secret ingredient is cardamom, and this paragraph repeats so the page reads as an article.</p>'.repeat(6)}</article>`),
    '/other': titled('Second tab', '<p>The second tab talks about rhubarb.</p>')
  })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  mock.server.closeAllConnections()
  mock.server.close()
  site.server.close()
})

async function addProvider(format: 'openai' | 'anthropic') {
  await go(h, 'sc://ai')
  const page = await h.page('sc://ai')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await page.getByRole('textbox', { name: 'Base URL' }).fill(format === 'openai' ? `${mock.url}/v1` : mock.url)
  await page.getByRole('combobox', { name: 'API format' }).selectOption(format)
  await page.getByRole('textbox', { name: 'API key' }).fill(API_KEY)
  await page.getByRole('button', { name: 'Add provider' }).click()
  const picker = page.getByRole('combobox', { name: 'Chat model for Mock AI' })
  await expect(page.getByText('Connected, 1 model available')).toBeVisible()
  await picker.selectOption('mock-model')
  await expect(picker).toHaveValue('mock-model')
  return page
}

const panel = () => h.chrome.getByRole('complementary', { name: 'Assistant' })
const composer = () => panel().getByRole('textbox', { name: 'Message the assistant' })

async function ask(text: string) {
  await composer().fill(text)
  await composer().press('Enter')
}

async function openOnArticle() {
  await go(h, site.url('/article'))
  await expect(activeTab(h)).toHaveText('Long read')
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await expect(composer()).toBeVisible()
}

const lastUserMessage = () => mock.requests.at(-1)?.body.messages?.at(-1)?.content ?? ''

test('prompts for setup until a provider exists', async () => {
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await panel().getByRole('button', { name: 'Set up AI' }).click()
  await h.page('sc://ai')
})

test('chats about the page through an OpenAI-compatible provider', async () => {
  await addProvider('openai')
  await openOnArticle()
  await ask('What is the ingredient?')

  await expect(panel().getByText('Hello there')).toBeVisible()
  await expect(panel().getByText('Read Long read')).toBeVisible()

  const request = mock.requests.at(-1)!
  expect(request.headers.authorization).toBe(`Bearer ${API_KEY}`)
  expect(request.headers.cookie).toBeUndefined()
  expect(lastUserMessage()).toContain('cardamom')
  expect(lastUserMessage()).toContain('What is the ingredient?')

  // Follow-ups carry the history but not the earlier page wrapper.
  await ask('Thanks')
  await expect(panel().getByText('Hello there')).toHaveCount(2)
  expect(mock.requests.at(-1)?.body.messages?.[1]?.content).toBe('What is the ingredient?')
})

test('streams from an Anthropic-format endpoint with the official SDK', async () => {
  await addProvider('anthropic')
  await openOnArticle()
  await ask('Hi')
  await expect(panel().getByText('Hello there')).toBeVisible()
  expect(mock.requests.at(-1)?.headers.authorization).toBe(`Bearer ${API_KEY}`)
  expect(mock.requests.at(-1)?.url).toBe('/v1/messages')
})

test('never renders images or HTML from a reply', async () => {
  await addProvider('openai')
  await openOnArticle()
  mock.reply = [`Look ![leak](${mock.url}/leak?data=secret) <img src="${mock.url}/leak2" onerror="alert(1)"> [ok](javascript:alert(1)) done`]
  await ask('Hi')
  await expect(panel().getByText('done')).toBeVisible()
  await expect(panel().locator('img')).toHaveCount(0)
  await expect(panel().locator('a')).toHaveCount(0)
  expect(mock.strayHits).toEqual([])
})

test('keeps page text out when it is switched off, or the site is off', async () => {
  await addProvider('openai')
  await openOnArticle()

  await panel().getByRole('button', { name: 'Long read' }).click()
  await ask('First')
  await expect(panel().getByText('Hello there')).toBeVisible()
  expect(lastUserMessage()).toBe('First')

  await panel().getByRole('button', { name: 'New chat' }).click()
  await panel().getByRole('button', { name: 'Off for this site' }).click()
  await expect(panel().getByRole('button', { name: 'Allow AI on this site' })).toBeVisible()
  await ask('Second')
  await expect(panel().getByText('Hello there')).toBeVisible()
  expect(lastUserMessage()).toBe('Second')
})

test('shows a readable error, and stop ends a reply', async () => {
  await addProvider('openai')
  await openOnArticle()

  mock.status = 401
  await ask('Hi')
  await expect(panel().getByRole('alert')).toContainText('rejected the API key')
  await expect(panel().getByRole('alert')).not.toContainText('nope')

  mock.status = 200
  mock.hang = true
  await ask('Again')
  await expect(panel().getByText('Hello')).toBeVisible()
  await panel().getByRole('button', { name: 'Stop' }).click()
  await expect(panel().getByRole('button', { name: 'Send' })).toBeVisible()
})

test('asks from the address bar without sending the page', async () => {
  await addProvider('openai')
  await go(h, site.url('/article'))
  await expect(activeTab(h)).toHaveText('Long read')

  await omnibox(h).click()
  await omnibox(h).fill('why is the sky blue')
  const overlay = await h.overlay()
  await expect(overlay.getByRole('option', { name: /Ask scDelta/ })).toBeVisible()
  expect(mock.requests).toHaveLength(0)
  await omnibox(h).press('ArrowDown')
  await omnibox(h).press('Enter')

  await expect(panel().getByText('Hello there')).toBeVisible()
  expect(lastUserMessage()).toBe('why is the sky blue')
})

test('reads PDFs in the viewer', async () => {
  await addProvider('openai')
  await go(h, site.url('/report.pdf'))
  await expect(omnibox(h)).toHaveValue(site.url('/report.pdf'))
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await expect(panel().getByText(/report\.pdf/)).toBeVisible()
  await ask('What is the code word?')
  await expect(panel().getByText('Hello there')).toBeVisible()
  await expect(panel().getByText(/Read the PDF/)).toBeVisible()
  expect(lastUserMessage()).toContain('marigold')
})

test('explains when a PDF has no text', async () => {
  await addProvider('openai')
  await go(h, site.url('/empty.pdf'))
  await expect(omnibox(h)).toHaveValue(site.url('/empty.pdf'))
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await expect(panel().getByText(/empty\.pdf/)).toBeVisible()
  await ask('Hi')
  await expect(panel().getByRole('alert')).toContainText('no text')
  expect(mock.requests).toHaveLength(0)
})

test('keeps chats across restarts without storing page text', async () => {
  await addProvider('openai')
  await openOnArticle()
  await ask('What is the ingredient?')
  await expect(panel().getByText('Hello there')).toBeVisible()
  await h.close()

  for (const file of readdirSync(h.profile).filter((f) => f.startsWith('browser.db'))) {
    expect(readFileSync(join(h.profile, file)).includes('cardamom')).toBe(false)
  }

  h = await launch(h.profile)
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await panel().getByRole('button', { name: 'Saved chats' }).click()
  await panel().getByRole('button', { name: 'What is the ingredient?' }).click()
  await expect(panel().getByText('Hello there')).toBeVisible()

  await ask('And another')
  await expect(panel().getByText('Hello there')).toHaveCount(2)
  expect(mock.requests.at(-1)?.body.messages?.filter((m) => m.role === 'user')).toHaveLength(2)

  await panel().getByRole('button', { name: 'Saved chats' }).click()
  await panel().getByRole('listitem').hover()
  await panel().getByRole('button', { name: 'Delete chat' }).click()
  await expect(panel().getByText('No saved chats yet.')).toBeVisible()
})

test('does not save chats when that is turned off', async () => {
  await addProvider('openai')
  await setSetting(h, { saveChats: false })
  await openOnArticle()
  await ask('Private question')
  await expect(panel().getByText('Hello there')).toBeVisible()
  await panel().getByRole('button', { name: 'Saved chats' }).click()
  await expect(panel().getByText('No saved chats yet.')).toBeVisible()
})

test('keyboard shortcut toggles the panel', async () => {
  await shortcut(h, 'A', ['control', 'shift'])
  await expect(panel()).toBeVisible()
  await shortcut(h, 'A', ['control', 'shift'])
  await expect(panel()).toHaveCount(0)
})

test('stores keys encrypted, keeps them after restart, and hides them from pages', async () => {
  const page = await addProvider('openai')
  const state = await page.evaluate(() => (window as unknown as { scbInternal: { invoke(c: string): Promise<unknown> } }).scbInternal.invoke('ai:state'))
  expect(JSON.stringify(state)).not.toContain(API_KEY)
  await h.close()

  for (const file of readdirSync(h.profile).filter((f) => f.startsWith('browser.db'))) {
    expect(readFileSync(join(h.profile, file)).includes(API_KEY)).toBe(false)
  }

  h = await launch(h.profile)
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await ask('After restart')
  await expect(panel().getByText('Hello there')).toBeVisible()
  expect(mock.requests.at(-1)?.headers.authorization).toBe(`Bearer ${API_KEY}`)
})

test('@ brings another tab into the message', async () => {
  await addProvider('openai')
  await go(h, site.url('/other'))
  await expect(activeTab(h)).toHaveText('Second tab')
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await go(h, site.url('/article'))
  await expect(activeTab(h)).toHaveText('Long read')
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()

  await composer().pressSequentially('Compare @sec')
  await expect(panel().getByRole('option', { name: 'Second tab' })).toBeVisible()
  await composer().press('Enter')
  await expect(panel().getByRole('button', { name: 'Remove Second tab' })).toBeVisible()
  await composer().pressSequentially('these')
  await composer().press('Enter')

  await expect(panel().getByText('Hello there')).toBeVisible()
  expect(lastUserMessage()).toContain('cardamom')
  expect(lastUserMessage()).toContain('rhubarb')
  expect(lastUserMessage()).not.toContain('@sec')
})

test('/ runs a saved skill, and skills can be added', async () => {
  const page = await addProvider('openai')
  await page.getByRole('textbox', { name: 'Skill name' }).fill('Haiku it')
  await page.getByRole('textbox', { name: 'Skill prompt' }).fill('Turn this page into a haiku.')
  await page.getByRole('button', { name: 'Add skill' }).click()
  await expect(page.getByText('Turn this page into a haiku.')).toBeVisible()

  await openOnArticle()
  await composer().pressSequentially('/hai')
  await expect(panel().getByRole('option', { name: 'Haiku it' })).toBeVisible()
  await composer().press('Enter')
  await expect(panel().getByText('Hello there')).toBeVisible()
  expect(lastUserMessage()).toContain('Turn this page into a haiku.')
})

test.describe('hosted scDelta AI', () => {
  test.beforeEach(async () => {
    await h.close()
    process.env.SCDELTA_AI_URL = `${mock.url}/v1`
    h = await launch()
  })

  test.afterEach(() => {
    delete process.env.SCDELTA_AI_URL
  })

  test('works with no key, only after choosing it, and explains its limit', async () => {
    await h.chrome.getByRole('button', { name: 'Assistant' }).click()
    await panel().getByRole('button', { name: 'Use scDelta AI' }).click()
    await expect(composer()).toBeVisible()
    await expect(panel().getByText('scDelta AI', { exact: true })).toBeVisible()
    expect(mock.requests).toHaveLength(0)

    await ask('Hello')
    await expect(panel().getByText('Hello there')).toBeVisible()
    expect(mock.requests.at(-1)?.headers.authorization).toBeUndefined()

    mock.status = 429
    await ask('Again')
    await expect(panel().getByRole('alert')).toContainText('free scDelta AI limit')
  })
})

test('hides scDelta AI when this build has no server', async () => {
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await expect(panel().getByRole('button', { name: 'Set up AI' })).toBeVisible()
  await expect(panel().getByRole('button', { name: 'Use scDelta AI' })).toHaveCount(0)
})
