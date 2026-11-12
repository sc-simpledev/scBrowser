import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, serveSite, setSetting, type Harness, type Site } from './app'

let h: Harness
let mock: AiMock
let site: Site
let page: Page
/** What the local site serves, which a test can add to. */
let pages: Record<string, string>

/** Screenshots for checking by eye, written only when asked for. */
const shot = async (target: Page, name: string) => {
  if (process.env.SCB_SHOTS) await target.screenshot({ path: join(process.env.SCB_SHOTS, `${name}.png`) })
}

const NOTES = {
  kind: 'Study notes',
  title: 'Limited Public Transport',
  summary: 'How access to public transport shapes daily life.',
  theme: 'notebook',
  blocks: [
    { type: 'callout', text: 'Without a frequent service nearby, getting to work, school and care takes longer and costs more.' },
    { type: 'heading', level: 2, text: 'Slide 1: Define the issue' },
    { type: 'cards', items: [{ title: 'Frequency', text: 'How often services run.' }, { title: 'Coverage', text: 'How far people live from a stop.' }] },
    { type: 'heading', level: 2, text: 'Test yourself' },
    {
      type: 'quiz',
      items: [
        { question: 'What is a headway?', answer: 'The time between services on a route.' },
        { question: 'Name one effect of poor coverage.', answer: 'More car dependence.' }
      ]
    }
  ]
}

test.beforeEach(async () => {
  mock = await startAiMock()
  pages = { '/one': '<!doctype html><title>Bus times</title><p>Buses</p>', '/two': '<!doctype html><title>Train map</title><p>Trains</p>' }
  site = await serveSite(pages)
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, 'sc://ai')
  page = await h.page('sc://ai')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await page.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await page.getByRole('button', { name: 'Add provider' }).click()
  await expect(page.getByText('Connected, 1 model available')).toBeVisible()
  await page.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  mock.server.closeAllConnections()
  mock.server.close()
  site.server.close()
})

const openAssistant = async (address = 'sc://assistant') => {
  await go(h, address)
  page = await h.page('sc://assistant')
  await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toBeVisible()
}

const ask = async (text: string) => {
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('study notes quiz, editing in place, a remembered design and slides', async () => {
  await openAssistant()
  mock.queue = [`Here are your notes.\n\n\`\`\`scterra-report\n${JSON.stringify(NOTES)}\n\`\`\``]
  await ask('Study notes on limited public transport')
  const pane = page.getByRole('region', { name: 'Report' })
  await expect(pane.locator('h1')).toHaveText('Limited Public Transport')
  await expect(pane.locator('.quiz .answer')).toHaveCount(0)
  await pane.getByRole('button', { name: /What is a headway/ }).click()
  await expect(pane.locator('.quiz .answer').first()).toHaveText('The time between services on a route.')
  await shot(page, 'report')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(400)
  await shot(page, 'report-dark')
  await page.emulateMedia({ colorScheme: 'light' })

  // One question at a time, with a missed one coming back.
  await pane.getByRole('button', { name: 'Quiz me' }).click()
  const quiz = page.getByRole('dialog', { name: 'Quiz' })
  await expect(quiz.getByText('What is a headway?')).toBeVisible()
  await quiz.getByRole('button', { name: 'Show answer' }).click()
  await shot(page, 'quiz')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(400)
  await shot(page, 'quiz-dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await quiz.getByRole('button', { name: 'Again' }).click()
  await expect(quiz.getByText('Name one effect of poor coverage.')).toBeVisible()
  await quiz.getByRole('button', { name: 'Show answer' }).click()
  await quiz.getByRole('button', { name: 'Got it' }).click()
  await quiz.getByRole('button', { name: 'Show answer' }).click()
  await quiz.getByRole('button', { name: 'Got it' }).click()
  await expect(quiz.getByText('All 2 done')).toBeVisible()
  await quiz.getByRole('button', { name: 'Back to the report' }).click()

  // Edits are made in the reply itself, so they last.
  await pane.getByRole('button', { name: 'Edit text' }).click()
  const title = pane.locator('h1')
  await title.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' in Hobart')
  await shot(page, 'editing')
  await page.keyboard.press('Enter')
  await pane.getByRole('button', { name: 'Done editing' }).click()
  await expect(title).toHaveText('Limited Public Transport in Hobart')
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText('Limited Public Transport in Hobart')).toBeVisible()

  await pane.getByRole('combobox', { name: 'Design' }).selectOption('magazine')
  // Coming back to the chat brings back its edits and its design.
  await openAssistant()
  await page.getByRole('navigation', { name: 'Saved chats' }).getByRole('link').first().click()
  const reopened = page.getByRole('region', { name: 'Report' })
  await expect(reopened.locator('h1')).toHaveText('Limited Public Transport in Hobart')
  await expect(reopened.getByRole('combobox', { name: 'Design' })).toHaveValue('magazine')

  // Slides come out as a real zip that LibreOffice and PowerPoint can open.
  const folder = mkdtempSync(join(tmpdir(), 'scb-slides-'))
  const file = join(folder, 'notes.pptx')
  await h.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, file)
  await reopened.getByRole('button', { name: 'Download' }).click()
  await shot(page, 'download')
  await reopened.getByRole('menuitem', { name: 'Slides (PowerPoint)' }).click()
  await expect(reopened.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  const saved = readFileSync(file)
  expect(saved.subarray(0, 2).toString()).toBe('PK')
  expect(saved.includes(Buffer.from('ppt/slides/slide1.xml'))).toBe(true)
  rmSync(folder, { recursive: true, force: true })
})

test('pasted text is tidied, and the tab menu opens the assistant with tabs and a preset picked', async () => {
  await go(h, site.url('/one'))
  const one = await h.app.evaluate(() => (globalThis as unknown as { scbTabs: { snapshot(): { activeId: number } } }).scbTabs.snapshot().activeId)
  // A new tab, as the menu opens it, so the picked page stays open.
  await h.app.evaluate((_, address) => (globalThis as unknown as { scbTabs: { create(url: string): number } }).scbTabs.create(address), `sc://assistant/?preset=brief&tabs=${one}`)
  page = await h.page('sc://assistant')
  await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toBeVisible()
  await expect(page.getByText('Research brief', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Bus times/ })).toBeVisible()

  const box = page.getByRole('textbox', { name: 'Message the assistant' })
  await box.focus()
  await box.evaluate((element) => {
    const data = new DataTransfer()
    data.setData('text/plain', 'How does access affect people&#39;s daily lives?​')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(box).toHaveValue("How does access affect people's daily lives?")
  await shot(page, 'research')
})

test('settings show what is new and the wait-until-close choice', async () => {
  await go(h, 'sc://settings/#about')
  const settings = await h.page('sc://settings')
  await expect(settings.getByRole('heading', { name: 'What’s new' })).toBeVisible()
  await expect(settings.getByText('Version 0.6.1')).toBeVisible()
  await shot(settings, 'whats-new')
  if (!process.env.SCB_SHOTS) return
  // A tour of the main screens in both themes, for checking by eye.
  for (const scheme of ['light', 'dark'] as const) {
    for (const address of ['sc://newtab', 'sc://assistant', 'sc://vpn', 'sc://passwords', 'sc://history', 'sc://settings/#appearance']) {
      await go(h, address)
      const shown = await h.page(address.replace(/\/#.*$/, '').replace(/\/$/, ''))
      await shown.emulateMedia({ colorScheme: scheme })
      await shown.waitForTimeout(400)
      await shot(shown, `tour-${scheme}-${address.replace(/[^a-z]+/g, '-')}`)
    }
  }
  await h.chrome.emulateMedia({ colorScheme: 'dark' })
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await h.chrome.waitForTimeout(500)
  await shot(h.chrome, 'tour-dark-chrome-sidebar')
})

test('the reading list summarises everything unread in one go', async () => {
  for (const path of ['/one', '/two']) {
    await go(h, site.url(path))
    await expect.poll(() => h.app.evaluate(() => (globalThis as unknown as { scbTabs: { active: { title: string } | null } }).scbTabs.active?.title)).toBe(path === '/one' ? 'Bus times' : 'Train map')
    await h.app.evaluate(() => (globalThis as unknown as { scbActions: { addToReadingList(): void } }).scbActions.addToReadingList())
  }
  await h.app.evaluate(() => (globalThis as unknown as { scbTabs: { create(url: string): number } }).scbTabs.create('sc://reading'))
  const reading = await h.page('sc://reading')
  // Visiting a saved page counts as reading it, so both are put back to unread first.
  await reading.getByRole('button', { name: 'All 2' }).click()
  for (const button of await reading.getByRole('button', { name: 'Mark as unread' }).all()) await button.click()
  await reading.getByRole('button', { name: /^Unread 2/ }).click()
  mock.queue = ['- About buses.', '- About trains.']
  await reading.getByRole('button', { name: 'Summarise unread (2)' }).click()
  await expect(reading.getByRole('status').filter({ hasText: 'Summarised 2 of 2.' })).toBeVisible()
  await expect(reading.getByRole('button', { name: 'Summary' })).toHaveCount(2)
  await shot(reading, 'reading')
})

test('ask about a report, save it as a template, a remembered quiz, and the extra downloads', async () => {
  await openAssistant()
  mock.queue = [`Here are your notes.\n\n\`\`\`scterra-report\n${JSON.stringify(NOTES)}\n\`\`\``]
  await ask('Study notes on limited public transport')
  const pane = page.getByRole('region', { name: 'Report' })
  await expect(pane.locator('h1')).toHaveText('Limited Public Transport')

  // A question is answered beside the report, and no new draft is made.
  await pane.getByRole('tab', { name: 'Ask' }).click()
  mock.queue = ['A headway is **the gap** between buses.']
  await pane.getByRole('textbox', { name: 'Question about the report' }).fill('What is a headway?')
  await pane.getByRole('button', { name: 'Ask this question' }).click()
  await expect(pane.getByRole('region', { name: 'Answer' })).toContainText('A headway is the gap between buses.')
  expect(JSON.stringify(mock.requests.at(-1)!.body)).toContain('Slide 1: Define the issue')
  await expect(page.getByRole('navigation', { name: 'Versions' })).toHaveCount(0)
  await shot(page, 'ask')

  // A missed question is due again, and the button says so.
  await pane.getByRole('button', { name: 'Quiz me' }).click()
  const quiz = page.getByRole('dialog', { name: 'Quiz' })
  await quiz.getByRole('button', { name: 'Show answer' }).click()
  await quiz.getByRole('button', { name: 'Again' }).click()
  await quiz.getByRole('button', { name: 'Show answer' }).click()
  await quiz.getByRole('button', { name: 'Got it' }).click()
  await quiz.getByRole('button', { name: 'Show answer' }).click()
  await quiz.getByRole('button', { name: 'Got it' }).click()
  await expect(quiz.getByText(/Coming back: 1 today, 1 tomorrow|Coming back: 1 tomorrow, 1 today/)).toBeVisible()
  await shot(page, 'quiz-done')
  await quiz.getByRole('button', { name: 'Back to the report' }).click()
  await expect(pane.getByRole('button', { name: /Quiz me 1 due/ })).toBeVisible()

  // Its layout becomes a template under Make a report.
  await pane.getByRole('button', { name: 'More report actions' }).click()
  await pane.getByRole('menuitem', { name: 'Save as a template' }).click()
  await pane.getByRole('textbox', { name: 'Template name' }).fill('Transport notes')
  await shot(page, 'template')
  await pane.getByRole('button', { name: 'Save template' }).click()
  await expect(pane.getByText('Saved “Transport notes” to Make a report')).toBeVisible()
  await page.getByRole('button', { name: 'Report', exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Report presets' })
  await expect(gallery.getByRole('region', { name: 'Your templates' }).getByText('Transport notes')).toBeVisible()
  await shot(page, 'gallery')
  await gallery.getByRole('button', { name: /^Transport notes/ }).click()
  mock.queue = ['Sure.']
  await ask('Rivers')
  await expect.poll(() => JSON.stringify(mock.requests.at(-1)?.body ?? '')).toContain('Then these sections, in order: \\"Slide 1: Define the issue\\" with cards')

  // Speaker notes come from the AI; the worksheet is a PDF.
  const folder = mkdtempSync(join(tmpdir(), 'scb-extras-'))
  const file = join(folder, 'deck.pptx')
  await h.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, file)
  await pane.getByRole('button', { name: 'Download' }).click()
  mock.queue = ['["Welcome everyone.", "The big idea.", "Two things matter.", "Now a quiz."]']
  await pane.getByRole('menuitem', { name: 'Slides with speaker notes' }).click()
  await expect(pane.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  expect(readFileSync(file).includes(Buffer.from('ppt/notesSlides/notesSlide1.xml'))).toBe(true)
  const sheet = join(folder, 'sheet.pdf')
  await h.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, sheet)
  await pane.getByRole('button', { name: 'Download' }).click()
  await pane.getByRole('menuitem', { name: 'Quiz worksheet (PDF)' }).click()
  await expect.poll(() => readFileSync(sheet, { flag: 'a+' }).subarray(0, 4).toString()).toBe('%PDF')
  rmSync(folder, { recursive: true, force: true })
})

test('settings offer the version before this one, and a study session shows its round', async () => {
  await h.close()
  pages['/releases'] = JSON.stringify([{ tag_name: 'v0.6.1' }, { tag_name: 'v0.5.5' }, { tag_name: 'v0.4.9' }])
  h = await launch(undefined, [], { SCB_UPDATE_URL: site.url('/feed'), SCB_RELEASES_API_URL: site.url('/releases'), SCB_UPDATE_DELAY: '600000' })
  await go(h, 'sc://settings/#about')
  const settings = await h.page('sc://settings')
  await expect(settings.getByText('Go back to version 0.5.5')).toBeVisible()
  await settings.getByRole('button', { name: 'Go back' }).click()
  await expect(settings.getByRole('button', { name: 'Download 0.5.5' })).toBeVisible()
  await shot(settings, 'go-back')

  await setSetting(h, { focusMode: true, focusUntil: Date.now() + 25 * 60_000, studyRound: 2, studyRounds: 4 })
  await expect(h.chrome.getByRole('button', { name: /Study session, round 2 of 4/ })).toBeVisible()
  await setSetting(h, { focusMode: false, focusUntil: 0, focusBreakUntil: Date.now() + 5 * 60_000, studyRound: 2 })
  await expect(h.chrome.getByRole('button', { name: /Study break, 5 min left before round 3 of 4/ })).toBeVisible()
  await shot(h.chrome, 'study-break')
})
