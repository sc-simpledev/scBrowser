import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, newProfile, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock | null = null
let pages: Record<string, string>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>

const LOGIN = `<!doctype html><title>Sign in</title><form onsubmit="event.preventDefault(); document.title = 'Signed in as ' + u.value"><input id="u" name="username" autocomplete="username"><input id="p" type="password" name="password" autocomplete="current-password"><button>Sign in</button></form>`
const SIGNUP = `<!doctype html><title>Sign up</title><form onsubmit="event.preventDefault()"><input id="e" type="email" name="email" autocomplete="email"><input id="p1" type="password" autocomplete="new-password"><input id="p2" type="password" name="confirm"><button>Create account</button></form>`
const STEP_NAME = `<!doctype html><title>Step one</title><form action="/step-pass"><input id="u" name="email" type="email" autocomplete="username"><button>Next</button></form>`
const STEP_PASS = `<!doctype html><title>Step two</title><form onsubmit="event.preventDefault(); document.title = 'Signed in'"><input id="p" type="password" autocomplete="current-password"><button>Sign in</button></form>`

test.beforeEach(async () => {
  pages = {
    '/alpha': titled('Alpha page'),
    '/beta': titled('Beta page'),
    '/gamma': titled('Gamma page'),
    '/login': LOGIN,
    '/signup': SIGNUP,
    '/step-name': STEP_NAME,
    '/step-pass': STEP_PASS,
    '/step-pass?email=kim%40example.com': STEP_PASS,
    // Dark on a wrapper, with the body left see-through, as many dark sites are.
    '/wrapped-dark': `<!doctype html><title>Wrapped dark</title><style>html,body{margin:0;height:100%}#app{min-height:100%;background:#121212;color:#eee}</style><div id="app"><h1>Dark app</h1><p>Text</p></div>`,
    '/light': titled('Light page', '<p>Plain white page.</p>'),
    '/search': `<!doctype html><div class="result"><a class="result__a" href="/l/?uddg=__SITE__%2Fanswer">The answer page</a><a class="result__snippet">About the moon</a></div>`,
    '/answer': `<!doctype html><title>The answer page</title><main>${'<p>The moon is made of basalt, according to this test page, which repeats itself.</p>'.repeat(5)}</main>`
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

async function noMasterVault() {
  await go(h, 'sc://passwords')
  const page = await h.page('sc://passwords')
  await page.getByRole('radio', { name: /No master password/ }).check()
  await page.getByRole('button', { name: 'Create vault' }).click()
  await expect(page.getByRole('region', { name: 'Logins' })).toBeVisible()
  return page
}

const saveLogin = (page: Awaited<ReturnType<typeof noMasterVault>>, url: string, username: string, password: string) =>
  page.evaluate((entry) => (window as unknown as { scbInternal: { invoke: (c: string, e: unknown) => Promise<unknown> } }).scbInternal.invoke('passwords:save', entry), { url, username, password, note: '' })

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

test('developer tools open beside the page without a second window, and close from their bar', async () => {
  h = await launch()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  await shortcut(h, 'F12', [])
  await expect.poll(() => main((g) => g.scbTabs.tabs.get(g.scbTabs.active.id).devTools?.webContents.getURL() ?? '')).toContain('devtools://')
  await h.chrome.waitForTimeout(1500)
  // Docked DevTools used to open the device toolbar's frame as a window of its own.
  expect(await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  expect(await h.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((c) => c.getURL().includes('device_mode_emulation_frame')).length)).toBe(0)
  const bar = h.chrome.getByTestId('devtools-bar')
  await expect(bar).toContainText('Developer tools')
  // DevTools sit below their bar.
  const [toolsY, pageY] = await main((g) => [g.scbTabs.tabs.get(g.scbTabs.active.id).devTools.getBounds().y, g.scbTabs.tabs.get(g.scbTabs.active.id).view.getBounds().y])
  expect(toolsY).toBeGreaterThan(pageY)
  await bar.getByRole('button', { name: 'Close developer tools' }).click()
  await expect(bar).toHaveCount(0)
  await expect.poll(() => main((g) => !!g.scbTabs.tabs.get(g.scbTabs.active.id).devTools)).toBe(false)
})

test('a list of saved logins hangs under a sign-in field and fills the form', async () => {
  h = await launch()
  const vault = await noMasterVault()
  await saveLogin(vault, site.url('/'), 'sam', 'first-secret')
  await saveLogin(vault, site.url('/'), 'alex', 'second-secret')
  await go(h, site.url('/login'))
  const login = await h.page('/login')
  await expect(login).toHaveTitle('Sign in')
  // Two logins: nothing is filled by itself.
  await login.waitForTimeout(500)
  await expect(login.locator('#p')).toHaveValue('')
  await login.locator('#u').click()
  const overlay = await h.overlay()
  const list = overlay.getByRole('listbox', { name: /Saved passwords for 127\.0\.0\.1/ })
  await expect(list).toBeVisible()
  await expect(list).toContainText('sam')
  await expect(list).toContainText('alex')
  await expect(list).not.toContainText('secret')
  await list.getByRole('option', { name: /alex/ }).click()
  await expect(login.locator('#u')).toHaveValue('alex')
  await expect(login.locator('#p')).toHaveValue('second-secret')
  await expect(list).toHaveCount(0)
})

test('one saved login fills by itself as the page opens, and not when turned off', async () => {
  h = await launch()
  const vault = await noMasterVault()
  await saveLogin(vault, site.url('/'), 'sam', 'only-secret')
  await go(h, site.url('/login'))
  const login = await h.page('/login')
  await expect(login.locator('#u')).toHaveValue('sam')
  await expect(login.locator('#p')).toHaveValue('only-secret')
  await setSetting(h, { passwordAutoFill: false })
  await login.reload()
  await login.waitForTimeout(800)
  await expect(login.locator('#p')).toHaveValue('')
})

test('a sign-up form is offered a strong password, filled into both fields', async () => {
  h = await launch()
  await noMasterVault()
  await go(h, site.url('/signup'))
  const signup = await h.page('/signup')
  await expect(signup).toHaveTitle('Sign up')
  await signup.locator('#p1').click()
  const overlay = await h.overlay()
  const list = overlay.getByRole('listbox')
  await list.getByRole('option', { name: 'Use a strong password' }).click()
  const made = await signup.locator('#p1').inputValue()
  expect(made.length).toBeGreaterThanOrEqual(16)
  await expect(signup.locator('#p2')).toHaveValue(made)
})

test('a sign-in over two pages is saved with the name from the first', async () => {
  h = await launch()
  await noMasterVault()
  await go(h, site.url('/step-name'))
  const first = await h.page('/step-name')
  await first.locator('#u').fill('kim@example.com')
  await first.getByRole('button', { name: 'Next' }).click()
  const second = await h.page('/step-pass')
  await expect(second).toHaveTitle('Step two')
  await second.locator('#p').fill('two-step-secret')
  await second.getByRole('button', { name: 'Sign in' }).click()
  const overlay = await h.overlay()
  const prompt = overlay.getByRole('dialog', { name: 'Save password' })
  await expect(prompt).toContainText('kim@example.com')
})

test('force dark leaves a page dark on a wrapper alone, and softens light pages', async () => {
  const profile = newProfile()
  writeFileSync(join(profile, 'flags.json'), JSON.stringify(['force-dark-pages']))
  h = await launch(profile)
  await go(h, site.url('/wrapped-dark'))
  const dark = await h.page('/wrapped-dark')
  await expect(dark).toHaveTitle('Wrapped dark')
  await h.chrome.waitForTimeout(1800)
  expect(await dark.evaluate(() => getComputedStyle(document.documentElement).filter)).toBe('none')
  await go(h, site.url('/light'))
  const light = await h.page('/light')
  await expect.poll(() => light.evaluate(() => getComputedStyle(document.documentElement).filter)).toContain('contrast(0.9)')
})

test('a closed tab group can be reopened with all its tabs', async () => {
  h = await launch()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  for (const path of ['/beta', '/gamma']) await main((g, url: string) => g.scbTabs.create(url), site.url(path))
  await expect(h.chrome.getByRole('tab')).toHaveCount(3)
  await expect.poll(() => main((g) => g.scbTabs.snapshot().tabs.map((tab: any) => tab.title).join())).toBe('Alpha page,Beta page,Gamma page')
  await main((g) => {
    const ids = g.scbTabs.snapshot().tabs.filter((tab: any) => /beta|gamma/.test(tab.url)).map((tab: any) => tab.id)
    g.scbTabs.setGroup(ids, 'Reading')
  })
  await main((g) => g.scbActions.closeGroup('Reading', true))
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
  await go(h, 'sc://archive')
  const archive = await h.page('sc://archive')
  const group = archive.getByRole('region', { name: 'Closed tab groups' })
  await expect(group).toContainText('Reading')
  await expect(group).toContainText('2 tabs')
  await group.getByRole('button', { name: 'Reopen' }).click({ force: true })
  await expect.poll(() => main((g) => g.scbTabs.snapshot().tabs.filter((tab: any) => tab.group === 'Reading').map((tab: any) => tab.title).join())).toBe('Beta page,Gamma page')
  await expect(group).toHaveCount(0)
})

test('the assistant can search the web and cite what it found', async () => {
  h = await launch(undefined, [], { SCB_SEARCH_URL: site.url('/search') })
  await addProvider()
  // Local test pages are plain http.
  await setSetting(h, { httpsOnly: false })
  await go(h, 'sc://assistant')
  const page = await h.page('sc://assistant')
  await page.getByRole('button', { name: 'Web' }).click()
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill('What is the moon made of?')
  await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
  await expect.poll(() => mock!.requests.length).toBeGreaterThan(0)
  const sent = mock!.requests.at(-1)!.body.messages!.at(-1)!.content
  expect(sent).toContain('basalt')
  expect(sent).toContain('<page id="1"')
  expect(sent).toContain('The answer page')
})

test('the coding agent works only in its folder and asks before changing a file', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-code-'))
  writeFileSync(join(folder, 'greeting.txt'), 'hello\n')
  try {
    h = await launch()
    await addProvider()
    await setSetting(h, { coderFolder: folder, coderMode: 'ask' })
    mock!.queue.push(
      'Reading it.\n```tool\n{"tool":"read","path":"greeting.txt"}\n```',
      'Changing it.\n```tool\n{"tool":"edit","path":"greeting.txt","find":"hello","replace":"goodbye"}\n```',
      'Trying outside.\n```tool\n{"tool":"read","path":"../../etc/hostname"}\n```',
      'Changed the greeting to goodbye.'
    )
    await go(h, 'sc://code')
    const page = await h.page('sc://code')
    await expect(page.getByRole('heading', { name: 'Terra Code' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Describe a change' }).fill('Say goodbye instead')
    await page.getByRole('textbox', { name: 'Describe a change' }).press('Enter')
    const card = page.getByRole('group', { name: 'Edit greeting.txt' })
    await expect(card).toContainText('- hello')
    await expect(card).toContainText('+ goodbye')
    expect(readFileSync(join(folder, 'greeting.txt'), 'utf8')).toBe('hello\n')
    await card.getByRole('button', { name: 'Apply change' }).click()
    await expect(page.getByText('Changed the greeting to goodbye.')).toBeVisible()
    expect(readFileSync(join(folder, 'greeting.txt'), 'utf8')).toBe('goodbye\n')
    // The model was told the read outside the folder was refused.
    expect(mock!.requests.at(-1)!.body.messages!.at(-1)!.content).toContain('outside the project folder')
    // Other pages can't drive it.
    const other = await (async () => {
      await go(h, 'sc://settings')
      return h.page('sc://settings')
    })()
    const refused = await other.evaluate(() => (window as unknown as { scbInternal: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).scbInternal.invoke('coder:run', 'x', 'delete everything').then(() => 'ran', (error: Error) => error.message))
    expect(refused).toContain('Only sc://code')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
