import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, setSetting, titled, type Harness, type Site } from './app'

/**
 * Checks against a real model, for format drift that mocks can't show: one brief, one report, one
 * /tweak and one question about a picture. They spend real credit, so they only run when asked for
 * and never on CI:
 *
 *   SCB_REAL_AI=hosted e2e/hidden.sh e2e/realAi.spec.ts
 *     scTerra AI, the hosted model (SCB_REAL_AI_URL to point at another copy of the server).
 *   SCB_REAL_AI=key SCB_REAL_AI_FORMAT=anthropic SCB_REAL_AI_KEY=… SCB_REAL_AI_MODEL=… e2e/hidden.sh e2e/realAi.spec.ts
 *     Your own key. SCB_REAL_AI_FORMAT is anthropic or openai; SCB_REAL_AI_BASE sets the address
 *     (Anthropic's or OpenAI's own by default).
 *
 * The brief searches the real web through DuckDuckGo.
 */
const mode = process.env.SCB_REAL_AI
const HOSTED_URL = process.env.SCB_REAL_AI_URL ?? 'https://scterra-ai.scspace-dev.workers.dev/v1'
const REPLY_MS = 120_000

test.describe.configure({ mode: 'serial', timeout: 300_000 })
test.skip(!mode || !!process.env.CI, 'Spends real AI credit: run by hand with SCB_REAL_AI set')

let h: Harness
let site: Site

test.beforeAll(async () => {
  site = await serveSite({
    '/article': titled('Tea and coffee', `<article>${'<p>Tea has less caffeine than coffee per cup, and green tea has the least. Coffee is drunk more in the morning.</p>'.repeat(8)}</article>`),
    // A plain red square with a word on it, drawn by the page, so there's something to describe.
    '/picture': titled('A picture', `<canvas id="c" width="320" height="200"></canvas><img id="shot" alt="" width="320" height="200"><script>
      const c = document.getElementById('c'); const g = c.getContext('2d'); g.fillStyle = '#d22'; g.fillRect(0, 0, 320, 200);
      g.fillStyle = '#fff'; g.font = 'bold 48px sans-serif'; g.fillText('HELLO', 90, 120); document.getElementById('shot').src = c.toDataURL('image/png'); c.remove()
    </script>`)
  })
  h = await launch(undefined, [], mode === 'hosted' ? { SCTERRA_AI_URL: HOSTED_URL } : {})
  await setSetting(h, { httpsOnly: false })
  if (mode === 'hosted') {
    await h.chrome.getByRole('button', { name: 'Assistant' }).click()
    await h.chrome.getByRole('complementary', { name: 'Assistant' }).getByRole('button', { name: 'Use scTerra AI' }).click()
    await h.chrome.getByRole('button', { name: 'Close assistant' }).click()
    return
  }
  const format = process.env.SCB_REAL_AI_FORMAT === 'openai' ? 'openai' : 'anthropic'
  await go(h, 'sc://ai')
  const page = await h.page('sc://ai')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Real AI')
  await page.getByRole('textbox', { name: 'Base URL' }).fill(process.env.SCB_REAL_AI_BASE ?? (format === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'))
  await page.getByRole('combobox', { name: 'API format' }).selectOption(format)
  await page.getByRole('textbox', { name: 'API key' }).fill(process.env.SCB_REAL_AI_KEY ?? '')
  await page.getByRole('button', { name: 'Add provider' }).click()
  const picker = page.getByRole('combobox', { name: 'Chat model for Real AI' })
  await expect(picker).toBeEnabled({ timeout: 30_000 })
  if (process.env.SCB_REAL_AI_MODEL) await picker.selectOption(process.env.SCB_REAL_AI_MODEL)
})

test.afterAll(async () => {
  await h?.close().catch(() => undefined)
  site?.server.close()
})

const panel = () => h.chrome.getByRole('complementary', { name: 'Assistant' })
const composer = () => panel().getByRole('textbox', { name: 'Message the assistant' })
const log = () => panel().getByRole('log', { name: 'Conversation' })

async function openAssistant() {
  if (!(await composer().isVisible())) await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await panel().getByRole('button', { name: 'New chat' }).click().catch(() => undefined)
}

/** Waits for the reply to finish, then gives its text. Raw JSON in it means the format drifted. */
async function reply(): Promise<string> {
  await expect(panel().getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: REPLY_MS })
  const text = await log().innerText()
  expect(text).not.toMatch(/"blocks"\s*:|```json|scterra-report/)
  return text
}

test('a brief is written from a real web search', async () => {
  await go(h, 'sc://briefs')
  const page = await h.page('sc://briefs')
  await page.getByRole('button', { name: 'New brief' }).click()
  const form = page.getByRole('form', { name: 'New brief' })
  await form.getByRole('button', { name: 'Latest AI news' }).click()
  await form.getByRole('radio', { name: 'Short' }).click()
  await form.getByRole('button', { name: 'Add brief' }).click()
  await page.getByRole('region', { name: 'Scheduled briefs' }).getByRole('button', { name: 'Run now' }).click()
  const briefs = page.getByRole('region', { name: 'Your briefs' })
  await expect(briefs).toContainText('Your briefs · 1 new', { timeout: REPLY_MS })
  const text = await briefs.innerText()
  expect(text.length).toBeGreaterThan(200)
  expect(text).not.toMatch(/"blocks"\s*:|```/)
})

test('a report comes back as a report, not as text', async () => {
  await go(h, site.url('/article'))
  await expect(activeTab(h)).toHaveText('Tea and coffee')
  await openAssistant()
  await composer().fill('Write a short report comparing tea and coffee from this page, with a table.')
  await composer().press('Enter')
  await reply()
  await expect(log().getByRole('button', { name: 'Open report' })).toBeVisible()
})

test('/tweak changes how the page looks', async () => {
  await go(h, site.url('/article'))
  await openAssistant()
  await composer().fill('/tweak make the page background black and the text white')
  await composer().press('Enter')
  await expect(panel().getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: REPLY_MS })
  const page = await h.page('/article')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor), { timeout: 15_000 }).toMatch(/rgba?\(0, 0, 0/)
})

test('a picture on the page can be asked about', async () => {
  await go(h, site.url('/picture'))
  await expect(activeTab(h)).toHaveText('A picture')
  // The page menu is native, so the action it runs is called directly.
  await h.app.evaluate(({ webContents }) => {
    const actions = (globalThis as unknown as { scbActions: { askAboutImage: (contents: unknown, src: string, x: number, y: number) => void } }).scbActions
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith('/picture'))!
    return page.executeJavaScript(`document.getElementById('shot').src`).then((src: string) => actions.askAboutImage(page, src, 40, 40))
  })
  await expect(panel().getByText('Picture to ask about')).toBeVisible()
  await composer().fill('What colour is this picture, and what word is on it? Answer in five words or fewer.')
  await composer().press('Enter')
  expect((await reply()).toLowerCase()).toMatch(/red[\s\S]*hello|hello[\s\S]*red/)
})
