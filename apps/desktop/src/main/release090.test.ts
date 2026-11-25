import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { barItems, folderItems, MAX_KEPT_QUESTIONS, type BriefInput } from '@scbrowser/shared'

vi.mock('electron', () => ({ nativeTheme: { themeSource: 'system' } }))

import { BriefService, type BriefDeps } from './briefs'
import { ReadingList } from './readingList'
import { SettingsStore } from './settings'
import { isSmokeTest } from './smokeTest'
import { BookmarksRepo } from './storage/bookmarks'
import { migrate } from './storage/database'
import { HistoryRepo } from './storage/history'
import { KeyValueRepo } from './storage/kv'
import { SyncService } from './sync'
import { tabTextMatches } from './tabText'

function memoryKv(): KeyValueRepo {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return new KeyValueRepo(db)
}

describe('kept brief questions', () => {
  const input: BriefInput = { title: '', topic: 'Research the latest AI news', time: '08:00', frequency: 'daily', weekday: 1, length: 'short' }
  function service() {
    let answers = 0
    const deps: BriefDeps = {
      kv: memoryKv(),
      hosted: () => false,
      write: vi.fn(async () => (answers++ === 0 ? 'Big news today [1].' : `Answer ${answers - 1} [1].`)),
      search: vi.fn(async () => [{ title: 'Story', url: 'https://news.example/1', text: 'Something happened.' }]),
      online: () => true,
      onChange: vi.fn(),
      onReady: vi.fn(),
      now: () => 1_000,
      timers: false
    }
    return new BriefService(deps)
  }

  it('keeps nothing unless asked to, as before', async () => {
    const briefs = service()
    const issue = await briefs.run(briefs.save(null, input).id)
    expect(await briefs.ask(issue.id, 'Who made it?')).toBe('Answer 1 [1].')
    expect(briefs.issues()[0]!.questions).toBeUndefined()
  })

  it('keeps each question with its brief while the switch is on, and forgets them all when it goes off', async () => {
    const briefs = service()
    const issue = await briefs.run(briefs.save(null, input).id)
    briefs.setPrefs({ keepQuestions: true })
    await briefs.ask(issue.id, 'Who made it?')
    await briefs.ask(issue.id, 'When?')
    expect(briefs.issues()[0]!.questions?.map((kept) => [kept.question, kept.answer])).toEqual([
      ['Who made it?', 'Answer 1 [1].'],
      ['When?', 'Answer 2 [1].']
    ])
    // Asked in the same millisecond, they still get times of their own, so Forget takes just one.
    briefs.forgetQuestion(issue.id, briefs.issues()[0]!.questions![0]!.askedAt)
    expect(briefs.issues()[0]!.questions!.map((kept) => kept.question)).toEqual(['When?'])
    await briefs.ask(issue.id, 'Again?')
    briefs.setPrefs({ keepQuestions: false })
    expect(briefs.issues()[0]!.questions).toBeUndefined()
    expect(briefs.prefs().keepQuestions).toBe(false)
  })

  it('keeps only the newest few', async () => {
    const briefs = service()
    const issue = await briefs.run(briefs.save(null, input).id)
    briefs.setPrefs({ keepQuestions: true })
    for (let n = 0; n < MAX_KEPT_QUESTIONS + 3; n++) await briefs.ask(issue.id, `Question ${n}`)
    const kept = briefs.issues()[0]!.questions!
    expect(kept).toHaveLength(MAX_KEPT_QUESTIONS)
    expect(kept.at(-1)!.question).toBe(`Question ${MAX_KEPT_QUESTIONS + 2}`)
  })
})

describe('bookmark order in sync', () => {
  function device() {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const kv = new KeyValueRepo(db)
    const bookmarks = new BookmarksRepo(db)
    const sync = new SyncService({
      kv,
      settings: new SettingsStore(kv),
      history: new HistoryRepo(db),
      bookmarks,
      vault: { encrypt: async (v) => v, decrypt: async (v) => v },
      basePath: join(mkdtempSync(join(tmpdir(), 'scb-sync-')), 'base.json'),
      onBookmarksChanged: () => undefined
    })
    return { sync, bookmarks }
  }
  const bar = (d: ReturnType<typeof device>) => barItems(d.bookmarks.list(), d.bookmarks.groups()).map((entry) => (entry.kind === 'group' ? `[${entry.item.name}]` : entry.item.url))
  const inFolder = (d: ReturnType<typeof device>, name: string) => {
    const id = d.bookmarks.groups().find((group) => group.name === name)!.id
    return folderItems(d.bookmarks.list(), d.bookmarks.groups(), id).map((entry) => (entry.kind === 'group' ? `[${entry.item.name}]` : entry.item.url))
  }

  it('carries the order of the bar and of each folder to the other device', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'scb-folder-'))
    const one = device()
    const two = device()
    for (const url of ['https://a.example/', 'https://b.example/', 'https://c.example/']) one.bookmarks.toggle(url, url)
    const work = one.bookmarks.addGroup('Work')
    const ids = Object.fromEntries(one.bookmarks.list().map((b) => [b.url, b.id]))
    one.bookmarks.setGroup(ids['https://b.example/']!, work)
    one.bookmarks.setGroup(ids['https://c.example/']!, work)
    await one.sync.enable(folder, 'a long passphrase')
    await two.sync.enable(folder, 'a long passphrase')
    await one.sync.run()

    // Reorder on one: the folder first on the bar, and C before B inside it.
    one.bookmarks.arrange([{ kind: 'group', id: work }, { kind: 'bookmark', id: ids['https://a.example/']! }])
    one.bookmarks.arrange([{ kind: 'bookmark', id: ids['https://c.example/']! }, { kind: 'bookmark', id: ids['https://b.example/']! }])
    await one.sync.run()
    await two.sync.run()
    expect(bar(two)).toEqual(['[Work]', 'https://a.example/'])
    expect(inFolder(two, 'Work')).toEqual(['https://c.example/', 'https://b.example/'])
    expect(bar(one)).toEqual(['[Work]', 'https://a.example/'])
  })
})

describe('find in all tabs', () => {
  const tab = (id: number, url: string, text: string | null, destroyed = false) => ({
    id,
    url,
    contents: {
      isDestroyed: () => destroyed,
      // Runs the real script against a fake page body.
      executeJavaScriptInIsolatedWorld: async (_world: number, scripts: { code: string }[]) => {
        const document = { body: text === null ? null : { innerText: text } }
        return new Function('document', `return ${scripts[0]!.code}`)(document)
      }
    } as never
  })

  it('finds the words in awake web pages, with a line around them and how often', async () => {
    const found = await tabTextMatches('  Cardamom ', [
      tab(1, 'https://a.example/', 'The secret ingredient is cardamom, and more cardamom later.'),
      tab(2, 'https://b.example/', 'Nothing to see.'),
      tab(3, 'sc://settings/', 'cardamom'),
      tab(4, 'https://c.example/', 'cardamom', true),
      { id: 5, url: 'https://d.example/', contents: undefined }
    ])
    expect(found).toEqual([{ id: 1, before: 'The secret ingredient is ', match: 'cardamom', after: ', and more cardamom later.', count: 2 }])
  })

  it('waits for three letters before reading any page', async () => {
    expect(await tabTextMatches('ca', [tab(1, 'https://a.example/', 'cardamom')])).toEqual([])
  })
})

describe('reading progress', () => {
  const page = (url: string, scrolled: number | null) =>
    ({ isDestroyed: () => false, getURL: () => url, executeJavaScriptInIsolatedWorld: async () => scrolled }) as never

  it('keeps the furthest point read in an open tab, and only for pages on the list', async () => {
    const list = new ReadingList(memoryKv())
    const item = list.add('https://a.example/long', 'Long')
    await list.noteProgress([page('https://a.example/long#part-2', 0.42), page('https://other.example/', 0.9)])
    expect(list.get(item.id)?.progress).toBe(0.42)
    await list.noteProgress([page('https://a.example/long', 0.1)])
    expect(list.get(item.id)?.progress).toBe(0.42)
    await list.noteProgress([page('https://a.example/long', null)])
    expect(list.get(item.id)?.progress).toBe(0.42)
  })
})

describe('installer smoke test', () => {
  it('runs only when asked for', () => {
    expect(isSmokeTest(['scterra', '--smoke-test'])).toBe(true)
    expect(isSmokeTest(['scterra', 'https://a.example/'])).toBe(false)
  })
})
