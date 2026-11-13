import { expect, test } from '@playwright/test'
import { go, launch, setSetting, type Harness } from './app'

let h: Harness

test.afterEach(async () => {
  await h.close().catch(() => undefined)
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>

test('the focus timer times an activity, counts down in rounds, and shows on the toolbar and new tab', async () => {
  h = await launch()
  await go(h, 'sc://focus')
  const page = await h.page('sc://focus')
  const activities = page.getByRole('region', { name: 'Activities' })
  await page.getByRole('button', { name: 'Add activity' }).click()
  await page.getByRole('textbox', { name: 'Activity name' }).fill('Writing')
  await page.getByRole('form', { name: 'New activity' }).getByRole('button', { name: 'Add activity' }).click()
  await expect(activities).toContainText('Writing')

  await activities.getByRole('button', { name: 'Start Writing' }).click()
  const chip = h.chrome.getByRole('button', { name: /^Focus timer: Writing/ })
  await expect(chip).toBeVisible()
  await activities.getByRole('button', { name: 'Stop Writing' }).click()
  await expect(chip).toBeHidden()

  // A countdown runs in rounds, and the toolbar shows which one.
  await page.getByRole('radio', { name: 'Countdown' }).click()
  await page.getByRole('combobox', { name: 'Rounds' }).selectOption('2')
  await page.getByRole('region', { name: 'Today' }).getByRole('button', { name: 'Start' }).click()
  await expect(h.chrome.getByRole('button', { name: /round 1 of 2, 2\d:\d\d left/ })).toBeVisible()
  await expect(page.getByRole('timer', { name: 'Left in this round' })).toContainText(/2[45]:\d\d/)
  await page.getByRole('region', { name: 'Today' }).getByRole('button', { name: 'Stop' }).click()

  // Blocked sites tried while it runs are counted.
  await main((g) => {
    g.scbCore.study.start(g.scbCore.study.lastSubject().id)
    g.scbCore.study.noteDistraction('https://www.youtube.com/watch')
  })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Distractions today' })).toContainText('1 time')
  await expect(page.getByRole('region', { name: 'Distractions today' })).toContainText('youtube.com')

  // The new tab widget starts and stops it too.
  await setSetting(h, { newTab: { ...(await main((g) => g.scbCore.services.settings.get().newTab)), widgets: [{ id: 'focus', size: 'full' }] } })
  await go(h, 'sc://newtab')
  const newtab = await h.page('sc://newtab')
  const card = newtab.getByRole('region', { name: 'Focus timer' })
  await expect(card.getByRole('button', { name: /^Stop / })).toBeVisible()
  await card.getByRole('button', { name: /^Stop / }).click()
  await expect(card.getByRole('button', { name: 'Start Writing' })).toBeVisible()
  await expect(chip).toBeHidden()
})

test('briefs show today as one edition, follow a story, choose a source, and save to notes', async () => {
  h = await launch()
  await main((g) => {
    const now = Date.now()
    const kv = g.scbCore.briefs.deps.kv
    const sources = [{ n: 1, url: 'https://news.example/a', title: 'A story', tabId: null }]
    kv.set('briefs:issues', [
      { id: 'i1', scheduleId: 's1', title: 'Latest AI news', topic: 't', length: 'short', createdAt: now - 60_000, text: '- The chip export rules changed [1].', sources, unseen: true },
      { id: 'i2', scheduleId: 's2', title: 'Markets', topic: 't', length: 'short', createdAt: now - 120_000, text: '- Markets rose [1].', sources, unseen: true }
    ])
    kv.set('briefs:schedules', [
      { id: 's1', title: 'Latest AI news', topic: 'the latest AI news', time: '08:00', frequency: 'daily', weekday: 1, length: 'short', paused: false, createdAt: now, nextRunAt: now + 3600_000, lastRunAt: now, error: null },
      { id: 's2', title: 'Markets', topic: 'markets', time: '09:00', frequency: 'daily', weekday: 1, length: 'short', paused: false, createdAt: now, nextRunAt: now + 3600_000, lastRunAt: now, error: null }
    ])
  })
  await go(h, 'sc://briefs#i1')
  const page = await h.page('sc://briefs')
  const edition = page.getByRole('region', { name: "Today's edition" })
  await expect(edition).toContainText('2 briefs')
  await expect(edition.getByRole('button', { name: /Listen to all/ })).toBeVisible()

  const brief = page.getByRole('article', { name: 'Latest AI news' })
  await brief.getByRole('button', { name: 'Follow a story' }).click()
  await page.getByRole('textbox', { name: 'Story to follow' }).fill('chip export rules')
  await page.getByRole('form', { name: 'Follow a story' }).getByRole('button', { name: 'Follow' }).click()
  await expect(page.getByRole('list', { name: 'Stories followed' })).toContainText('chip export rules')

  await brief.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('menuitem', { name: 'Add to new tab notes' }).click()
  await expect(brief.getByRole('status')).toContainText('Added to your notes')
  expect(await main((g) => g.scbCore.services.settings.get().newTab.notes)).toContain('• The chip export rules changed.')

  // A reading list brief needs no topic.
  await page.getByRole('button', { name: 'New brief' }).click()
  const form = page.getByRole('form', { name: 'New brief' })
  await form.getByRole('radio', { name: 'My reading list' }).click()
  await expect(form.getByRole('textbox', { name: 'What should scAI research?' })).toBeHidden()
  await form.getByRole('button', { name: 'Add brief' }).click()
  await expect(page.getByRole('region', { name: 'Scheduled briefs' })).toContainText('Reading list catch-up')
  await expect(page.getByRole('region', { name: 'Scheduled briefs' })).toContainText('From your reading list')
})

test('a workspace with hours is saved from its editor', async () => {
  h = await launch()
  await h.chrome.getByRole('button', { name: 'New workspace' }).click()
  const overlay = await h.overlay()
  const editor = overlay.getByRole('dialog', { name: 'New workspace' })
  await editor.getByRole('textbox', { name: 'Workspace name' }).fill('Work')
  await editor.getByRole('switch', { name: 'Switch to this workspace on a schedule' }).click()
  for (const day of ['Saturday', 'Sunday']) await editor.getByRole('button', { name: day }).click()
  await editor.getByRole('textbox', { name: 'From' }).fill('00:00')
  await editor.getByRole('textbox', { name: 'To' }).fill('23:59')
  await editor.getByRole('button', { name: 'Create' }).click()
  const saved = await main((g) => g.scbCore.savedWorkspaces().find((workspace: { name: string }) => workspace.name === 'Work'))
  expect(saved.schedule).toEqual({ days: [1, 2, 3, 4, 5, 6, 0], from: '00:00', to: '23:59' })

  // Back to the first workspace by hand; the schedule only acts when its hours begin.
  await main((g) => g.scbTabs.switchWorkspace('main'))
  expect(await main((g) => g.scbTabs.workspace.id)).toBe('main')
})
