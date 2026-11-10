import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, type Harness } from './app'

let h: Harness
let mock: AiMock
let page: Page

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
    { type: 'heading', level: 2, text: 'Slide 1: Define the issue' },
    { type: 'callout', text: 'Too few services to rely on.' },
    { type: 'heading', level: 2, text: 'Slide 2: What it looks like' },
    { type: 'stats', items: [{ value: '1 in 5', label: 'homes far from a stop' }, { value: '40 min', label: 'typical wait' }] },
    { type: 'heading', level: 2, text: 'Key terms' },
    { type: 'table', headers: ['Term', 'Definition'], rows: [['Headway', 'Time between services.']] },
    { type: 'heading', level: 2, text: 'Test yourself' },
    { type: 'quiz', items: [{ question: 'What is a headway?', answer: 'The time between services.' }, { question: 'Who is hit, and "how"?', answer: 'Students' }] }
  ]
}
const fenced = (report: object) => `Here are your notes.\n\n\`\`\`scterra-report\n${JSON.stringify(report)}\n\`\`\``
const asked = () => mock.requests.filter((request) => request.url.includes('/chat/completions'))

test.beforeEach(async () => {
  mock = await startAiMock()
  h = await launch()
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
  await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toBeVisible()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  mock.server.closeAllConnections()
  mock.server.close()
})

const ask = async (text: string) => {
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}
const newChat = async () => {
  await page.goto('sc://assistant/')
  await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toBeVisible()
}
const pane = () => page.getByRole('region', { name: 'Report' })
const log = () => page.getByRole('log', { name: 'Conversation' })

test('a report written as a tool call opens like any other, and a model without tools still writes one', async () => {
  const json = JSON.stringify(NOTES)
  mock.toolQueue = [[json.slice(0, 80), json.slice(80, 300), json.slice(300)]]
  await ask('Study notes on limited public transport')
  await expect(pane().locator('h1')).toHaveText('Limited Public Transport')
  await expect(pane().locator('.quiz > li')).toHaveCount(2)
  await expect(log().getByText('Here is your report.')).toBeVisible()
  await expect(log().getByRole('button', { name: 'Open report' })).toBeVisible()
  expect(asked().at(-1)?.body.tools?.[0]?.function?.name).toBe('write_report')

  // Turned down for offering tools: asked again without them, and from then on.
  mock.rejectTools = true
  await newChat()
  const before = asked().length
  mock.queue = [fenced({ ...NOTES, title: 'Without tools' })]
  await ask('And again')
  await expect(pane().locator('h1')).toHaveText('Without tools')
  expect(asked().length - before).toBeLessThanOrEqual(2)
  expect(asked().at(-1)?.body.tools).toBeUndefined()
})

test('a report fills in as it is written, and a cut-off reply carries on as one', async () => {
  const json = JSON.stringify(NOTES)
  const cut = json.indexOf('"Key terms"')
  mock.rejectTools = true
  // Held half-written: the side page already shows what there is.
  mock.hang = true
  mock.queue = ['Here are your notes.\n\n```scterra-report\n' + json.slice(0, cut)]
  await ask('Study notes')
  await expect(pane().locator('h1')).toHaveText('Limited Public Transport')
  await expect(pane().getByRole('heading', { name: 'Slide 2: What it looks like' })).toBeVisible()
  await expect(pane().getByRole('heading', { name: 'Test yourself' })).toHaveCount(0)
  await expect(log().getByText('Writing “Limited Public Transport”')).toBeVisible()
  await shot(page, 'live-draft')
  await page.getByRole('button', { name: 'Stop' }).click()
  mock.hang = false

  // Cut off by the length limit: Continue asks for the rest and the halves become one reply.
  await newChat()
  mock.queue = ['Here are your notes.\n\n```scterra-report\n' + json.slice(0, cut), json.slice(cut) + '\n```']
  mock.finish = ['length']
  await ask('Study notes')
  await expect(log().getByText('The reply hit its length limit.')).toBeVisible()
  await expect(pane().locator('.quiz > li')).toHaveCount(0)
  await log().getByRole('button', { name: 'Continue' }).click()
  await expect(pane().locator('.quiz > li')).toHaveCount(2)
  await expect(log().getByRole('button', { name: 'Open report' })).toHaveCount(1)
  await expect(log().getByText('Continue')).toHaveCount(0)
  await expect(log().getByText('The reply hit its length limit.')).toHaveCount(0)
})

test('an unreadable report is asked for once more by itself, and any reply can be tried again', async () => {
  mock.rejectTools = true
  mock.queue = ['Here.\n\n```scterra-report\nI could not write it.\n```', fenced(NOTES)]
  await ask('Study notes')
  await expect(pane().locator('h1')).toHaveText('Limited Public Transport')
  await expect(log().getByText('This report couldn’t be read')).toHaveCount(0)
  await expect(log().getByText('Write that report again')).toHaveCount(0)
  await expect(log().getByRole('button', { name: 'Open report' })).toHaveCount(1)

  // Try again replaces the newest reply rather than adding to the conversation.
  mock.queue = ['A second go.']
  await log().getByRole('button', { name: 'Try again' }).click()
  await expect(log().getByText('A second go.')).toBeVisible()
  await expect(log().getByRole('button', { name: 'Open report' })).toHaveCount(0)
  const sent = asked().at(-1)?.body.messages?.filter((message) => message.role !== 'system') ?? []
  expect(sent).toHaveLength(1)

  // Unreadable twice: the card stays, with a way to ask again.
  mock.queue = ['```scterra-report\nnope\n```', '```scterra-report\nstill nope\n```', fenced(NOTES)]
  await ask('Once more')
  await expect(log().getByText('This report couldn’t be read')).toBeVisible()
  await log().getByRole('button', { name: 'Ask again' }).click()
  await expect(pane().locator('h1')).toHaveText('Limited Public Transport')
})

test('present as slides, jump by section, see what changed, and save quiz cards', async () => {
  mock.rejectTools = true
  mock.queue = [fenced(NOTES)]
  await ask('Study notes')
  await expect(pane().locator('h1')).toHaveText('Limited Public Transport')

  // Sections.
  await pane().getByRole('button', { name: 'Sections' }).click()
  await pane().getByRole('menuitem', { name: 'Test yourself' }).click()
  await expect(pane().getByRole('heading', { name: 'Test yourself' })).toBeInViewport()

  // Slides, with notes from the AI on request.
  await pane().getByRole('button', { name: 'More report actions' }).click()
  await pane().getByRole('menuitem', { name: 'Present as slides' }).click()
  const slides = page.getByRole('dialog', { name: 'Slides' })
  await expect(slides.getByRole('status')).toHaveText('Slide 1 of 5')
  await expect(slides.getByRole('heading', { name: 'Limited Public Transport' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(slides.getByRole('status')).toHaveText('Slide 3 of 5')
  await expect(slides.getByText('1 in 5')).toBeVisible()
  mock.queue = ['["Welcome.", "Define it.", "Two figures to remember.", "One term.", "Now a quiz."]']
  await slides.getByRole('button', { name: 'Speaker notes' }).click()
  await expect(slides.getByRole('region', { name: 'Speaker notes' })).toHaveText('Two figures to remember.')
  await shot(page, 'present')
  await page.keyboard.press('Escape')
  await expect(slides).toHaveCount(0)

  // Quiz cards as CSV.
  const folder = mkdtempSync(join(tmpdir(), 'scb-cards-'))
  const file = join(folder, 'cards.csv')
  await h.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, file)
  await pane().getByRole('button', { name: 'Download' }).click()
  await expect(pane().getByRole('menuitem')).toHaveCount(8)
  await pane().getByRole('menuitem', { name: 'Quiz cards for Anki (CSV)' }).click()
  await expect.poll(() => readFileSync(file, { flag: 'a+' }).toString()).toBe('What is a headway?,The time between services.\r\n"Who is hit, and ""how""?",Students\r\n')
  rmSync(folder, { recursive: true, force: true })

  // A second draft under another title still counts as a version, and its changes are marked.
  const next = { ...NOTES, title: 'Limited Public Transport, shorter', blocks: [...NOTES.blocks.slice(0, 2), { type: 'paragraph', text: 'A new line.' }, ...NOTES.blocks.slice(4)] }
  mock.queue = [fenced(next)]
  await pane().getByRole('textbox', { name: 'Change to make' }).fill('make it shorter')
  await pane().getByRole('button', { name: 'Ask for this change' }).click()
  await expect(pane().locator('h1')).toHaveText('Limited Public Transport, shorter')
  await expect(pane().getByRole('navigation', { name: 'Versions' }).getByRole('status')).toHaveText('Version 2 of 2')
  await pane().getByRole('button', { name: 'What changed' }).click()
  await expect(pane().getByRole('button', { name: '1 added, 2 removed' })).toBeVisible()
  await expect(pane().locator('[data-change="added"]')).toHaveText('A new line.')
  await expect(pane().locator('[data-change="removed"]')).toHaveCount(2)
  await shot(page, 'compare')
})

test('the report gallery opens over the conversation, and a preset is not named twice', async () => {
  mock.rejectTools = true
  mock.queue = ['Short answer.']
  await ask('Hello')
  await expect(log().getByText('Short answer.')).toBeVisible()
  const height = (await log().boundingBox())!.height
  await page.getByRole('button', { name: 'Report', exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Report presets' })
  await expect(gallery).toBeVisible()
  expect((await log().boundingBox())!.height).toBe(height)
  await shot(page, 'gallery-over')
  await gallery.getByRole('button', { name: /^Study notes/ }).click()
  mock.queue = ['Sure.']
  await ask('Study notes: Slide 1')
  await expect(log().getByText('Study notes: Slide 1', { exact: true })).toBeVisible()
})
