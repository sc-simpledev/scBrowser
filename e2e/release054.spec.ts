import { expect, test, type Page } from '@playwright/test'
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

/**
 * The shape of what a hosted model wrote three times running on 0.5.3: one long line in a
 * four-mark fence, with the table's rows closed by `]}]}` where `]]}` was meant.
 */
const MISCOUNTED =
  '{"title":"Study notes: Limited public transport","summary":"What limited public transport is and how it shapes daily life.","theme":"notebook","kind":"Study notes","blocks":[' +
  '{"type":"heading","level":2,"text":"Slide 1: Define the issue"},' +
  '{"type":"callout","text":"Limited public transport means too few buses, trains or routes to serve a community."},' +
  '{"type":"cards","items":[{"title":"Frequency","text":"How often services run."},{"title":"Coverage","text":"How far people live from a stop."}]},' +
  '{"type":"heading","level":2,"text":"Key terms"},' +
  '{"type":"table","headers":["Term","Definition"],"rows":[["Headway","The time between services on a route."],["Social exclusion","Being cut off from jobs or services because of poor transport."]}]},' +
  '{"type":"heading","level":2,"text":"Practice questions"},' +
  '{"type":"quiz","items":[{"question":"What is a headway?","answer":"The time between services."},{"question":"Who is hardest hit?","answer":"Older adults and students."}]}]}'

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

test('a report with miscounted brackets still opens as a report, whole', async () => {
  mock.queue = [`Here are study notes on limited public transport.\n\n\`\`\`\`scterra-report\n${MISCOUNTED}\n\`\`\`\``]
  await ask('Study notes on limited public transport')
  const pane = page.getByRole('region', { name: 'Report' })
  await expect(pane.locator('h1')).toHaveText('Study notes: Limited public transport')
  // Everything after the table used to be lost with it.
  await expect(pane.locator('table td').first()).toHaveText('Headway')
  await expect(pane.locator('table tr')).toHaveCount(3)
  await expect(pane.getByRole('heading', { name: 'Practice questions' })).toBeVisible()
  await expect(pane.locator('.quiz > li')).toHaveCount(2)
  const log = page.getByRole('log', { name: 'Conversation' })
  await expect(log.getByRole('button', { name: 'Open report' })).toBeVisible()
  await expect(log).not.toContainText('"blocks"')
  await expect(log.locator('pre')).toHaveCount(0)
  await shot(page, 'mended-report')
})

test('a report nothing can be made of says so, and a stopped reply stops waiting', async () => {
  mock.queue = ['Here it is.\n\n```scterra-report\nI could not write this one.\n```']
  await ask('Study notes')
  const log = page.getByRole('log', { name: 'Conversation' })
  await expect(log.getByText('This report couldn’t be read')).toBeVisible()
  await expect(log.getByText('I could not write this one.')).toBeHidden()
  await log.getByText('This report couldn’t be read').click()
  await expect(log.getByText('I could not write this one.')).toBeVisible()
  await shot(page, 'unread-report')

  // Stopped before a word arrived: the reply says so rather than thinking for ever.
  mock.hang = true
  mock.reply = ['']
  await ask('And another')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(log.getByText('Stopped.')).toBeVisible()
  await expect(log.getByRole('status')).toHaveCount(0)
})
