import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, omnibox, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock | null = null

/** A second of a quiet tone as a WAV, made by the page, so a real player plays real sound. */
const TONE = `<script>
  const rate = 8000, n = rate * 2, bytes = new DataView(new ArrayBuffer(44 + n * 2))
  const text = (at, s) => [...s].forEach((c, i) => bytes.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF'); bytes.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt '); bytes.setUint32(16, 16, true)
  bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true); bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true)
  bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); text(36, 'data'); bytes.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) bytes.setInt16(44 + i * 2, Math.sin(i / 4) * 800, true)
  const audio = document.createElement('audio')
  audio.loop = true
  audio.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  document.body.append(audio)
  audio.play()
</script>`

test.beforeEach(async () => {
  site = await serveSite({
    '/article?id=3': titled('Article three', '<p>Plain words.</p>'),
    '/article?utm_source=mail&id=3&fbclid=abc': titled('Tracked', '<p>Should not load with tags.</p>'),
    '/spices': titled('Spice notes', `<p>The secret ingredient is cardamom.</p>${'<p>Filler line.</p>'.repeat(40)}<p>More cardamom at the end.</p>`),
    '/rhubarb': titled('Rhubarb pie', '<p>Sour and sweet.</p>'),
    '/search?q=tea': titled('Local search for tea'),
    '/tone': titled('Tone player', TONE),
    '/muted': titled('Muted loop', TONE.replace('audio.loop = true', 'audio.loop = true; audio.muted = true')),
    '/long': titled('A long read', '<p>Start here.</p>' + '<p>Paragraph of the long read, going on and on.</p>'.repeat(300)),
    '/picture': titled('A picture', `<canvas id="c" width="200" height="120"></canvas><img id="shot" alt="" width="200" height="120"><script>
      const c = document.getElementById('c'); const g = c.getContext('2d'); g.fillStyle = '#c22'; g.fillRect(0, 0, 200, 120)
      document.getElementById('shot').src = c.toDataURL('image/png'); c.remove()
    </script>`)
  })
})

test.afterEach(async () => {
  await h?.close().catch(() => undefined)
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
  return page
}

const panel = () => h.chrome.getByRole('complementary', { name: 'Assistant' })
const composer = () => panel().getByRole('textbox', { name: 'Message the assistant' })

test('search keywords search a site from the address bar, and Tab adds the space', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false, searchKeywords: [{ keyword: 'loc', name: 'Local', template: site.url('/search?q=%s') }, { keyword: 'yt', name: 'YouTube', template: 'https://www.youtube.com/results?search_query=%s' }] })
  const overlay = await h.overlay()
  await omnibox(h).click()
  await omnibox(h).fill('yt')
  const keywordRow = overlay.getByRole('option', { name: /Search YouTube/ })
  await expect(keywordRow).toContainText('Tab')
  await omnibox(h).press('Tab')
  await expect(omnibox(h)).toHaveValue('yt ')
  await omnibox(h).pressSequentially('lofi')
  await expect(overlay.getByRole('option').first()).toContainText('lofiSearch YouTube')

  await omnibox(h).fill('loc tea')
  await omnibox(h).press('Enter')
  await expect(activeTab(h)).toHaveText('Local search for tea')

  // Settings lists them, and a new one can be added.
  await go(h, 'sc://settings/#search')
  const settings = await h.page('sc://settings')
  const keywords = settings.getByRole('region', { name: 'Search keywords' })
  await expect(keywords).toContainText('Local')
  await keywords.getByRole('textbox', { name: 'Keyword' }).fill('mdn')
  await keywords.getByRole('textbox', { name: 'Site name' }).fill('MDN')
  await keywords.getByRole('textbox', { name: 'Search address' }).fill('https://developer.mozilla.org/search?q=')
  await keywords.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(keywords.getByRole('alert')).toContainText('%s')
  await keywords.getByRole('textbox', { name: 'Search address' }).fill('https://developer.mozilla.org/search?q=%s')
  await keywords.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(keywords).toContainText('MDN')
})

test('the new tab box switches to open tabs, like the address bar', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/rhubarb'))
  await expect(activeTab(h)).toHaveText('Rhubarb pie')
  await shortcut(h, 'T')
  const newTab = await h.page('sc://newtab')
  const box = newTab.getByRole('combobox', { name: 'Search or enter an address' })
  await box.fill('rhubarb')
  const row = newTab.getByRole('option', { name: /Rhubarb pie.*Switch to tab/ })
  await expect(row).toBeVisible()
  await row.dispatchEvent('mousedown')
  await expect(activeTab(h)).toHaveText('Rhubarb pie')
  // The new tab it came from has done its job.
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
})

test('tracking tags come off addresses as pages open, unless turned off', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/article?utm_source=mail&id=3&fbclid=abc'))
  await expect(activeTab(h)).toHaveText('Article three')
  await expect(omnibox(h)).toHaveValue(site.url('/article?id=3'))

  await setSetting(h, { cleanLinks: false })
  await go(h, site.url('/article?utm_source=mail&id=3&fbclid=abc'))
  await expect(activeTab(h)).toHaveText('Tracked')
})

test('copy link to highlight and copy clean link are in the page menu', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/spices'))
  await expect(activeTab(h)).toHaveText('Spice notes')
  await h.app.evaluate(({ Menu }) => {
    const realm = globalThis as unknown as { lastMenu: unknown }
    Menu.buildFromTemplate = ((template: unknown) => {
      realm.lastMenu = template
      return { popup: () => undefined, append: () => undefined }
    }) as never
  })
  const menuFor = (params: Record<string, unknown>) =>
    h.app.evaluate(({ webContents }, extra) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith('/spices'))!
      const base = { x: 10, y: 10, linkURL: '', linkText: '', pageURL: page.getURL(), srcURL: '', mediaType: 'none', selectionText: '', isEditable: false, editFlags: {}, misspelledWord: '', dictionarySuggestions: [], formControlType: 'none' }
      page.emit('context-menu', { preventDefault: () => undefined }, { ...base, ...extra })
      const rows = (globalThis as unknown as { lastMenu: { label?: string; submenu?: unknown }[] }).lastMenu
      return rows.map((row) => row.label).filter(Boolean)
    }, params)
  const clickRow = (label: string) =>
    h.app.evaluate(({ clipboard }, wanted) => {
      const rows = (globalThis as unknown as { lastMenu: { label?: string; click?: () => void }[] }).lastMenu
      rows.find((row) => row.label === wanted)!.click!()
      return clipboard.readText()
    }, label)

  expect(await menuFor({ selectionText: 'secret ingredient' })).toContain('Copy link to highlight')
  expect(await clickRow('Copy link to highlight')).toBe(`${site.url('/spices')}#:~:text=secret%20ingredient`)

  expect(await menuFor({ linkURL: 'https://shop.example/item?id=1&utm_source=feed' })).toContain('Copy clean link')
  expect(await clickRow('Copy clean link')).toBe('https://shop.example/item?id=1')
  expect(await menuFor({ linkURL: 'https://shop.example/item?id=1' })).not.toContain('Copy clean link')
})

test('tab search finds words inside pages, and opens the tab at them', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/spices'))
  await expect(activeTab(h)).toHaveText('Spice notes')
  await shortcut(h, 'T')
  await go(h, site.url('/rhubarb'))
  await expect(activeTab(h)).toHaveText('Rhubarb pie')

  await shortcut(h, 'E', ['control', 'shift'])
  const overlay = await h.overlay()
  const search = overlay.getByRole('combobox', { name: 'Search tabs' })
  await search.fill('cardamom')
  const found = overlay.getByRole('option', { name: /Spice notes/ })
  await expect(found).toContainText('The secret ingredient is cardamom')
  await expect(found).toContainText('2')
  await expect(overlay.getByText('In pages')).toBeVisible()
  await search.press('Enter')
  await expect(activeTab(h)).toHaveText('Spice notes')
  const find = h.chrome.getByRole('textbox', { name: 'Find in page' })
  await expect(find).toHaveValue('cardamom')
  await expect(h.chrome.getByText('1 of 2')).toBeVisible()
})

test('Now playing pauses and plays sound from another tab', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/tone'))
  await expect(activeTab(h)).toHaveText('Tone player')
  const player = await h.page('/tone')
  await expect.poll(() => player.evaluate(() => !document.querySelector('audio')!.paused)).toBe(true)
  await shortcut(h, 'T')
  await go(h, site.url('/rhubarb'))

  const nowPlaying = h.chrome.getByRole('region', { name: 'Now playing' })
  await expect(nowPlaying).toContainText('Tone player')
  await expect(nowPlaying).toContainText('Playing')
  await nowPlaying.getByRole('button', { name: 'Pause Tone player' }).click()
  await expect.poll(() => player.evaluate(() => document.querySelector('audio')!.paused)).toBe(true)
  await expect(nowPlaying).toContainText('Paused')
  await nowPlaying.getByRole('button', { name: 'Play Tone player' }).click()
  await expect.poll(() => player.evaluate(() => !document.querySelector('audio')!.paused)).toBe(true)

  // A speed picked from its menu reaches the player.
  const id = await h.app.evaluate(() => (globalThis as unknown as { scbTabs: { snapshot: () => { tabs: { id: number; title: string }[] } } }).scbTabs.snapshot().tabs.find((tab) => tab.title === 'Tone player')!.id)
  await h.app.evaluate((_, tabId) => (globalThis as unknown as { scbTabs: { setMediaSpeed: (id: number, rate: number) => Promise<number> } }).scbTabs.setMediaSpeed(tabId, 1.5), id)
  await expect.poll(() => player.evaluate(() => document.querySelector('audio')!.playbackRate)).toBe(1.5)
  await expect(nowPlaying).toContainText('1.5×')

  // The title goes back to the tab, which is on screen and needs no control.
  await nowPlaying.getByRole('button', { name: 'Go to Tone player' }).click()
  await expect(activeTab(h)).toHaveText('Tone player')
  await expect(nowPlaying).toHaveCount(0)

  // Across the top it's a chip in the toolbar.
  await setSetting(h, { tabLayout: 'horizontal' })
  await h.chrome.getByRole('tab', { name: 'Rhubarb pie' }).click()
  await expect(h.chrome.getByRole('button', { name: 'Go to Tone player' })).toBeVisible()
  await setSetting(h, { mediaControls: false })
  await expect(h.chrome.getByRole('button', { name: 'Go to Tone player' })).toHaveCount(0)
})

test('a muted player never brings up Now playing', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/muted'))
  await expect(activeTab(h)).toHaveText('Muted loop')
  const player = await h.page('/muted')
  await expect.poll(() => player.evaluate(() => !document.querySelector('audio')!.paused)).toBe(true)
  await shortcut(h, 'T')
  await go(h, site.url('/rhubarb'))
  await expect(activeTab(h)).toHaveText('Rhubarb pie')
  await h.chrome.waitForTimeout(1500)
  await expect(h.chrome.getByRole('region', { name: 'Now playing' })).toHaveCount(0)
})

test('the focus timer has a chip of its own in the toolbar with tabs across the top', async () => {
  h = await launch()
  await setSetting(h, { tabLayout: 'horizontal', sidebarTimer: true })
  const start = h.chrome.getByRole('button', { name: /^Focus timer: .* today\. Start/ })
  await expect(start).toBeVisible()
  await expect(h.chrome.getByRole('button', { name: 'Focus timer menu' })).toBeVisible()
  await start.click()
  await expect(h.chrome.getByRole('button', { name: /^Focus timer: Focus, .*\. Stop$/ })).toBeVisible()
  await h.chrome.getByRole('button', { name: /\. Stop$/ }).click()
  await expect(start).toBeVisible()
})

test('a picture goes to the assistant, styles reach the model, and a chat saves as Markdown', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false, replyStyle: 'concise' })
  await addProvider()
  await go(h, site.url('/picture'))
  await expect(activeTab(h)).toHaveText('A picture')
  await h.app.evaluate(({ webContents }) => {
    const actions = (globalThis as unknown as { scbActions: { askAboutImage: (contents: unknown, src: string, x: number, y: number) => void } }).scbActions
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith('/picture'))!
    return page.executeJavaScript(`document.getElementById('shot').src`).then((src: string) => actions.askAboutImage(page, src, 20, 20))
  })
  await expect(panel().getByText('Picture to ask about')).toBeVisible()
  await expect(panel().getByRole('button', { name: 'Reply style: Concise' })).toBeVisible()
  mock!.queue.push('A red rectangle.')
  // An empty box still sends, with a question of its own.
  await panel().getByRole('button', { name: 'Send' }).click()
  await expect(panel().getByRole('log')).toContainText('A red rectangle.')
  await expect(panel().getByRole('img', { name: 'Picture you sent' })).toBeVisible()

  const sent = mock!.requests.at(-1)!.body as unknown as { messages: { role: string; content: unknown }[] }
  expect(JSON.stringify(sent.messages.find((message) => message.role === 'system')?.content)).toContain('Reply style: Keep replies short')
  const last = JSON.stringify(sent.messages.at(-1)!.content)
  expect(last).toContain('data:image/jpeg;base64,')
  expect(last).toContain('What does this picture show?')

  const folder = mkdtempSync(join(tmpdir(), 'scb-chat-'))
  const file = join(folder, 'chat.md')
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, file)
  await panel().getByRole('button', { name: 'Save chat as Markdown' }).click()
  await expect.poll(() => existsSync(file)).toBe(true)
  const saved = readFileSync(file, 'utf8')
  expect(saved).toMatch(/^# What does this picture show\?/)
  expect(saved).toContain('## scAI\n\nA red rectangle.')
})

test('the skill gallery adds a ready-made skill in one click', async () => {
  h = await launch()
  await go(h, 'sc://ai')
  const page = await h.page('sc://ai')
  const skills = page.getByRole('region', { name: 'Skills' })
  const gallery = skills.getByRole('list', { name: 'Skill gallery' })
  await skills.getByRole('button', { name: 'Gallery' }).click()
  // Skills already there by name, like the built-in Key points, aren't offered twice.
  await expect(gallery.getByRole('button', { name: /^Add Key points/ })).toHaveCount(0)
  await gallery.getByRole('button', { name: /^Add Find the catch/ }).click()
  await expect(skills.getByText('Find the catch', { exact: true })).toBeVisible()
  await expect(gallery.getByRole('button', { name: /^Add Find the catch/ })).toHaveCount(0)
  await skills.getByRole('button', { name: 'Gallery' }).click()
  await expect(gallery).toHaveCount(0)
})

test('reading progress shows on the card, and the page opens where it was left', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/long'))
  await expect(activeTab(h)).toHaveText('A long read')
  await h.app.evaluate(() => (globalThis as unknown as { scbActions: { addToReadingList: () => void } }).scbActions.addToReadingList())
  const long = await h.page('/long')
  await long.evaluate(() => scrollTo(0, (document.scrollingElement!.scrollHeight - innerHeight) / 2))
  await h.app.evaluate(() => {
    const core = (globalThis as unknown as { scbCore: { readingList: { noteProgress: (open: unknown[]) => Promise<void> } }; scbTabs: { allContents: () => unknown[] } })
    return (globalThis as unknown as { scbCore: typeof core.scbCore }).scbCore.readingList.noteProgress((globalThis as unknown as { scbTabs: { allContents: () => unknown[] } }).scbTabs.allContents())
  })
  await long.evaluate(() => scrollTo(0, 0))
  await shortcut(h, 'W')

  await go(h, 'sc://reading')
  const reading = await h.page('sc://reading')
  await expect(reading.getByText(/50% read/)).toBeVisible()
  await expect(reading.getByRole('progressbar', { name: 'Read so far' })).toHaveAttribute('aria-valuenow', '50')
  await reading.getByRole('button', { name: 'A long read' }).click()
  const reopened = await h.page('/long')
  await expect.poll(() => reopened.evaluate(() => scrollY), { timeout: 10_000 }).toBeGreaterThan(1000)
})

test('brief questions are kept with the brief when asked to', async () => {
  const pages: Record<string, string> = {
    '/search': '<!doctype html><div class="result"><a class="result__a" href="/l/?uddg=__SITE__%2Fstory">A story</a><a class="result__snippet">Something</a></div>',
    '/story': `<!doctype html><title>A story</title><main>${'<p>Something happened today, and people noticed it.</p>'.repeat(5)}</main>`
  }
  const search = await serveSite(pages)
  pages['/search'] = pages['/search']!.replace('__SITE__', encodeURIComponent(search.url('')))
  h = await launch(undefined, [], { SCB_SEARCH_URL: search.url('/search') })
  await setSetting(h, { httpsOnly: false })
  await addProvider()
  await go(h, 'sc://briefs')
  const page: Page = await h.page('sc://briefs')
  await page.getByRole('button', { name: 'New brief' }).click()
  const form = page.getByRole('form', { name: 'New brief' })
  await form.getByRole('button', { name: 'Latest AI news' }).click()
  await form.getByRole('button', { name: 'Add brief' }).click()
  mock!.queue.push('- Something happened [1].')
  await page.getByRole('region', { name: 'Scheduled briefs' }).getByRole('button', { name: 'Run now' }).click()
  const briefs = page.getByRole('region', { name: 'Your briefs' })
  await expect(briefs).toContainText('Something happened')

  await page.getByRole('switch', { name: 'Keep my questions' }).click()
  const ask = briefs.getByRole('textbox', { name: 'Ask about this brief' })
  if (!(await ask.isVisible())) await briefs.getByRole('button', { name: /Latest AI news/ }).first().click()
  mock!.queue.push('It happened at noon.')
  await ask.fill('When did it happen?')
  await ask.press('Enter')
  await expect(briefs).toContainText('It happened at noon.')
  await page.reload()
  const again = page.getByRole('region', { name: 'Your briefs' })
  if (!(await again.getByText('When did it happen?').isVisible())) await again.getByRole('button', { name: /Latest AI news/ }).first().click()
  await expect(again.getByText('When did it happen?')).toBeVisible()
  await expect(again).toContainText('It happened at noon.')
  search.server.close()
})
