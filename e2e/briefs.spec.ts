import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, newProfile, serveSite, setSetting, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>

test.beforeEach(async () => {
  const pages: Record<string, string> = {
    '/search': `<!doctype html><div class="result"><a class="result__a" href="/l/?uddg=__SITE__%2Fnews">Open model released</a><a class="result__snippet">A new open model</a></div>`,
    '/news': `<!doctype html><title>Open model released</title><main>${'<p>A lab released an open model with long context today, and it tops the coding charts.</p>'.repeat(5)}</main>`
  }
  site = await serveSite(pages)
  pages['/search'] = pages['/search']!.replace('__SITE__', encodeURIComponent(site.url('')))
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
  mock ??= await startAiMock()
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

test('a brief is set up, written from a web search, and shown on the toolbar, the new tab and at the next start', async () => {
  const profile = newProfile()
  h = await launch(profile, [], { SCB_SEARCH_URL: site.url('/search') })
  await addProvider()
  await setSetting(h, { httpsOnly: false })

  await go(h, 'sc://briefs')
  const page = await h.page('sc://briefs')
  await expect(page.getByText('No briefs yet')).toBeVisible()
  await page.getByRole('button', { name: 'New brief' }).click()
  const form = page.getByRole('form', { name: 'New brief' })
  await form.getByRole('button', { name: 'Latest AI news' }).click()
  await expect(form.getByRole('textbox', { name: 'Name' })).toHaveAttribute('placeholder', 'Latest AI news')
  await form.getByRole('radio', { name: 'Short' }).click()
  await expect(form).toContainText('A few bullet points')
  await form.getByRole('button', { name: 'Add brief' }).click()

  const scheduled = page.getByRole('region', { name: 'Scheduled briefs' })
  await expect(scheduled).toContainText('Latest AI news')
  await expect(scheduled).toContainText('Every day at 08:00 · Short')

  mock!.queue.push('- An open model with long context came out today [1].')
  await scheduled.getByRole('button', { name: 'Run now' }).click()
  const briefs = page.getByRole('region', { name: 'Your briefs' })
  await expect(briefs).toContainText('Your briefs · 1 new')
  await expect(briefs).toContainText('An open model with long context came out today')

  const sent = mock!.requests.at(-1)!.body
  expect(sent.messages!.find((message) => message.role === 'system')?.content).toContain('Keep it short')
  const asked = sent.messages!.at(-1)!.content
  expect(asked).toContain('<page id="1"')
  expect(asked).toContain('tops the coding charts')
  expect(asked).toContain('Write my short brief on: Latest AI news')

  // The toolbar says one is waiting.
  await expect(h.chrome.getByRole('button', { name: 'New brief', exact: true })).toBeVisible()

  // So does every new tab, with a menu of briefs in its corner.
  await main((g) => g.scbTabs.create())
  const newTab = await h.page('sc://newtab')
  const banner = newTab.getByRole('region', { name: 'New brief' })
  await expect(banner).toContainText('Latest AI news')
  await newTab.getByRole('button', { name: /^Briefs/ }).click()
  await expect(newTab.getByRole('menu', { name: 'AI Briefs' })).toContainText('Latest AI news')

  // Closed without reading it, scTerra opens it at the next start.
  await h.close()
  h = await launch(profile, [], { SCB_SEARCH_URL: site.url('/search') })
  await expect.poll(() => main((g) => g.scbTabs.active?.url ?? '')).toContain('sc://briefs')
  const reopened = await h.page('sc://briefs')
  const card = reopened.getByRole('article', { name: 'Latest AI news' })
  await expect(card.getByRole('button', { name: /Latest AI news/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByRole('heading', { name: 'Sources' })).toBeVisible()
  // Reading it clears the toolbar.
  await expect(h.chrome.getByRole('button', { name: 'New brief', exact: true })).toHaveCount(0)

  // And once read, it isn't opened again. Its tab is closed first, as the session would bring it back.
  await main((g) => g.scbTabs.snapshot().tabs.filter((tab: { url: string }) => tab.url.startsWith('sc://briefs')).forEach((tab: { id: number }) => g.scbTabs.close(tab.id)))
  await h.chrome.waitForTimeout(500)
  await h.close()
  h = await launch(profile, [], { SCB_SEARCH_URL: site.url('/search') })
  await h.chrome.waitForTimeout(1000)
  expect(await main((g) => g.scbTabs.snapshot().tabs.some((tab: { url: string }) => tab.url.startsWith('sc://briefs')))).toBe(false)
})

test('a brief can be changed, paused and removed', async () => {
  h = await launch()
  await go(h, 'sc://briefs')
  const page = await h.page('sc://briefs')
  await expect(page.getByText('Briefs need an AI model.')).toBeVisible()
  await page.getByRole('button', { name: 'New brief' }).click()
  const form = page.getByRole('form', { name: 'New brief' })
  await form.getByRole('textbox', { name: 'What should scAI research?' }).fill('Research what is new in Rust')
  await form.getByRole('combobox', { name: 'Repeat' }).selectOption('weekly')
  await form.getByRole('combobox', { name: 'Day' }).selectOption('1')
  await form.getByRole('textbox', { name: 'Time' }).fill('18:30')
  await form.getByRole('button', { name: 'Add brief' }).click()
  const scheduled = page.getByRole('region', { name: 'Scheduled briefs' })
  await expect(scheduled).toContainText('What is new in Rust')
  await expect(scheduled).toContainText('Every Monday at 18:30 · Medium')

  await scheduled.getByRole('button', { name: 'Change What is new in Rust' }).click()
  const edit = page.getByRole('form', { name: 'Change brief' })
  await edit.getByRole('textbox', { name: 'Name' }).fill('Rust')
  await edit.getByRole('radio', { name: 'Long' }).click()
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(scheduled).toContainText('Every Monday at 18:30 · Long')

  await scheduled.getByRole('switch', { name: 'Pause Rust' }).click()
  await expect(scheduled).toContainText('Paused')

  // Without a model, running it says what's missing.
  await scheduled.getByRole('button', { name: 'Run now' }).click()
  await expect(scheduled.getByRole('alert')).toContainText('Choose a model in AI settings first.')

  await scheduled.getByRole('button', { name: 'Remove Rust' }).click()
  await expect(scheduled).toHaveCount(0)
})
